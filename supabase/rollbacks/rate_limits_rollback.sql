begin;

create or replace function public.find_profile_by_phone(p_phone text)
returns table (id uuid, username text, display_name text, avatar_path text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_phone text := private.normalize_vn_phone(p_phone);
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

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

drop function public.phone_sign_in_succeeded(text);
drop function public.phone_sign_in_check(text, text);
drop function private.hit_rate_limit(text, interval, integer);
drop table private.rate_limit_counters;

commit;
