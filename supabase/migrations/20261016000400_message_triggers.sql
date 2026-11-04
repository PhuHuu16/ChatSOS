begin;

-- Kiểm tra tệp đính kèm
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

-- Cập nhật thời gian cuộc trò chuyện
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

revoke all on function private.validate_message_attachment() from public, anon, authenticated;
revoke all on function private.touch_conversation() from public, anon, authenticated;

create trigger messages_validate_attachment
  before insert on public.messages
  for each row execute function private.validate_message_attachment();

create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function private.touch_conversation();

commit;
