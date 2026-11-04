-- ChatSOS · rollback of migration 13 (20261104000100_foreign_key_indexes.sql).
-- Run by hand in the Supabase SQL Editor, only when migration 13 must be undone.
-- Removes the two indexes; no data is changed.

begin;

drop index if exists public.messages_sender_id_idx;
drop index if exists public.conversations_created_by_idx;

commit;
