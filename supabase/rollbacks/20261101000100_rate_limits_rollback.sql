-- ChatSOS · rollback of migration 11 (20261101000100_rate_limits.sql).
-- Run by hand in the Supabase SQL Editor, only when the limits must be undone.
-- Wrapped in a transaction: when a step fails, nothing is changed.
--
-- FIRST remove or stop the phone-sign-in Edge Function (Dashboard > Edge Functions): it
-- calls phone_sign_in_check, and without that function every phone sign-in fails
-- (it refuses rather than skipping the limit). Email sign-in is not affected.
--
-- The counters only hold short-lived hashes and user ids, so dropping them loses nothing
-- worth keeping.

begin;

-- find_profile_by_phone exactly as in migration 10 (no limit, STABLE).
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

-- create or replace replaces the whole SET list too, so migration 11's lock_timeout is gone.
revoke all on function public.find_profile_by_phone(text) from public, anon;
grant execute on function public.find_profile_by_phone(text) to authenticated;

-- No IF EXISTS, no CASCADE: anything unexpected fails the whole rollback.
drop function public.phone_sign_in_succeeded(text);
drop function public.phone_sign_in_check(text, text);
drop function private.hit_rate_limit(text, interval, integer);
drop table private.rate_limit_counters;

commit;
