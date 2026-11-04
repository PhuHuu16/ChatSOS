begin;

create schema private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- Bảng cuộc trò chuyện
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null
    constraint conversations_type_valid check (type in ('direct', 'group')),
  title text,
  direct_key text unique
    constraint conversations_direct_key_format check (
      direct_key is null
      or direct_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint conversations_shape check (
    (type = 'direct' and title is null and direct_key is not null)
    or (
      type = 'group'
      and direct_key is null
      and title is not null
      and char_length(title) <= 100
      and char_length(btrim(title)) >= 1
      and title !~ '[[:cntrl:]]'
    )
  )
);

-- Bảng thành viên
create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member'
    constraint conversation_members_role_valid check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  primary key (conversation_id, user_id)
);

create index conversation_members_user_id_idx on public.conversation_members (user_id);

-- Bảng tin nhắn
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind text not null
    constraint messages_kind_valid check (kind in ('text', 'image', 'file')),
  content text not null default ''
    constraint messages_content_length check (char_length(content) <= 4000),
  attachment_path text,
  attachment_name text,
  attachment_size bigint,
  attachment_mime text,
  created_at timestamptz not null default now(),

  constraint messages_kind_consistency check (
    (
      kind = 'text'
      and content ~ '[^[:space:]]'
      and attachment_path is null
      and attachment_name is null
      and attachment_size is null
      and attachment_mime is null
    )
    or (
      kind in ('image', 'file')
      and attachment_path is not null
      and attachment_name is not null
      and attachment_size is not null
      and attachment_mime is not null
    )
  ),
  constraint messages_attachment_path_valid check (
    attachment_path is null
    or (
      split_part(attachment_path, '/', 1) = conversation_id::text
      and attachment_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|gif|pdf|txt|zip|docx|xlsx|pptx)$'
    )
  ),
  constraint messages_attachment_name_valid check (
    attachment_name is null
    or (
      char_length(attachment_name) between 1 and 255
      and attachment_name !~ '[/\\[:cntrl:]]'
    )
  ),
  constraint messages_attachment_size_valid check (
    attachment_size is null or attachment_size between 1 and 20971520
  ),
  constraint messages_attachment_type_valid check (
    attachment_path is null
    or (substring(attachment_path from '\.([a-z0-9]+)$'), attachment_mime) in (
      ('jpg', 'image/jpeg'),
      ('jpeg', 'image/jpeg'),
      ('png', 'image/png'),
      ('webp', 'image/webp'),
      ('gif', 'image/gif'),
      ('pdf', 'application/pdf'),
      ('txt', 'text/plain'),
      ('zip', 'application/zip'),
      ('zip', 'application/x-zip-compressed'),
      ('docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      ('xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      ('pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    )
  ),
  constraint messages_image_is_image check (
    kind <> 'image' or attachment_mime like 'image/%'
  )
);

create index messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc);

create unique index messages_attachment_path_key
  on public.messages (attachment_path)
  where attachment_path is not null;

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

revoke all on table public.conversations, public.conversation_members, public.messages
  from public, anon, authenticated;

grant select on table public.conversations to authenticated;
grant select on table public.conversation_members to authenticated;
grant update (last_read_at) on table public.conversation_members to authenticated;
grant select on table public.messages to authenticated;
grant insert (
  id,
  conversation_id,
  kind,
  content,
  attachment_path,
  attachment_name,
  attachment_size,
  attachment_mime
) on table public.messages to authenticated;

-- Kiểm tra thành viên
create function private.is_member(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.conversation_members m
    where m.conversation_id = p_conversation_id
      and m.user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_member(uuid) from public, anon;
grant execute on function private.is_member(uuid) to authenticated;

create policy "conversations: members can read"
  on public.conversations for select to authenticated
  using (private.is_member(id));

create policy "conversation_members: members can read the member list"
  on public.conversation_members for select to authenticated
  using (private.is_member(conversation_id));

create policy "conversation_members: users update their own read marker"
  on public.conversation_members for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "messages: members can read"
  on public.messages for select to authenticated
  using (private.is_member(conversation_id));

create policy "messages: members send as themselves"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and private.is_member(conversation_id)
  );

commit;
