-- ChatSOS · behaviour test of migration 12 (20261102000100_group_management.sql).
-- Run as postgres (SQL Editor) after migration 12 and verify_schema.sql.
--
-- It creates groups, messages, files (storage rows only, no file content) and 47 throwaway
-- accounts while it runs, but ALWAYS ends with an error, so the transaction is rolled back
-- and nothing stays in the database. The result is that error's message:
--   "group management behaviour: ALL n CHECKS PASSED (everything rolled back)"   or
--   "group management behaviour: k FAILED of n: ..."
-- Needs the test accounts gd7_test1 … gd7_test4 (called A, B, C, D below).
-- Each step runs as one of them: role authenticated with that user's JWT claims, so RLS,
-- grants and auth.uid() behave as for the app. Setup steps run as postgres.
-- Inside one transaction now() never moves, so "earlier" messages and memberships are
-- written with explicit past times. Not covered: requests running at the same time (the
-- row lock in private.lock_group serializes them; verify_schema.sql checks it is there)
-- and Realtime delivery (tested end to end).

begin;

do $$
declare
  v_failures text[] := '{}';
  v_checks integer := 0;
  v_a uuid;
  v_b uuid;
  v_c uuid;
  v_d uuid;
  v_g uuid;
  v_g2 uuid;
  v_direct uuid;
  v_old_text uuid := gen_random_uuid();
  v_old_file uuid := gen_random_uuid();
  v_old_path text;
  v_c_upload text;
  v_system uuid;
  v_fakes uuid[] := '{}';
  v_fake uuid;
  v_n bigint;
  v_added integer;
  v_text text;
  i integer;
begin
  -- 0. Setup ------------------------------------------------------------------------------
  select p.id into v_a from public.profiles p where p.username = 'gd7_test1';
  select p.id into v_b from public.profiles p where p.username = 'gd7_test2';
  select p.id into v_c from public.profiles p where p.username = 'gd7_test3';
  select p.id into v_d from public.profiles p where p.username = 'gd7_test4';
  if v_a is null or v_b is null or v_c is null or v_d is null then
    raise exception 'group management behaviour: SETUP FAILED, needs gd7_test1 … gd7_test4';
  end if;

  -- A creates the group "Nhóm thử" with B, and a direct chat with B.
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_g := public.create_group_conversation('Nhóm thử', array[v_b]);
  v_direct := public.create_direct_conversation(v_b);
  reset role;

  -- A and B joined two hours ago; an hour ago A sent a text and an image.
  update public.conversation_members m
  set joined_at = now() - interval '2 hours'
  where m.conversation_id = v_g;
  v_old_path := v_g || '/' || gen_random_uuid() || '.png';
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('attachments', v_old_path, v_a::text, '{"mimetype": "image/png", "size": 10}');
  insert into public.messages (id, conversation_id, sender_id, kind, content, created_at)
  values (v_old_text, v_g, v_a, 'text', 'tin cũ', now() - interval '1 hour');
  insert into public.messages (
    id, conversation_id, sender_id, kind, content,
    attachment_path, attachment_name, attachment_size, attachment_mime, created_at
  )
  values (
    v_old_file, v_g, v_a, 'image', '',
    v_old_path, 'a.png', 10, 'image/png', now() - interval '1 hour'
  );

  set local role authenticated;

  -- 1. Rename ------------------------------------------------------------------------------
  -- A (owner) renames: the title changes and one system line records it.
  perform public.rename_group(v_g, '  Tên mới  ');
  v_checks := v_checks + 1;
  if (select c.title from public.conversations c where c.id = v_g) is distinct from 'Tên mới' then
    v_failures := v_failures || 'rename: title not changed (or not trimmed)'::text;
  end if;
  v_checks := v_checks + 1;
  select count(*) into v_n
  from public.messages m
  where m.conversation_id = v_g and m.kind = 'system' and m.system_event = 'title_changed'
    and m.content = 'Tên mới' and m.sender_id = v_a and m.system_target_id is null;
  if v_n <> 1 then
    v_failures := v_failures || format('rename: %s title_changed lines, expected 1', v_n);
  end if;

  -- The same title again changes nothing.
  perform public.rename_group(v_g, 'Tên mới');
  v_checks := v_checks + 1;
  select count(*) into v_n from public.messages m where m.conversation_id = v_g and m.kind = 'system';
  if v_n <> 1 then
    v_failures := v_failures || format('rename to the same title wrote a line (%s lines)', v_n);
  end if;

  -- B, a plain member, may rename too.
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform public.rename_group(v_g, 'Tên của B');
  v_checks := v_checks + 1;
  if (select c.title from public.conversations c where c.id = v_g) is distinct from 'Tên của B' then
    v_failures := v_failures || 'rename by a plain member refused'::text;
  end if;

  -- Invalid titles: blank, too long, control character.
  foreach v_text in array array['   ', repeat('x', 101), E'a\tb'] loop
    v_checks := v_checks + 1;
    begin
      perform public.rename_group(v_g, v_text);
      v_failures := v_failures || format('rename accepted the invalid title %L', left(v_text, 10));
    exception
      when sqlstate '22023' then null;
      when others then v_failures := v_failures || format('rename %L: %s %s', left(v_text, 10), sqlstate, sqlerrm);
    end;
  end loop;

  -- D (not a member), an unknown id and a direct chat all give P0002.
  perform set_config('request.jwt.claims', json_build_object('sub', v_d, 'role', 'authenticated')::text, true);
  v_checks := v_checks + 1;
  begin
    perform public.rename_group(v_g, 'Của D');
    v_failures := v_failures || 'rename by a non-member accepted'::text;
  exception
    when sqlstate 'P0002' then null;
    when others then v_failures := v_failures || format('rename by a non-member: %s %s', sqlstate, sqlerrm);
  end;
  v_checks := v_checks + 1;
  begin
    perform public.rename_group(gen_random_uuid(), 'Không có');
    v_failures := v_failures || 'rename of an unknown id accepted'::text;
  exception
    when sqlstate 'P0002' then null;
    when others then v_failures := v_failures || format('rename of an unknown id: %s %s', sqlstate, sqlerrm);
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  v_checks := v_checks + 1;
  begin
    perform public.rename_group(v_direct, 'Chat riêng');
    v_failures := v_failures || 'rename of a direct chat accepted'::text;
  exception
    when sqlstate 'P0002' then null;
    when others then v_failures := v_failures || format('rename of a direct chat: %s %s', sqlstate, sqlerrm);
  end;

  -- 2. Add members -------------------------------------------------------------------------
  -- B, a plain member, adds C (and A, already in the group, is skipped).
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  v_added := public.add_group_members(v_g, array[v_c, v_a]);
  v_checks := v_checks + 1;
  if v_added is distinct from 1 then
    v_failures := v_failures || format('add: returned %s, expected 1', v_added);
  end if;
  v_checks := v_checks + 1;
  if not exists (
    select 1 from public.conversation_members m
    where m.conversation_id = v_g and m.user_id = v_c and m.role = 'member'
  ) then
    v_failures := v_failures || 'add: C is not a plain member'::text;
  end if;
  v_checks := v_checks + 1;
  select count(*) into v_n
  from public.messages m
  where m.conversation_id = v_g and m.system_event = 'member_added'
    and m.sender_id = v_b and m.system_target_id = v_c and m.content = '';
  if v_n <> 1 then
    v_failures := v_failures || format('add: %s member_added lines for C, expected 1', v_n);
  end if;

  -- Adding C again changes nothing.
  v_added := public.add_group_members(v_g, array[v_c]);
  v_checks := v_checks + 1;
  select count(*) into v_n from public.messages m where m.conversation_id = v_g and m.system_event = 'member_added';
  if v_added is distinct from 0 or v_n <> 1 then
    v_failures := v_failures || format('add again: returned %s, %s lines', v_added, v_n);
  end if;

  -- Invalid lists: empty, null inside, duplicates, unknown user, 50 ids.
  v_checks := v_checks + 5;
  begin
    perform public.add_group_members(v_g, '{}');
    v_failures := v_failures || 'add accepted an empty list'::text;
  exception
    when sqlstate '22023' then null;
    when others then v_failures := v_failures || format('add empty: %s %s', sqlstate, sqlerrm);
  end;
  begin
    perform public.add_group_members(v_g, array[v_d, null]);
    v_failures := v_failures || 'add accepted a null id'::text;
  exception
    when sqlstate '22023' then null;
    when others then v_failures := v_failures || format('add null: %s %s', sqlstate, sqlerrm);
  end;
  begin
    perform public.add_group_members(v_g, array[v_d, v_d]);
    v_failures := v_failures || 'add accepted duplicate ids'::text;
  exception
    when sqlstate '22023' then null;
    when others then v_failures := v_failures || format('add duplicates: %s %s', sqlstate, sqlerrm);
  end;
  begin
    perform public.add_group_members(v_g, array[gen_random_uuid()]);
    v_failures := v_failures || 'add accepted an unknown user'::text;
  exception
    when sqlstate '22023' then null;
    when others then v_failures := v_failures || format('add unknown: %s %s', sqlstate, sqlerrm);
  end;
  begin
    perform public.add_group_members(v_g, array(select gen_random_uuid() from generate_series(1, 50)));
    v_failures := v_failures || 'add accepted 50 ids'::text;
  exception
    when sqlstate '22023' then null;
    when others then v_failures := v_failures || format('add 50 ids: %s %s', sqlstate, sqlerrm);
  end;

  -- D, not a member, cannot add anyone (not even themselves).
  perform set_config('request.jwt.claims', json_build_object('sub', v_d, 'role', 'authenticated')::text, true);
  v_checks := v_checks + 1;
  begin
    perform public.add_group_members(v_g, array[v_d]);
    v_failures := v_failures || 'add by a non-member accepted'::text;
  exception
    when sqlstate 'P0002' then null;
    when others then v_failures := v_failures || format('add by a non-member: %s %s', sqlstate, sqlerrm);
  end;

  -- 3. History since joining -----------------------------------------------------------------
  -- C (joined now) sees neither old message, but does see the line that added them.
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  v_checks := v_checks + 1;
  if exists (select 1 from public.messages m where m.id in (v_old_text, v_old_file)) then
    v_failures := v_failures || 'history: the new member sees messages sent before they joined'::text;
  end if;
  v_checks := v_checks + 1;
  if not exists (
    select 1 from public.messages m
    where m.conversation_id = v_g and m.system_event = 'member_added' and m.system_target_id = v_c
  ) then
    v_failures := v_failures || 'history: the new member does not see the line that added them'::text;
  end if;
  -- The old file is not readable for C, and C's own unsent upload is.
  reset role;
  v_c_upload := v_g || '/' || gen_random_uuid() || '.png';
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('attachments', v_c_upload, v_c::text, '{"mimetype": "image/png", "size": 10}');
  set local role authenticated;
  v_checks := v_checks + 1;
  if exists (select 1 from storage.objects o where o.bucket_id = 'attachments' and o.name = v_old_path) then
    v_failures := v_failures || 'history: the new member can read an older file'::text;
  end if;
  v_checks := v_checks + 1;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'attachments' and o.name = v_c_upload) then
    v_failures := v_failures || 'storage: a member cannot read their own unsent upload'::text;
  end if;

  -- B (joined two hours ago) sees both old messages and the old file, not C's unsent upload.
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  v_checks := v_checks + 1;
  select count(*) into v_n from public.messages m where m.id in (v_old_text, v_old_file);
  if v_n <> 2 then
    v_failures := v_failures || format('history: an earlier member sees %s of the 2 old messages', v_n);
  end if;
  v_checks := v_checks + 1;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'attachments' and o.name = v_old_path) then
    v_failures := v_failures || 'storage: an earlier member cannot read the old file'::text;
  end if;
  v_checks := v_checks + 1;
  if exists (select 1 from storage.objects o where o.bucket_id = 'attachments' and o.name = v_c_upload) then
    v_failures := v_failures || 'storage: a member can read another member''s unsent upload'::text;
  end if;

  -- 4. System messages are the database's only ------------------------------------------------
  v_checks := v_checks + 1;
  begin
    insert into public.messages (conversation_id, kind, content) values (v_g, 'system', '');
    v_failures := v_failures || 'a client inserted a system message'::text;
  exception
    when sqlstate '42501' or sqlstate '23514' then null;
    when others then v_failures := v_failures || format('client system insert: %s %s', sqlstate, sqlerrm);
  end;
  v_checks := v_checks + 1;
  begin
    insert into public.messages (conversation_id, kind, content, system_event)
    values (v_g, 'system', '', 'member_left');
    v_failures := v_failures || 'a client wrote system_event'::text;
  exception
    when sqlstate '42501' then null;
    when others then v_failures := v_failures || format('client system_event insert: %s %s', sqlstate, sqlerrm);
  end;

  -- B's rename line can be neither edited nor recalled by B.
  select m.id into v_system
  from public.messages m
  where m.conversation_id = v_g and m.system_event = 'title_changed' and m.sender_id = v_b;
  v_checks := v_checks + 2;
  begin
    update public.messages set content = 'sửa' where id = v_system;
    v_failures := v_failures || 'a system message was edited'::text;
  exception
    when sqlstate '22023' then null;
    when others then v_failures := v_failures || format('edit system message: %s %s', sqlstate, sqlerrm);
  end;
  begin
    update public.messages set deleted_at = now() where id = v_system;
    v_failures := v_failures || 'a system message was recalled'::text;
  exception
    when sqlstate '22023' then null;
    when others then v_failures := v_failures || format('recall system message: %s %s', sqlstate, sqlerrm);
  end;

  -- Ordinary messages still work for members.
  v_checks := v_checks + 1;
  begin
    insert into public.messages (conversation_id, kind, content) values (v_g, 'text', 'xin chào');
  exception
    when others then v_failures := v_failures || format('a member could not send text: %s %s', sqlstate, sqlerrm);
  end;

  -- 5. Remove members --------------------------------------------------------------------------
  -- B is not the owner.
  v_checks := v_checks + 1;
  begin
    perform public.remove_group_member(v_g, v_c);
    v_failures := v_failures || 'a plain member removed someone'::text;
  exception
    when sqlstate '42501' then null;
    when others then v_failures := v_failures || format('remove by a plain member: %s %s', sqlstate, sqlerrm);
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  v_checks := v_checks + 1;
  begin
    perform public.remove_group_member(v_g, v_a);
    v_failures := v_failures || 'the owner removed themselves'::text;
  exception
    when sqlstate '22023' then null;
    when others then v_failures := v_failures || format('owner removes self: %s %s', sqlstate, sqlerrm);
  end;

  -- A (owner) removes C.
  perform public.remove_group_member(v_g, v_c);
  v_checks := v_checks + 1;
  if exists (select 1 from public.conversation_members m where m.conversation_id = v_g and m.user_id = v_c) then
    v_failures := v_failures || 'remove: C is still a member'::text;
  end if;
  v_checks := v_checks + 1;
  select count(*) into v_n
  from public.messages m
  where m.conversation_id = v_g and m.system_event = 'member_removed'
    and m.sender_id = v_a and m.system_target_id = v_c;
  if v_n <> 1 then
    v_failures := v_failures || format('remove: %s member_removed lines, expected 1', v_n);
  end if;

  -- Removing C again changes nothing.
  perform public.remove_group_member(v_g, v_c);
  v_checks := v_checks + 1;
  select count(*) into v_n from public.messages m where m.conversation_id = v_g and m.system_event = 'member_removed';
  if v_n <> 1 then
    v_failures := v_failures || format('remove again wrote a line (%s lines)', v_n);
  end if;

  -- C now sees nothing of the group, except their own removal row.
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  v_checks := v_checks + 1;
  if exists (select 1 from public.messages m where m.conversation_id = v_g)
     or exists (select 1 from public.conversations c where c.id = v_g)
     or exists (select 1 from public.conversation_members m where m.conversation_id = v_g) then
    v_failures := v_failures || 'remove: the removed member still reads the group'::text;
  end if;
  v_checks := v_checks + 1;
  if exists (select 1 from storage.objects o where o.bucket_id = 'attachments' and o.name = v_c_upload) then
    v_failures := v_failures || 'remove: the removed member still reads their upload in the group'::text;
  end if;
  v_checks := v_checks + 1;
  if not exists (
    select 1 from public.conversation_removals r where r.user_id = v_c and r.conversation_id = v_g
  ) then
    v_failures := v_failures || 'remove: the removed member has no removal row'::text;
  end if;
  v_checks := v_checks + 1;
  begin
    perform public.leave_group(v_g);
    v_failures := v_failures || 'a removed member could still leave'::text;
  exception
    when sqlstate 'P0002' then null;
    when others then v_failures := v_failures || format('removed member leaves: %s %s', sqlstate, sqlerrm);
  end;

  -- Other users never see someone's removal rows.
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  v_checks := v_checks + 1;
  if exists (select 1 from public.conversation_removals r where r.user_id = v_c) then
    v_failures := v_failures || 'removal rows are readable by other users'::text;
  end if;

  -- 6. Hand the group over ------------------------------------------------------------------------
  v_checks := v_checks + 1;
  begin
    perform public.transfer_group_ownership(v_g, v_b);
    v_failures := v_failures || 'a plain member took over the group'::text;
  exception
    when sqlstate '42501' then null;
    when others then v_failures := v_failures || format('transfer by a plain member: %s %s', sqlstate, sqlerrm);
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  v_checks := v_checks + 1;
  begin
    perform public.transfer_group_ownership(v_g, v_d);
    v_failures := v_failures || 'the group was handed to a non-member'::text;
  exception
    when sqlstate '22023' then null;
    when others then v_failures := v_failures || format('transfer to a non-member: %s %s', sqlstate, sqlerrm);
  end;

  perform public.transfer_group_ownership(v_g, v_b);
  v_checks := v_checks + 1;
  if (select m.role from public.conversation_members m where m.conversation_id = v_g and m.user_id = v_b) <> 'owner'
     or (select m.role from public.conversation_members m where m.conversation_id = v_g and m.user_id = v_a) <> 'member' then
    v_failures := v_failures || 'transfer: roles not swapped'::text;
  end if;
  v_checks := v_checks + 1;
  select count(*) into v_n
  from public.messages m
  where m.conversation_id = v_g and m.system_event = 'owner_changed'
    and m.sender_id = v_a and m.system_target_id = v_b;
  if v_n <> 1 then
    v_failures := v_failures || format('transfer: %s owner_changed lines, expected 1', v_n);
  end if;

  -- 7. Leave --------------------------------------------------------------------------------
  -- C rejoins (added by A); then B, the owner, leaves: A joined first, so A is the owner.
  perform public.add_group_members(v_g, array[v_c]);
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform public.leave_group(v_g);
  v_checks := v_checks + 1;
  if exists (select 1 from public.conversation_members m where m.conversation_id = v_g and m.user_id = v_b) then
    v_failures := v_failures || 'leave: B is still a member'::text;
  end if;
  v_checks := v_checks + 1;
  if exists (select 1 from public.conversation_members m where m.conversation_id = v_g) then
    v_failures := v_failures || 'leave: the member who left still reads the member list'::text;
  end if;
  v_checks := v_checks + 1;
  if not exists (
    select 1 from public.conversation_removals r where r.user_id = v_b and r.conversation_id = v_g
  ) then
    v_failures := v_failures || 'leave: no removal row for the member who left'::text;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  v_checks := v_checks + 1;
  if (select m.role from public.conversation_members m where m.conversation_id = v_g and m.user_id = v_a) <> 'owner'
     or (select count(*) from public.conversation_members m where m.conversation_id = v_g and m.role = 'owner') <> 1 then
    v_failures := v_failures || 'leave: the member who joined first is not the only owner'::text;
  end if;
  v_checks := v_checks + 1;
  select count(*) into v_n
  from public.messages m
  where m.conversation_id = v_g and m.sender_id = v_b
    and (
      (m.system_event = 'member_left' and m.system_target_id is null)
      or (m.system_event = 'owner_changed' and m.system_target_id = v_a)
    );
  if v_n <> 2 then
    v_failures := v_failures || format('leave: %s of the 2 lines (left, new owner)', v_n);
  end if;

  -- C, a plain member, leaves: A stays the owner, no owner line.
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  perform public.leave_group(v_g);
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  v_checks := v_checks + 1;
  if (select count(*) from public.conversation_members m where m.conversation_id = v_g) <> 1
     or exists (
       select 1 from public.messages m
       where m.conversation_id = v_g and m.system_event = 'owner_changed' and m.sender_id = v_c
     ) then
    v_failures := v_failures || 'leave by a plain member: wrong members or an owner line'::text;
  end if;

  -- A, the last member, leaves: the group and its messages are gone.
  perform public.leave_group(v_g);
  reset role;
  v_checks := v_checks + 1;
  if exists (select 1 from public.conversations c where c.id = v_g)
     or exists (select 1 from public.messages m where m.conversation_id = v_g) then
    v_failures := v_failures || 'leave by the last member: the group or its messages remain'::text;
  end if;
  v_checks := v_checks + 1;
  if not exists (
    select 1 from public.conversation_removals r where r.user_id = v_a and r.conversation_id = v_g
  ) then
    v_failures := v_failures || 'leave by the last member: no removal row'::text;
  end if;

  -- 8. 50 members at most; a deleted account ------------------------------------------------------
  -- 47 throwaway accounts (their profiles come from the sign-up trigger).
  for i in 1..47 loop
    v_fake := gen_random_uuid();
    insert into auth.users (id, raw_user_meta_data)
    values (v_fake, jsonb_build_object(
      'username', format('g12_fake_%s', i),
      'display_name', format('Fake %s', i),
      'phone', format('0388%s', lpad(i::text, 6, '0'))
    ));
    v_fakes := v_fakes || v_fake;
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_g2 := public.create_group_conversation('Nhóm đầy', array[v_b, v_c]);
  -- 3 + 47 = 50: allowed.
  v_added := public.add_group_members(v_g2, v_fakes);
  v_checks := v_checks + 1;
  if v_added is distinct from 47 then
    v_failures := v_failures || format('full group: added %s of 47', v_added);
  end if;
  -- The 51st is refused, and nobody is added.
  v_checks := v_checks + 1;
  begin
    perform public.add_group_members(v_g2, array[v_d]);
    v_failures := v_failures || 'a 51st member was added'::text;
  exception
    when sqlstate 'CS002' then null;
    when others then v_failures := v_failures || format('51st member: %s %s', sqlstate, sqlerrm);
  end;
  v_checks := v_checks + 1;
  if exists (select 1 from public.conversation_members m where m.conversation_id = v_g2 and m.user_id = v_d) then
    v_failures := v_failures || 'the refused member was added anyway'::text;
  end if;

  -- Deleting an added account keeps the line, without its target.
  reset role;
  delete from auth.users u where u.id = v_fakes[1];
  v_checks := v_checks + 1;
  if not exists (
    select 1 from public.messages m
    where m.conversation_id = v_g2 and m.system_event = 'member_added'
      and m.system_target_id is null
  ) then
    v_failures := v_failures || 'deleted account: the member_added line was lost'::text;
  end if;

  -- 9. Result ---------------------------------------------------------------------------------
  if cardinality(v_failures) = 0 then
    raise exception 'group management behaviour: ALL % CHECKS PASSED (everything rolled back)', v_checks;
  else
    raise exception 'group management behaviour: % FAILED of %: %',
      cardinality(v_failures), v_checks, array_to_string(v_failures, ' | ');
  end if;
end;
$$;

rollback;
