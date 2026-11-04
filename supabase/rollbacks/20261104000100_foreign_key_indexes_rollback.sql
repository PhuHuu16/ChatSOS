begin;

drop index if exists public.messages_sender_id_idx;
drop index if exists public.conversations_created_by_idx;

commit;
