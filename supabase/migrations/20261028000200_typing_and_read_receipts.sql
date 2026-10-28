-- ChatSOS · Phase 8 · migration 7: "typing…" indicators and read receipts.
-- Run after 20261028000100_edit_recall_messages.sql. Wrapped in a transaction.
--
-- Typing: clients send short-lived Realtime Broadcast events on the private channel
-- "typing:<conversation id>". Nothing is stored. Realtime checks the policies below
-- (on realtime.messages) when a client joins or sends, so only members of that
-- conversation can listen or announce.
--
-- Read receipts: members can already read each other's last_read_at (the
-- conversation_members SELECT policy). Adding the table to the Realtime publication
-- delivers changes at once, to members only (Realtime checks that same policy per
-- subscriber). It also tells a user at once when they are added to a new conversation.

begin;

-- True when the topic is "typing:<uuid>" and the caller is a member of that conversation.
-- Compared as text, so a malformed topic is simply refused instead of raising an error.
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

-- Broadcast only; Presence and anything else on private channels stays refused.
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
