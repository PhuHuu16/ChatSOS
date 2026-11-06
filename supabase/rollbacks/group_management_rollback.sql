begin;

lock table public.messages, public.conversation_removals in share row exclusive mode;

do $$
declare
  v_system bigint;
begin
  select count(*) into v_system from public.messages where kind = 'system';
  if v_system > 0 then
    raise exception 'rollback refused: % system message(s) remain', v_system
      using errcode = '55000',
            hint = 'Run "delete from public.messages where kind = ''system'';" first if those lines may go.';
  end if;
end;
$$;

drop function public.leave_group(uuid);
drop function public.transfer_group_ownership(uuid, uuid);
drop function public.remove_group_member(uuid, uuid);
drop function public.add_group_members(uuid, uuid[]);
drop function public.rename_group(uuid, text);
drop function private.lock_group(uuid);

alter publication supabase_realtime drop table public.conversation_removals;
drop table public.conversation_removals;

drop index public.conversation_members_one_owner;

drop policy "attachments: members read files of messages they can see" on storage.objects;
create policy "attachments: members can read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and private.can_access_attachment(name)
  );
drop function private.can_read_attachment(text);

drop policy "messages: members read what was sent since they joined" on public.messages;
create policy "messages: members read what they have not deleted"
  on public.messages for select to authenticated
  using (
    private.is_member(conversation_id)
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
drop function private.member_since(uuid);

create or replace function private.guard_message_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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
  if new.kind = 'text' then
    return new;
  end if;

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

drop policy "messages: members send as themselves" on public.messages;
create policy "messages: members send as themselves"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and private.is_member(conversation_id)
  );

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
  )
  or (
    deleted_at is null
    and kind in ('image', 'file')
    and attachment_path is not null
    and attachment_name is not null
    and attachment_size is not null
    and attachment_mime is not null
  )
  or (
    deleted_at is not null
    and content = ''
    and attachment_path is null
    and attachment_name is null
    and attachment_size is null
    and attachment_mime is null
  )
);

alter table public.messages drop constraint messages_kind_valid;
alter table public.messages add constraint messages_kind_valid check (
  kind in ('text', 'image', 'file')
);

drop index public.messages_system_target_id_idx;
alter table public.messages
  drop column system_target_id,
  drop column system_event;

commit;
