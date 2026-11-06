begin;

-- Trạng thái đang nhập
create function private.can_use_typing_topic(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_topic ~ '^typing:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and exists (
      select 1
      from public.conversation_members m
      where m.user_id = (select auth.uid())
        and m.conversation_id::text = substring(p_topic from 8)
    );
$$;

revoke all on function private.can_use_typing_topic(text) from public, anon;
grant execute on function private.can_use_typing_topic(text) to authenticated;

create policy "realtime: members receive typing"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and private.can_use_typing_topic((select realtime.topic()))
  );

create policy "realtime: members send typing"
  on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and private.can_use_typing_topic((select realtime.topic()))
  );

alter publication supabase_realtime add table public.conversation_members;

commit;
