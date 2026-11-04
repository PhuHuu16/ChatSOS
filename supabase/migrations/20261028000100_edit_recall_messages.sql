begin;

alter table public.messages
  add column edited_at timestamptz,
  add column deleted_at timestamptz;

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

alter table public.messages add constraint messages_edited_text_only check (
  edited_at is null or kind = 'text'
);

grant update (content, deleted_at) on table public.messages to authenticated;

create policy "messages: senders change their own"
  on public.messages for update to authenticated
  using (
    sender_id = (select auth.uid())
    and private.is_member(conversation_id)
  )
  with check (
    sender_id = (select auth.uid())
    and private.is_member(conversation_id)
  );

-- Sửa / thu hồi tin nhắn
create function private.guard_message_update()
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

revoke all on function private.guard_message_update() from public, anon, authenticated;

create trigger messages_guard_update
  before update on public.messages
  for each row execute function private.guard_message_update();

create function private.attachment_unused(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.messages m
    where m.attachment_path = p_object_name
  );
$$;

revoke all on function private.attachment_unused(text) from public, anon;
grant execute on function private.attachment_unused(text) to authenticated;

create policy "attachments: uploaders delete unused files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and owner_id = (select auth.uid())::text
    and private.attachment_unused(name)
  );

commit;
