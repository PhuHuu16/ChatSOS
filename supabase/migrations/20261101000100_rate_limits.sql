-- ChatSOS · Phase 11 · migration 11: limits against guessing phone numbers and passwords.
-- Run after 20261031000100_phone_and_admin_users.sql. Wrapped in a transaction.
--
-- 1. private.rate_limit_counters: fixed-window counters. Buckets hold a SHA-256 of the
--    phone number or IP address, never the value itself. No role has any right on it.
-- 2. private.hit_rate_limit: records one hit and says whether the bucket is still within
--    its limit. Check and record are one INSERT ... ON CONFLICT DO UPDATE statement, so
--    concurrent requests are serialized on the row lock and exactly `limit` get through.
-- 3. phone_sign_in_check / phone_sign_in_succeeded: called only by the phone-sign-in Edge
--    Function (service_role), before it looks the number up: 5 attempts per number and
--    60 per IP address per 15 minutes. A successful sign-in clears that number's counter.
-- 4. find_profile_by_phone: at most 20 lookups per signed-in user per 10 minutes, counted
--    before the search. Now VOLATILE (it writes), so PostgREST only accepts it by POST,
--    which supabase.rpc uses.
--
-- Every error (including lock_timeout) refuses the request: nothing here fails open.

begin;

-- 1. Counters --------------------------------------------------------------------------

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

-- Only the functions below (owned by postgres) read or write it.
alter table private.rate_limit_counters enable row level security;
revoke all on table private.rate_limit_counters from public, anon, authenticated, service_role;

-- 2. Shared counter --------------------------------------------------------------------

-- Records one hit in the current window of p_bucket and returns whether the bucket is
-- still within p_limit (the hit that reaches the limit is allowed, the next is not).
-- Not SECURITY DEFINER: it runs as the definer functions that call it.
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

  -- Cleanup in small steps: about 1 call in 100 deletes up to 500 rows older than a day,
  -- skipping rows another request holds, so it never waits on them.
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

-- 3. Phone sign-in ---------------------------------------------------------------------

-- Called by the phone-sign-in Edge Function before anything else, for registered and
-- unregistered numbers alike. Always records a hit in every bucket that applies, then
-- returns whether all of them are within their limits. p_ip is null when the function
-- has no trusted source for the client address; that bucket is then skipped.
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

-- After a successful sign-in: the number's counter starts again. The IP counter stays.
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

-- Supabase grants EXECUTE on new public functions to anon and authenticated by default.
revoke all on function public.phone_sign_in_check(text, text) from public, anon, authenticated;
revoke all on function public.phone_sign_in_succeeded(text) from public, anon, authenticated;
grant execute on function public.phone_sign_in_check(text, text) to service_role;
grant execute on function public.phone_sign_in_succeeded(text) to service_role;

-- 4. Phone lookup limit ----------------------------------------------------------------

-- Same as migration 10, plus the limit before any read of profiles. The caller is the
-- verified JWT subject (auth.uid()), never a value the client passes. Over the limit it
-- raises PT429 (HTTP 429 through PostgREST); the error also undoes this call's hit, so the
-- counter stays at the limit until the window ends.
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
