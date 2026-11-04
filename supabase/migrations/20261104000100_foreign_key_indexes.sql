-- ChatSOS · migration 13: indexes for two foreign keys.
-- Run after 20261102000100_group_management.sql. Wrapped in a transaction.
--
-- messages.sender_id and conversations.created_by point at profiles. Without an index,
-- deleting an account reads every message and every conversation to find that user's
-- rows. No data, policy or grant changes.

begin;

create index messages_sender_id_idx on public.messages (sender_id);
create index conversations_created_by_idx on public.conversations (created_by);

commit;
