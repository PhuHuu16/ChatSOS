-- ChatSOS · Phase 1 · migration 4/5: message triggers.
-- Run after 20261016000300_rpc.sql. Wrapped in a transaction.

begin;

-- For image/file messages, the referenced object must already be uploaded to the
-- attachments bucket by the sender, and the declared MIME type and size must match
-- what Storage recorded. Message fields are therefore not free-form client claims.
create function private.validate_message_attachment()
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

-- Keeps conversations.last_message_at current for sorting the chat list.
create function private.touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations c
  set last_message_at = greatest(coalesce(c.last_message_at, new.created_at), new.created_at)
  where c.id = new.conversation_id;

  return null;
end;
$$;

-- Trigger functions: never callable directly.
revoke all on function private.validate_message_attachment() from public, anon, authenticated;
revoke all on function private.touch_conversation() from public, anon, authenticated;

create trigger messages_validate_attachment
  before insert on public.messages
  for each row execute function private.validate_message_attachment();

create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function private.touch_conversation();

commit;
