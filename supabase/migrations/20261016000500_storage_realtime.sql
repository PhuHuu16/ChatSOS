begin;

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

-- Quyền truy cập tệp
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

create policy "attachments: members can upload new files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|gif|pdf|txt|zip|docx|xlsx|pptx)$'
    and private.can_access_attachment(name)
  );

alter publication supabase_realtime add table public.messages;

commit;
