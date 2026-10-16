-- Undoes 20261016000002_conversation_transactions. The two original
-- functions are restored from their live definitions before the change.
begin;

create or replace function public.open_conversation(p_member_id uuid, p_subject text)
returns uuid language plpgsql security definer set search_path = public
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

create or replace function public.start_conversation(p_member_id uuid, p_subject text, p_body text)
returns uuid language plpgsql security definer set search_path = public
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
  insert into public.conversation_messages (conversation_id, sender_id, body)
  values (v_id, v_me, btrim(p_body));
  return v_id;
end;
$$;

drop function if exists public.start_conversation(uuid, text, text, uuid);
drop function if exists public.open_conversation(uuid, text, uuid);
drop function if exists public.transaction_visible_to_member(uuid, uuid);
drop index if exists public.conversations_transaction_id_idx;
alter table public.conversations drop column if exists transaction_id;

commit;
