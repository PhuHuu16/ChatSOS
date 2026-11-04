begin;

lock table public.message_hides, public.conversation_clears in share row exclusive mode;

do $$
declare
  v_hides bigint;
  v_clears bigint;
begin
  select count(*) into v_hides from public.message_hides;
  if v_hides > 0 then
    raise exception 'rollback refused: % hidden message row(s) remain', v_hides
      using errcode = '55000',
            hint = 'Run "delete from public.message_hides;" first if those messages may reappear.';
  end if;

  select count(*) into v_clears from public.conversation_clears;
  if v_clears > 0 then
    raise exception 'rollback refused: % cleared conversation row(s) remain', v_clears
      using errcode = '55000',
            hint = 'Run "delete from public.conversation_clears;" first if those histories may reappear.';
  end if;
end;
$$;

alter publication supabase_realtime set (publish = 'insert, update, delete, truncate');

drop policy "messages: members read what they have not deleted" on public.messages;
create policy "messages: members can read"
  on public.messages for select to authenticated
  using (private.is_member(conversation_id));

drop function public.clear_conversation(uuid);
drop table public.conversation_clears;

drop table public.message_hides;
drop function private.can_hide_message(uuid);

commit;
