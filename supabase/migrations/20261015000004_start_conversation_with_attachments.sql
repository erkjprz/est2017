-- Attachments on a conversation's first message.
--
-- Chat files live under "<conversation_id>/", and the storage policies only
-- let someone upload there once that conversation exists. So starting a
-- thread with files is three steps from the client: open_conversation
-- creates the empty thread, the files upload into its folder, then the
-- first message (text + attachments) is inserted like any other message --
-- which is what fires the notification. If the upload or insert fails,
-- discard_empty_conversation removes the half-made thread again.
-- start_conversation stays the one-step path for text-only threads.

create or replace function public.open_conversation(p_member_id uuid, p_subject text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := current_member_id();
  v_id uuid;
begin
  if v_me is null then
    raise exception 'Not signed in.';
  end if;

  if p_member_id is distinct from v_me and not is_admin() then
    raise exception 'You can only start a conversation for yourself.';
  end if;

  if not exists (select 1 from public.members where member_id = p_member_id and status = 'approved') then
    raise exception 'That member isn''t active.';
  end if;

  insert into public.conversations (member_id, subject, created_by)
  values (p_member_id, btrim(p_subject), v_me)
  returning id into v_id;

  return v_id;
end;
$$;

-- Only the thread's creator, and only while nobody has posted in it.
create or replace function public.discard_empty_conversation(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.conversations c
  where c.id = p_conversation_id
    and c.created_by = current_member_id()
    and not exists (select 1 from public.conversation_messages cm where cm.conversation_id = c.id);
end;
$$;

revoke execute on function public.open_conversation(uuid, text) from public, anon;
revoke execute on function public.discard_empty_conversation(uuid) from public, anon;
grant execute on function public.open_conversation(uuid, text) to authenticated;
grant execute on function public.discard_empty_conversation(uuid) to authenticated;
