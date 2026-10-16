-- ChatSOS · Phase 1 · migration 5/5: private attachments bucket and Realtime.
-- Run after 20261016000400_message_triggers.sql. Wrapped in a transaction.

begin;

-- Private bucket: files are only reachable through signed URLs issued to members.
-- allowed_mime_types is enforced by Storage against the upload's Content-Type,
-- which the client chooses, so it is one layer only: object names are also
-- restricted to an extension allowlist below, svg/html are never accepted,
-- and the app must render files as images or downloads, never as HTML.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  20971520,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
    'text/plain',
    'application/zip',
    'application/x-zip-compressed',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
);

-- True when the first folder of the object name is a conversation the caller belongs to.
create function private.can_access_attachment(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.conversation_members m
    where m.user_id = (select auth.uid())
      and m.conversation_id::text = (storage.foldername(p_object_name))[1]
  );
$$;

revoke all on function private.can_access_attachment(text) from public, anon;
grant execute on function private.can_access_attachment(text) to authenticated;

create policy "attachments: members can read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and private.can_access_attachment(name)
  );

-- "<conversation_id>/<uuid>.<extension>" only. There are deliberately no UPDATE or
-- DELETE policies for this bucket, so existing files can be neither overwritten
-- (upsert needs UPDATE) nor removed by clients.
create policy "attachments: members can upload new files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|gif|pdf|txt|zip|docx|xlsx|pptx)$'
    and private.can_access_attachment(name)
  );

-- Postgres Changes for messages. Realtime checks each subscriber's SELECT access
-- (grants + the RLS policy above) before delivering a row, so only members receive
-- it. Being in the publication alone proves nothing: this is verified end to end in step 1D.
alter publication supabase_realtime add table public.messages;

commit;
