begin;

-- Giới hạn số lần thử
create table private.rate_limit_counters (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null,
  primary key (bucket, window_start),
  constraint rate_limit_counters_bucket_valid check (char_length(bucket) between 1 and 128),
  constraint rate_limit_counters_hits_positive check (hits > 0)
);

comment on table private.rate_limit_counters is
  'Rate-limit counters, one row per bucket and window. Holds hashes and user ids only. '
  'Rows older than a day are deleted by private.hit_rate_limit.';

create index rate_limit_counters_window_start_idx
  on private.rate_limit_counters (window_start);

alter table private.rate_limit_counters enable row level security;
revoke all on table private.rate_limit_counters from public, anon, authenticated, service_role;

create function private.hit_rate_limit(p_bucket text, p_window interval, p_limit integer)
returns boolean
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_window timestamptz := date_bin(p_window, now(), timestamptz '2000-01-01 00:00:00+00');
  v_hits integer;
begin
  insert into private.rate_limit_counters as c (bucket, window_start, hits)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = c.hits + 1
  returning c.hits into v_hits;

  if random() < 0.01 then
    delete from private.rate_limit_counters
    where ctid in (
      select o.ctid
      from private.rate_limit_counters o
      where o.window_start < now() - interval '1 day'
      limit 500
      for update skip locked
    );
  end if;

  return v_hits <= p_limit;
end;
$$;

revoke all on function private.hit_rate_limit(text, interval, integer) from public, anon, authenticated;

-- Kiểm tra đăng nhập bằng SĐT
create function public.phone_sign_in_check(p_phone text, p_ip text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '2s'
as $$
declare
  v_phone text := private.normalize_vn_phone(p_phone);
  v_phone_ok boolean := true;
  v_ip_ok boolean := true;
begin
  if p_ip is not null then
    if char_length(p_ip) > 64 then
      raise exception 'invalid ip' using errcode = '22023';
    end if;
    v_ip_ok := private.hit_rate_limit(
      'signin_ip:' || encode(sha256(convert_to(p_ip, 'UTF8')), 'hex'), interval '15 minutes', 60);
  end if;

  if v_phone is not null then
    v_phone_ok := private.hit_rate_limit(
      'signin_phone:' || encode(sha256(convert_to(v_phone, 'UTF8')), 'hex'), interval '15 minutes', 5);
  end if;

  return v_phone_ok and v_ip_ok;
end;
$$;

create function public.phone_sign_in_succeeded(p_phone text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '2s'
as $$
declare
  v_phone text := private.normalize_vn_phone(p_phone);
begin
  if v_phone is null then
    return;
  end if;

  delete from private.rate_limit_counters
  where bucket = 'signin_phone:' || encode(sha256(convert_to(v_phone, 'UTF8')), 'hex');
end;
$$;

revoke all on function public.phone_sign_in_check(text, text) from public, anon, authenticated;
revoke all on function public.phone_sign_in_succeeded(text) from public, anon, authenticated;
grant execute on function public.phone_sign_in_check(text, text) to service_role;
grant execute on function public.phone_sign_in_succeeded(text) to service_role;

create or replace function public.find_profile_by_phone(p_phone text)
returns table (id uuid, username text, display_name text, avatar_path text)
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '2s'
as $$
declare
  v_me uuid := (select auth.uid());
  v_phone text;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if not private.hit_rate_limit('phone_lookup:' || v_me::text, interval '10 minutes', 20) then
    raise exception 'chatsos:rate_limited' using errcode = 'PT429';
  end if;

  v_phone := private.normalize_vn_phone(p_phone);
  if v_phone is null then
    return;
  end if;

  return query
    select p.id, p.username, p.display_name, p.avatar_path
    from public.profiles p
    where p.phone = v_phone
      and p.id <> v_me;
end;
$$;

revoke all on function public.find_profile_by_phone(text) from public, anon;
grant execute on function public.find_profile_by_phone(text) to authenticated;

commit;
