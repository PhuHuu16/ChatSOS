begin;

create index messages_sender_id_idx on public.messages (sender_id);
create index conversations_created_by_idx on public.conversations (created_by);

commit;
