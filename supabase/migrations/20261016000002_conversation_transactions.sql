-- A conversation can be about one transaction ("Ask about this" on a
-- transaction's detail sheet). The link is optional and set when the
-- thread is opened; if the transaction is later deleted the thread stays
-- and just loses the link.
--
-- New overloads with a trailing p_transaction_id carry the link; the
-- existing two/three-argument functions are left in place (they're what
-- the currently deployed app calls) and now delegate with a null link.

alter table public.conversations
  add column if not exists transaction_id uuid
  references public.transactions(transaction_id) on delete set null;

create index if not exists conversations_transaction_id_idx
  on public.conversations (transaction_id)
  where transaction_id is not null;

-- Whether p_member_id can see p_transaction_id -- the same rule as the
-- transactions_select policy, evaluated for the thread's member rather
-- than the caller. A link is only accepted when it is, so the member on
-- the thread never gets a link to a row they can't open.
create or replace function public.transaction_visible_to_member(p_member_id uuid, p_transaction_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.transactions t
    join public.members m on m.member_id = p_member_id and m.status = 'approved'
    where t.transaction_id = p_transaction_id
      and (
        m.role <> 'borrower'
        or t.member_id = p_member_id
        or t.loan_id in (
          select l.loan_id from public.loans l
          where l.member_id = p_member_id
             or l.borrower_id in (select b.borrower_id from public.borrowers b where b.member_id = p_member_id)
        )
      )
  );
$$;

create or replace function public.open_conversation(p_member_id uuid, p_subject text, p_transaction_id uuid)
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

  if p_transaction_id is not null and not public.transaction_visible_to_member(p_member_id, p_transaction_id) then
    raise exception 'That transaction can''t be linked to this conversation.';
  end if;

  insert into public.conversations (member_id, subject, created_by, transaction_id)
  values (p_member_id, btrim(p_subject), v_me, p_transaction_id)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.start_conversation(p_member_id uuid, p_subject text, p_body text, p_transaction_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  v_id := public.open_conversation(p_member_id, p_subject, p_transaction_id);

  insert into public.conversation_messages (conversation_id, sender_id, body)
  values (v_id, current_member_id(), btrim(p_body));

  return v_id;
end;
$$;

create or replace function public.open_conversation(p_member_id uuid, p_subject text)
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.open_conversation(p_member_id, p_subject, null::uuid);
$$;

create or replace function public.start_conversation(p_member_id uuid, p_subject text, p_body text)
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.start_conversation(p_member_id, p_subject, p_body, null::uuid);
$$;

revoke execute on function public.transaction_visible_to_member(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.open_conversation(uuid, text, uuid) from public, anon;
revoke execute on function public.start_conversation(uuid, text, text, uuid) from public, anon;
grant execute on function public.open_conversation(uuid, text, uuid) to authenticated;
grant execute on function public.start_conversation(uuid, text, text, uuid) to authenticated;
