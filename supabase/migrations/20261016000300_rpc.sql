-- ChatSOS · Phase 1 · migration 3/5: RPCs that create conversations.
-- Clients have no INSERT privilege on conversations / conversation_members,
-- so these validated functions are the only way to create them.
-- Run after 20261016000200_conversations.sql. Wrapped in a transaction.

begin;

-- Returns the direct chat between the caller and p_other_user_id, creating it if needed.
-- Concurrent calls for the same pair converge on one row thanks to the unique direct_key.
create function public.create_direct_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_key text;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_other_user_id is null or p_other_user_id = v_me then
    raise exception 'invalid user' using errcode = '22023';
  end if;

  if not exists (select 1 from public.profiles p where p.id = p_other_user_id) then
    raise exception 'user not found' using errcode = '22023';
  end if;

  v_key := least(v_me::text, p_other_user_id::text) || ':' || greatest(v_me::text, p_other_user_id::text);

  -- If another transaction is inserting the same key, this waits for it and then
  -- does nothing; the select below then sees the committed row.
  insert into public.conversations (type, direct_key, created_by)
  values ('direct', v_key, v_me)
  on conflict (direct_key) do nothing
  returning id into v_id;

  if v_id is null then
    select c.id into v_id
    from public.conversations c
    where c.direct_key = v_key;
  else
    insert into public.conversation_members (conversation_id, user_id, role)
    values (v_id, v_me, 'member'), (v_id, p_other_user_id, 'member');
  end if;

  return v_id;
end;
$$;

-- Creates a group owned by the caller. p_member_ids lists the OTHER members:
-- no nulls, no duplicates, not the caller, all existing users; 50 people max including the caller.
create function public.create_group_conversation(p_title text, p_member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_title text := btrim(coalesce(p_title, ''));
  v_count integer := coalesce(cardinality(p_member_ids), 0);
  v_id uuid;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if char_length(v_title) not between 1 and 100 or v_title ~ '[[:cntrl:]]' then
    raise exception 'invalid title' using errcode = '22023';
  end if;

  if v_count < 1 then
    raise exception 'a group needs at least one other member' using errcode = '22023';
  end if;

  if v_count + 1 > 50 then
    raise exception 'a group can have at most 50 members' using errcode = '22023';
  end if;

  if array_position(p_member_ids, null) is not null then
    raise exception 'member ids must not be null' using errcode = '22023';
  end if;

  if v_me = any (p_member_ids) then
    raise exception 'do not include yourself in member ids' using errcode = '22023';
  end if;

  if (select count(distinct m) from unnest(p_member_ids) as m) <> v_count then
    raise exception 'duplicate member ids' using errcode = '22023';
  end if;

  if (select count(*) from public.profiles p where p.id = any (p_member_ids)) <> v_count then
    raise exception 'unknown member id' using errcode = '22023';
  end if;

  insert into public.conversations (type, title, created_by)
  values ('group', v_title, v_me)
  returning id into v_id;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (v_id, v_me, 'owner');

  insert into public.conversation_members (conversation_id, user_id, role)
  select v_id, m, 'member'
  from unnest(p_member_ids) as m;

  return v_id;
end;
$$;

revoke all on function public.create_direct_conversation(uuid) from public, anon;
revoke all on function public.create_group_conversation(text, uuid[]) from public, anon;
grant execute on function public.create_direct_conversation(uuid) to authenticated;
grant execute on function public.create_group_conversation(text, uuid[]) to authenticated;

commit;
