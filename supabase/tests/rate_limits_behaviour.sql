-- ChatSOS · behaviour test of migration 11 (20261101000100_rate_limits.sql).
-- Run as postgres (SQL Editor) after migration 11 and verify_schema.sql.
--
-- It writes counters while it runs, but ALWAYS ends with an error, so the transaction is
-- rolled back and nothing stays in the database. The result is that error's message:
--   "rate limit behaviour: ALL n CHECKS PASSED (everything rolled back)"   or
--   "rate limit behaviour: k FAILED of n: ..."
-- Not covered: requests running at the same time (the single INSERT ... ON CONFLICT is
-- what serializes them; verify_schema.sql checks that the function still uses it).
-- All numbers used here are fake; the user ids are random and match no account.

begin;

do $$
declare
  v_failures text[] := '{}';
  v_checks integer := 0;
  v_allowed boolean;
  v_user uuid := gen_random_uuid();
  v_other_user uuid := gen_random_uuid();
  i integer;
begin
  -- 1. One number (not registered): attempts 1-5 allowed, 6 and 7 refused.
  for i in 1..7 loop
    v_allowed := public.phone_sign_in_check('0399 000 001', null);
    v_checks := v_checks + 1;
    if v_allowed is distinct from (i <= 5) then
      v_failures := v_failures || format('number attempt %s: allowed = %s', i, v_allowed);
    end if;
  end loop;

  -- 2. Other spellings of the same number share its counter.
  v_checks := v_checks + 1;
  if public.phone_sign_in_check('+84399000001', null) then
    v_failures := v_failures || 'the +84 spelling has its own counter'::text;
  end if;

  -- 3. A successful sign-in clears the number's counter.
  perform public.phone_sign_in_succeeded('0399000001');
  v_checks := v_checks + 1;
  if not public.phone_sign_in_check('0399000001', null) then
    v_failures := v_failures || 'number counter not cleared after a success'::text;
  end if;

  -- 4. One IP address: 60 attempts on 60 different numbers allowed, the 61st refused even
  --    though that number has no attempts yet.
  for i in 1..61 loop
    v_allowed := public.phone_sign_in_check(format('07990%s', lpad(i::text, 5, '0')), '203.0.113.7');
    v_checks := v_checks + 1;
    if v_allowed is distinct from (i <= 60) then
      v_failures := v_failures || format('ip attempt %s: allowed = %s', i, v_allowed);
    end if;
  end loop;

  -- 5. An invalid number still counts against the IP address, so it is refused too.
  v_checks := v_checks + 1;
  if public.phone_sign_in_check('not a number', '203.0.113.7') then
    v_failures := v_failures || 'an invalid number skipped the ip limit'::text;
  end if;

  -- 6. Another IP address has its own counter.
  v_checks := v_checks + 1;
  if not public.phone_sign_in_check('0799100001', '203.0.113.8') then
    v_failures := v_failures || 'another ip address was refused'::text;
  end if;

  -- 7. An over-long address is an error (the Edge Function then refuses), not a skip.
  v_checks := v_checks + 1;
  begin
    perform public.phone_sign_in_check('0399000002', repeat('1', 65));
    v_failures := v_failures || 'an over-long ip address was accepted'::text;
  exception when sqlstate '22023' then
    null;
  end;

  -- 8. Sign-in counters hold a SHA-256 of the normalized number or address, never the
  --    value itself.
  v_checks := v_checks + 1;
  if exists (
    select 1
    from private.rate_limit_counters c
    where c.bucket like 'signin\_%'
      and c.bucket !~ '^signin_(phone|ip):[0-9a-f]{64}$'
  ) then
    v_failures := v_failures || 'a sign-in counter is not a hash'::text;
  end if;
  v_checks := v_checks + 1;
  if not exists (
    select 1
    from private.rate_limit_counters c
    where c.bucket = 'signin_phone:' || encode(sha256(convert_to('+84399000001', 'UTF8')), 'hex')
  ) or not exists (
    select 1
    from private.rate_limit_counters c
    where c.bucket = 'signin_ip:' || encode(sha256(convert_to('203.0.113.7', 'UTF8')), 'hex')
  ) then
    v_failures := v_failures || 'the hashed counters were not found'::text;
  end if;

  -- 9. find_profile_by_phone as a signed-in user: lookups 1-20 allowed, 21 and 22 refused
  --    with PT429. The caller comes from the JWT claims, as PostgREST sets them.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for i in 1..22 loop
    v_checks := v_checks + 1;
    begin
      perform * from public.find_profile_by_phone('0399000003');
      if i > 20 then
        v_failures := v_failures || format('lookup %s allowed', i);
      end if;
    exception when sqlstate 'PT429' then
      if i <= 20 then
        v_failures := v_failures || format('lookup %s refused', i);
      end if;
    end;
  end loop;

  -- 10. Another user has their own lookup counter.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_other_user, 'role', 'authenticated')::text, true);
  v_checks := v_checks + 1;
  begin
    perform * from public.find_profile_by_phone('0399000003');
  exception when sqlstate 'PT429' then
    v_failures := v_failures || 'another user was refused'::text;
  end;

  -- 11. authenticated can neither record sign-in attempts nor read the counters.
  v_checks := v_checks + 1;
  begin
    perform public.phone_sign_in_check('0399000004', null);
    v_failures := v_failures || 'authenticated ran phone_sign_in_check'::text;
  exception when insufficient_privilege then
    null;
  end;
  v_checks := v_checks + 1;
  begin
    perform public.phone_sign_in_succeeded('0399000004');
    v_failures := v_failures || 'authenticated ran phone_sign_in_succeeded'::text;
  exception when insufficient_privilege then
    null;
  end;
  v_checks := v_checks + 1;
  begin
    perform 1 from private.rate_limit_counters;
    v_failures := v_failures || 'authenticated read the counters'::text;
  exception when insufficient_privilege then
    null;
  end;
  -- authenticated has USAGE on schema private. Both the function grant and the table rights
  -- stop this; verify_schema.sql checks the function grant on its own.
  v_checks := v_checks + 1;
  begin
    perform private.hit_rate_limit('signin_phone:forged', interval '15 minutes', 1000);
    v_failures := v_failures || 'authenticated ran private.hit_rate_limit'::text;
  exception when insufficient_privilege then
    null;
  end;
  reset role;

  -- 12. anon can call none of the three functions.
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  v_checks := v_checks + 1;
  begin
    perform public.phone_sign_in_check('0399000004', null);
    v_failures := v_failures || 'anon ran phone_sign_in_check'::text;
  exception when insufficient_privilege then
    null;
  end;
  v_checks := v_checks + 1;
  begin
    perform * from public.find_profile_by_phone('0399000003');
    v_failures := v_failures || 'anon ran find_profile_by_phone'::text;
  exception when insufficient_privilege then
    null;
  end;
  reset role;

  -- 13. service_role (the Edge Function) can call the sign-in functions, not read the table.
  set local role service_role;
  v_checks := v_checks + 1;
  begin
    if not public.phone_sign_in_check('0399000005', null) then
      v_failures := v_failures || 'service_role was refused on a first attempt'::text;
    end if;
    perform public.phone_sign_in_succeeded('0399000005');
  exception when insufficient_privilege then
    v_failures := v_failures || 'service_role cannot run the sign-in functions'::text;
  end;
  v_checks := v_checks + 1;
  begin
    perform 1 from private.rate_limit_counters;
    v_failures := v_failures || 'service_role read the counters directly'::text;
  exception when insufficient_privilege then
    null;
  end;
  reset role;

  -- Always an error, so the transaction rolls back whatever the outcome.
  if cardinality(v_failures) = 0 then
    raise exception 'rate limit behaviour: ALL % CHECKS PASSED (everything rolled back)', v_checks;
  end if;
  raise exception 'rate limit behaviour: % FAILED of %: %',
    cardinality(v_failures), v_checks, array_to_string(v_failures, '; ');
end;
$$;

rollback;
