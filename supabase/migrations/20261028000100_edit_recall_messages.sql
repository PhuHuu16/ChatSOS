-- ChatSOS · Phase 7 · migration 6: editing and recalling messages.
-- Run after 20261016000500_storage_realtime.sql. Wrapped in a transaction.
--
-- Senders may edit the text of their own text messages and recall (delete) any of
-- their own messages, within 2 minutes of sending them. A recalled message keeps its row, so the conversation's order,
-- read markers and unread counts are unchanged, but its content and attachment
-- fields are cleared: nothing of it remains readable, also not over Realtime.

begin;

alter table public.messages
  add column edited_at timestamptz,
  add column deleted_at timestamptz;

-- Same as before, plus a third shape: a recalled message has no content and no attachment.
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

-- Only text messages can have been edited.
alter table public.messages add constraint messages_edited_text_only check (
  edited_at is null or kind = 'text'
);

-- Clients may change only these two columns; the trigger below decides what they mean.
-- edited_at is deliberately absent: it always comes from the trigger.
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

-- Turns a client update into an edit or a recall, with server timestamps.
--   * A recalled message is final: any further update leaves it unchanged, so
--     repeating a recall (e.g. after a lost reply) is harmless.
--   * Otherwise a message can be changed only within 2 minutes of being sent
--     (server clock); later attempts fail with SQLSTATE CS001.
--   * deleted_at set: recall. The given time is replaced by now(); content and
--     attachment are cleared.
--   * content changed: edit, text messages only. The check constraints validate it
--     like a new message (visible text, at most 4000 characters).
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

-- True when no message refers to the stored file (never sent, or its message was
-- recalled). SECURITY DEFINER so the answer does not depend on what the caller can read.
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

-- Uploaders may remove their own files once no message uses them: after a recall, or
-- when a message that failed to send is discarded. Files in use can never be removed,
-- and there is still no UPDATE policy, so files cannot be overwritten.
create policy "attachments: uploaders delete unused files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and owner_id = (select auth.uid())::text
    and private.attachment_unused(name)
  );

commit;
