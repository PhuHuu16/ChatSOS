-- ChatSOS · Phase 12 · migration 12: group management.
-- Run after 20261101000100_rate_limits.sql. Wrapped in a transaction.
--
-- 1. System messages: the database writes a line into the chat when a group changes
--    ("A added B", "B left", "A renamed the group to …", "C is now the owner"). Clients can
--    never write, edit or recall one. They also tell the other members' apps over Realtime
--    that the group changed.
-- 2. Members see only the messages sent since they joined, and only those messages' files.
-- 3. Each group has exactly one owner.
-- 4. public.conversation_removals tells a removed member's app (and the other tabs of a
--    member who left) at once, over Realtime: DELETE events are not published (migration 9).
-- 5. RPCs: any member renames the group and adds members; only the owner removes members
--    and hands the group to another member; anyone leaves. An owner who leaves hands the
--    group to the member who joined first; when the last member leaves, the group is
--    deleted. Each RPC locks the group's row first, so changes to one group never overlap.

begin;

-- 1. System messages -------------------------------------------------------------------

alter table public.messages
  add column system_event text
    constraint messages_system_event_valid check (
      system_event is null
      or system_event in ('member_added', 'member_removed', 'member_left', 'title_changed', 'owner_changed')
    ),
  -- The member added, removed or made owner. Becomes null when that account is deleted;
  -- the line then names "a deleted account".
  add column system_target_id uuid references public.profiles (id) on delete set null;

-- Lets the "set null" above find the rows quickly when an account is deleted.
create index messages_system_target_id_idx
  on public.messages (system_target_id)
  where system_target_id is not null;

alter table public.messages drop constraint messages_kind_valid;
alter table public.messages add constraint messages_kind_valid check (
  kind in ('text', 'image', 'file', 'system')
);

-- Same three shapes as migration 6, which now also have no system fields, plus a fourth:
-- a system message has no attachment, cannot have been recalled, and holds text only for
-- a rename (the new title, as the conversations_shape check allows it).
alter table public.messages drop constraint messages_kind_consistency;
alter table public.messages add constraint messages_kind_consistency check (
  (
    deleted_at is null
    and kind = 'text'
    and content ~ '[^[:space:]]'
    and attachment_path is null
    and attachment_name is null
    and attachment_size is null
    and attachment_mime is null
    and system_event is null
    and system_target_id is null
  )
  or (
    deleted_at is null
    and kind in ('image', 'file')
    and attachment_path is not null
    and attachment_name is not null
    and attachment_size is not null
    and attachment_mime is not null
    and system_event is null
    and system_target_id is null
  )
  or (
    deleted_at is not null
    and kind <> 'system'
    and content = ''
    and attachment_path is null
    and attachment_name is null
    and attachment_size is null
    and attachment_mime is null
    and system_event is null
    and system_target_id is null
  )
  or (
    deleted_at is null
    and kind = 'system'
    and attachment_path is null
    and attachment_name is null
    and attachment_size is null
    and attachment_mime is null
    and system_event is not null
    and (
      (
        system_event = 'title_changed'
        and system_target_id is null
        and char_length(content) <= 100
        and char_length(btrim(content)) >= 1
        and content !~ '[[:cntrl:]]'
      )
      or (system_event = 'member_left' and system_target_id is null and content = '')
      or (system_event in ('member_added', 'member_removed', 'owner_changed') and content = '')
    )
  )
);

-- Clients have no INSERT privilege on system_event / system_target_id, so the check above
-- already refuses a client's system message; the policy refuses it explicitly as well.
drop policy "messages: members send as themselves" on public.messages;
create policy "messages: members send as themselves"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and kind <> 'system'
    and private.is_member(conversation_id)
  );

-- Same as migration 4, but system messages, like text, have no attachment to check.
create or replace function private.validate_message_attachment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner text;
  v_metadata jsonb;
begin
  if new.kind in ('text', 'system') then
    return new;
  end if;

  -- Non-members and spoofed senders are rejected by RLS right after this trigger;
  -- returning early means the checks below reveal nothing to them.
  if new.sender_id is distinct from (select auth.uid())
     or not private.is_member(new.conversation_id) then
    return new;
  end if;

  select o.owner_id, o.metadata
  into v_owner, v_metadata
  from storage.objects o
  where o.bucket_id = 'attachments'
    and o.name = new.attachment_path;

  if not found then
    raise exception 'attachment not uploaded' using errcode = '23503';
  end if;

  if v_owner is distinct from new.sender_id::text then
    raise exception 'attachment was uploaded by another user' using errcode = '42501';
  end if;

  if v_metadata ->> 'mimetype' is distinct from new.attachment_mime then
    raise exception 'attachment type does not match the stored file' using errcode = '22023';
  end if;

  if (v_metadata ->> 'size')::bigint is distinct from new.attachment_size then
    raise exception 'attachment size does not match the stored file' using errcode = '22023';
  end if;

  return new;
end;
$$;

-- Same as migration 6, plus: a system message can never be edited or recalled. Only its
-- system_target_id may change, and only when the database sets it to null because that
-- account was deleted (content and deleted_at, the columns clients may update, stay as they are).
create or replace function private.guard_message_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.kind = 'system' then
    if new.content is distinct from old.content or new.deleted_at is distinct from old.deleted_at then
      raise exception 'system messages cannot be changed' using errcode = '22023';
    end if;
    return new;
  end if;

  if old.deleted_at is not null then
    return old;
  end if;

  if now() > old.created_at + interval '2 minutes' then
    raise exception 'messages can only be changed within 2 minutes of sending'
      using errcode = 'CS001';
  end if;

  if new.deleted_at is not null then
    new.deleted_at := now();
    new.edited_at := old.edited_at;
    new.content := '';
    new.attachment_path := null;
    new.attachment_name := null;
    new.attachment_size := null;
    new.attachment_mime := null;
    return new;
  end if;

  if new.content is distinct from old.content then
    if old.kind <> 'text' then
      raise exception 'only text messages can be edited' using errcode = '22023';
    end if;
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;

  return new;
end;
$$;

-- 2. History from the moment a member joined ------------------------------------------------

-- When the caller joined the conversation, or null when they are not a member. SECURITY
-- DEFINER for the same reason as private.is_member: policies can use it without recursion.
create function private.member_since(p_conversation_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select m.joined_at
  from public.conversation_members m
  where m.conversation_id = p_conversation_id
    and m.user_id = (select auth.uid());
$$;

revoke all on function private.member_since(uuid) from public, anon;
grant execute on function private.member_since(uuid) to authenticated;

-- Same as migration 9, except that "is a member" becomes "was a member when the message
-- was sent": for a non-member member_since() is null, so the comparison is null and the
-- row is not visible. ">=" so a new member sees the "X added Y" line written with them.
drop policy "messages: members read what they have not deleted" on public.messages;

create policy "messages: members read what was sent since they joined"
  on public.messages for select to authenticated
  using (
    messages.created_at >= private.member_since(conversation_id)
    and not exists (
      select 1
      from public.message_hides h
      where h.message_id = messages.id
        and h.user_id = (select auth.uid())
    )
    and not exists (
      select 1
      from public.conversation_clears c
      where c.conversation_id = messages.conversation_id
        and c.user_id = (select auth.uid())
        and messages.created_at <= c.cleared_at
    )
  );

-- True when the file belongs to a message the caller could see: one in a conversation
-- they belong to, sent since they joined. The path rule ties every file to its message's
-- conversation (messages_attachment_path_valid).
create function private.can_read_attachment(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.messages msg
    join public.conversation_members m
      on m.conversation_id = msg.conversation_id
     and m.user_id = (select auth.uid())
    where msg.attachment_path = p_object_name
      and msg.created_at >= m.joined_at
  );
$$;

revoke all on function private.can_read_attachment(text) from public, anon;
grant execute on function private.can_read_attachment(text) to authenticated;

-- Was: any member reads every file in the conversation's folder. Now: the files of
-- messages they can see, plus their own uploads while they are a member (a file not sent
-- yet, or one whose message was recalled, so the app can still remove it).
drop policy "attachments: members can read" on storage.objects;

create policy "attachments: members read files of messages they can see"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and (
      private.can_read_attachment(name)
      or (
        owner_id = (select auth.uid())::text
        and private.can_access_attachment(name)
      )
    )
  );

-- 3. One owner per group -------------------------------------------------------------------

create unique index conversation_members_one_owner
  on public.conversation_members (conversation_id)
  where role = 'owner';

-- 4. Removals, for Realtime -----------------------------------------------------------------

-- One row per user and group they were removed from or left; written again (removed_at
-- moves on) each time. Readable only by that user. conversation_id has no foreign key on
-- purpose: the row must outlive a group deleted when its last member leaves.
create table public.conversation_removals (
  user_id uuid not null references public.profiles (id) on delete cascade,
  conversation_id uuid not null,
  removed_at timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

alter table public.conversation_removals enable row level security;
revoke all on table public.conversation_removals from public, anon, authenticated;

-- Read only; rows are written by remove_group_member() and leave_group().
grant select on table public.conversation_removals to authenticated;

create policy "conversation_removals: users read their own"
  on public.conversation_removals for select to authenticated
  using (user_id = (select auth.uid()));

alter publication supabase_realtime add table public.conversation_removals;

-- 5. RPCs -----------------------------------------------------------------------------------

-- Locks the group's row and returns the caller's role in it. Not a group, not existing and
-- not a member all give the same error (P0002), so nothing about other groups leaks.
-- Membership is checked before and after the lock: someone may remove the caller meanwhile.
-- Runs only inside the RPCs below (not SECURITY DEFINER, no client EXECUTE).
create function private.lock_group(p_conversation_id uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_role text;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.conversation_members m
    where m.conversation_id = p_conversation_id
      and m.user_id = v_me
  ) then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;

  perform 1
  from public.conversations c
  where c.id = p_conversation_id
    and c.type = 'group'
  for update;

  if not found then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;

  select m.role into v_role
  from public.conversation_members m
  where m.conversation_id = p_conversation_id
    and m.user_id = v_me;

  if not found then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;

  return v_role;
end;
$$;

revoke all on function private.lock_group(uuid) from public, anon, authenticated;

-- Any member. Same title rules as create_group_conversation. The current title again
-- changes nothing and writes no system message, so a retry is harmless.
create function public.rename_group(p_conversation_id uuid, p_title text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_title text := btrim(coalesce(p_title, ''));
begin
  perform private.lock_group(p_conversation_id);

  if char_length(v_title) not between 1 and 100 or v_title ~ '[[:cntrl:]]' then
    raise exception 'invalid title' using errcode = '22023';
  end if;

  update public.conversations c
  set title = v_title
  where c.id = p_conversation_id
    and c.title is distinct from v_title;

  if found then
    insert into public.messages (conversation_id, sender_id, kind, content, system_event)
    values (p_conversation_id, v_me, 'system', v_title, 'title_changed');
  end if;
end;
$$;

-- Any member. p_user_ids: no nulls, no duplicates, existing users only. Users already in the
-- group (the caller too) are skipped, so a retry is harmless. The group may then have 50
-- members at most (CS002 otherwise, and nobody is added). Returns how many were added.
create function public.add_group_members(p_conversation_id uuid, p_user_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_count integer := coalesce(cardinality(p_user_ids), 0);
  v_added uuid[];
begin
  perform private.lock_group(p_conversation_id);

  if v_count < 1 or v_count > 49 then
    raise exception 'add between 1 and 49 users' using errcode = '22023';
  end if;

  if array_position(p_user_ids, null) is not null then
    raise exception 'user ids must not be null' using errcode = '22023';
  end if;

  if (select count(distinct u) from unnest(p_user_ids) as u) <> v_count then
    raise exception 'duplicate user ids' using errcode = '22023';
  end if;

  if (select count(*) from public.profiles p where p.id = any (p_user_ids)) <> v_count then
    raise exception 'unknown user id' using errcode = '22023';
  end if;

  with added as (
    insert into public.conversation_members (conversation_id, user_id, role)
    select p_conversation_id, u, 'member'
    from unnest(p_user_ids) as u
    where not exists (
      select 1
      from public.conversation_members m
      where m.conversation_id = p_conversation_id
        and m.user_id = u
    )
    returning user_id
  )
  select coalesce(array_agg(a.user_id), '{}') into v_added from added a;

  if (
    select count(*)
    from public.conversation_members m
    where m.conversation_id = p_conversation_id
  ) > 50 then
    raise exception 'a group can have at most 50 members' using errcode = 'CS002';
  end if;

  insert into public.messages (conversation_id, sender_id, kind, system_event, system_target_id)
  select p_conversation_id, v_me, 'system', 'member_added', u
  from unnest(v_added) as u;

  return cardinality(v_added);
end;
$$;

-- Owner only (42501 otherwise), never themselves (they leave instead). Removing someone who
-- is no longer a member changes nothing, so a retry is harmless.
create function public.remove_group_member(p_conversation_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if private.lock_group(p_conversation_id) <> 'owner' then
    raise exception 'only the group owner can remove members' using errcode = '42501';
  end if;

  if p_user_id is null or p_user_id = v_me then
    raise exception 'invalid user' using errcode = '22023';
  end if;

  delete from public.conversation_members m
  where m.conversation_id = p_conversation_id
    and m.user_id = p_user_id;

  if not found then
    return;
  end if;

  insert into public.messages (conversation_id, sender_id, kind, system_event, system_target_id)
  values (p_conversation_id, v_me, 'system', 'member_removed', p_user_id);

  insert into public.conversation_removals (user_id, conversation_id)
  values (p_user_id, p_conversation_id)
  on conflict (user_id, conversation_id) do update set removed_at = excluded.removed_at;
end;
$$;

-- Owner only (42501 otherwise). The new owner must be another member of the group.
create function public.transfer_group_ownership(p_conversation_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if private.lock_group(p_conversation_id) <> 'owner' then
    raise exception 'only the group owner can hand over the group' using errcode = '42501';
  end if;

  if p_user_id is null or p_user_id = v_me then
    raise exception 'invalid user' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.conversation_members m
    where m.conversation_id = p_conversation_id
      and m.user_id = p_user_id
  ) then
    raise exception 'not a member of this group' using errcode = '22023';
  end if;

  -- In this order, so there is never a second owner (conversation_members_one_owner).
  update public.conversation_members m
  set role = 'member'
  where m.conversation_id = p_conversation_id
    and m.user_id = v_me;

  update public.conversation_members m
  set role = 'owner'
  where m.conversation_id = p_conversation_id
    and m.user_id = p_user_id;

  insert into public.messages (conversation_id, sender_id, kind, system_event, system_target_id)
  values (p_conversation_id, v_me, 'system', 'owner_changed', p_user_id);
end;
$$;

-- Any member. An owner hands the group to the member who joined first (ties by user id).
-- The last member deletes the group with all its messages; files stay in Storage.
create function public.leave_group(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_role text := private.lock_group(p_conversation_id);
  v_new_owner uuid;
begin
  if (
    select count(*)
    from public.conversation_members m
    where m.conversation_id = p_conversation_id
  ) = 1 then
    delete from public.conversations c where c.id = p_conversation_id;
  else
    insert into public.messages (conversation_id, sender_id, kind, system_event)
    values (p_conversation_id, v_me, 'system', 'member_left');

    delete from public.conversation_members m
    where m.conversation_id = p_conversation_id
      and m.user_id = v_me;

    if v_role = 'owner' then
      select m.user_id into v_new_owner
      from public.conversation_members m
      where m.conversation_id = p_conversation_id
      order by m.joined_at, m.user_id
      limit 1;

      update public.conversation_members m
      set role = 'owner'
      where m.conversation_id = p_conversation_id
        and m.user_id = v_new_owner;

      insert into public.messages (conversation_id, sender_id, kind, system_event, system_target_id)
      values (p_conversation_id, v_me, 'system', 'owner_changed', v_new_owner);
    end if;
  end if;

  -- Also tells the caller's other tabs.
  insert into public.conversation_removals (user_id, conversation_id)
  values (v_me, p_conversation_id)
  on conflict (user_id, conversation_id) do update set removed_at = excluded.removed_at;
end;
$$;

revoke all on function public.rename_group(uuid, text) from public, anon;
revoke all on function public.add_group_members(uuid, uuid[]) from public, anon;
revoke all on function public.remove_group_member(uuid, uuid) from public, anon;
revoke all on function public.transfer_group_ownership(uuid, uuid) from public, anon;
revoke all on function public.leave_group(uuid) from public, anon;
grant execute on function public.rename_group(uuid, text) to authenticated;
grant execute on function public.add_group_members(uuid, uuid[]) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;
grant execute on function public.transfer_group_ownership(uuid, uuid) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;

commit;
