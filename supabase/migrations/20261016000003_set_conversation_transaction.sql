-- Admins can link an existing conversation to a transaction, change the
-- link, or clear it (p_transaction_id null). Same rule as when a thread is
-- opened with a link: the thread's member must be able to see the
-- transaction. A function rather than an update policy, like
-- set_conversation_status, so admins can only ever touch this one column.

create or replace function public.set_conversation_transaction(p_conversation_id uuid, p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id uuid;
begin
  if not is_admin() then
    raise exception 'Only admins can link a conversation to a transaction.';
  end if;

  select member_id into v_member_id from public.conversations where id = p_conversation_id;
  if not found then
    raise exception 'Conversation not found.';
  end if;

  if p_transaction_id is not null and not public.transaction_visible_to_member(v_member_id, p_transaction_id) then
    raise exception 'That transaction can''t be linked to this conversation.';
  end if;

  update public.conversations set transaction_id = p_transaction_id where id = p_conversation_id;
end;
$$;

revoke execute on function public.set_conversation_transaction(uuid, uuid) from public, anon;
grant execute on function public.set_conversation_transaction(uuid, uuid) to authenticated;
