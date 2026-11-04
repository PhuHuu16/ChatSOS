begin;

-- Bảng tin nhắn đã ẩn
create table public.message_hides (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (user_id, message_id)
);

create index message_hides_message_id_idx on public.message_hides (message_id);

alter table public.message_hides enable row level security;
revoke all on table public.message_hides from public, anon, authenticated;

grant select on table public.message_hides to authenticated;
grant insert (message_id) on table public.message_hides to authenticated;

create function private.can_hide_message(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.messages m
    join public.conversation_members cm on cm.conversation_id = m.conversation_id
    where m.id = p_message_id
      and cm.user_id = (select auth.uid())
  );
$$;

revoke all on function private.can_hide_message(uuid) from public, anon;
grant execute on function private.can_hide_message(uuid) to authenticated;

create policy "message_hides: users read their own"
  on public.message_hides for select to authenticated
  using (user_id = (select auth.uid()));

create policy "message_hides: members hide messages for themselves"
  on public.message_hides for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and private.can_hide_message(message_id)
  );

-- Bảng xóa cuộc trò chuyện
create table public.conversation_clears (
  user_id uuid not null references public.profiles (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  cleared_at timestamptz not null,
  primary key (user_id, conversation_id)
);

create index conversation_clears_conversation_id_idx
  on public.conversation_clears (conversation_id);

alter table public.conversation_clears enable row level security;
revoke all on table public.conversation_clears from public, anon, authenticated;

grant select on table public.conversation_clears to authenticated;

create policy "conversation_clears: users read their own"
  on public.conversation_clears for select to authenticated
  using (user_id = (select auth.uid()));

-- Xóa cuộc trò chuyện
create function public.clear_conversation(p_conversation_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_cleared_at timestamptz;
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

  insert into public.conversation_clears (user_id, conversation_id, cleared_at)
  values (v_me, p_conversation_id, now())
  on conflict (user_id, conversation_id) do update
    set cleared_at = greatest(public.conversation_clears.cleared_at, excluded.cleared_at)
  returning cleared_at into v_cleared_at;

  return v_cleared_at;
end;
$$;

revoke all on function public.clear_conversation(uuid) from public, anon;
grant execute on function public.clear_conversation(uuid) to authenticated;

drop policy "messages: members can read" on public.messages;

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

alter publication supabase_realtime set (publish = 'insert, update, truncate');

commit;
