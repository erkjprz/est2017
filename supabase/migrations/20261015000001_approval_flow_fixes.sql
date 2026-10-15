-- Approval flow fixes found while testing the member -> admin approval flow.

-- 1. Pending signups couldn't read their own members row.
--
-- current_member_role() / current_member_id() only match *approved*
-- members, so for someone still waiting on approval both clauses were
-- null and the row was invisible -- the app then treated them as an
-- orphaned account ("Your account setup didn't finish") instead of
-- sending them to /waiting. Matching on the JWT email lets anyone read
-- their own row regardless of status; it still exposes nothing else.
alter policy members_select
  on public.members
  using (
    current_member_role() <> 'borrower'
    or member_id = current_member_id()
    or email = (auth.jwt() ->> 'email')
  );

-- 2. Track resubmissions so the admin queue can say "Resubmitted · was
-- ₱2.00" instead of showing the original submission time as if nothing
-- had changed.
alter table public.transactions
  add column if not exists resubmitted_at timestamptz,
  add column if not exists previous_amount numeric;

create or replace function public.track_transaction_resubmit()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if old.status = 'rejected' and new.status = 'pending' then
    new.resubmitted_at := now();
    new.previous_amount := case when new.amount is distinct from old.amount then old.amount end;
  end if;
  return new;
end;
$function$;

create or replace trigger trg_track_transaction_resubmit
before update on public.transactions
for each row
when (old.status = 'rejected' and new.status = 'pending')
execute function public.track_transaction_resubmit();

-- 3. Validate what members (not admins) put into transactions.
--
-- RLS only checked ownership and status = 'pending', so a member calling
-- the API directly could submit a negative "contribution", a fund-level
-- type like Bank Interest, or a withdrawal larger than their balance --
-- leaving the admin's eyes as the only guard. Admin writes and
-- SECURITY DEFINER functions (current_user isn't 'authenticated' there)
-- are untouched; cancelling is always allowed.
create or replace function public.validate_member_transaction()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_available numeric;
  v_pending_out numeric;
begin
  if current_user <> 'authenticated' or public.is_admin() or new.status <> 'pending' then
    return new;
  end if;

  if new.classification not in ('Member Contribution', 'Loan Repayment', 'Member Withdrawal', 'Investment Return', 'Loan Release') then
    raise exception 'Members can''t submit % entries.', new.classification using errcode = 'check_violation';
  end if;

  if new.amount is null or new.amount = 0 then
    raise exception 'Enter an amount.' using errcode = 'check_violation';
  end if;

  if new.classification in ('Member Contribution', 'Loan Repayment', 'Investment Return') and new.amount < 0 then
    raise exception 'The amount must be positive.' using errcode = 'check_violation';
  end if;

  if new.classification in ('Member Withdrawal', 'Loan Release') and new.amount > 0 then
    raise exception 'The amount must be negative for money going out.' using errcode = 'check_violation';
  end if;

  if new.classification in ('Member Contribution', 'Loan Repayment') then
    if new.bank_account_id is null then
      raise exception 'Choose the bank the money went to.' using errcode = 'check_violation';
    end if;
    if new.receipt_url is null or btrim(new.receipt_url) = '' then
      raise exception 'Attach a receipt.' using errcode = 'check_violation';
    end if;
  end if;

  if new.classification = 'Loan Repayment' and not exists (
    select 1 from public.loans l
    where l.loan_id = new.loan_id
      and l.status = 'active'
      and (
        l.member_id = new.member_id
        or l.borrower_id in (select b.borrower_id from public.borrowers b where b.member_id = new.member_id)
      )
  ) then
    raise exception 'Choose one of your active loans.' using errcode = 'check_violation';
  end if;

  if new.classification = 'Loan Release' and not exists (
    select 1 from public.loans l
    where l.loan_id = new.loan_id and l.status = 'requested' and l.member_id = new.member_id
  ) then
    raise exception 'Loan requests must go through the loan request form.' using errcode = 'check_violation';
  end if;

  -- Withdrawals can't exceed what's withdrawable now, less whatever else
  -- this member already has waiting to go out.
  if new.classification = 'Member Withdrawal'
     and (tg_op = 'INSERT' or new.amount is distinct from old.amount or old.status <> 'pending') then
    select coalesce(withdrawable_now, 0) into v_available
    from public.v_member_performance where member_id = new.member_id;

    select coalesce(sum(-t.amount), 0) into v_pending_out
    from public.transactions t
    where t.member_id = new.member_id
      and t.classification = 'Member Withdrawal'
      and t.status = 'pending'
      and t.transaction_id is distinct from new.transaction_id;

    if -new.amount > coalesce(v_available, 0) - v_pending_out then
      raise exception 'That''s more than your available balance (₱%).',
        to_char(greatest(coalesce(v_available, 0) - v_pending_out, 0), 'FM999,999,990.00')
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$function$;

create or replace trigger trg_validate_member_transaction
before insert or update on public.transactions
for each row
execute function public.validate_member_transaction();

-- 4. Decision notifications: say the amount, and link somewhere that exists.
--
-- They pointed at /transactions/<id>/edit, a route that was replaced by
-- the ?editTransaction= sheet -- every tap landed on a 404. A rejected
-- entry opens the edit sheet (to fix and resend); an approved one opens
-- the transaction's detail sheet.
create or replace function public.notify_transaction_decided()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_recipient uuid;
  v_label text;
  v_amount text;
begin
  if old.status = 'pending' and new.status in ('approved', 'rejected') then
    v_recipient := coalesce(new.submitted_by, new.member_id);
    if v_recipient is not null then
      v_label := case new.classification
        when 'Member Contribution' then 'Contribution'
        when 'Member Withdrawal' then 'Withdrawal'
        when 'Loan Repayment' then 'Loan Payment'
        else new.classification
      end;
      v_amount := '₱' || replace(to_char(abs(new.amount), 'FM999,999,999,990.00'), '.00', '');
      perform public.create_notification(
        v_recipient,
        'transaction_' || new.status,
        case when new.status = 'approved' then v_label || ' Approved' else v_label || ' Not Approved' end,
        case
          when new.status = 'approved' then 'Your ' || v_amount || ' ' || lower(v_label) || ' was approved.'
          when new.rejection_reason is not null and btrim(new.rejection_reason) <> '' then
            'Your ' || v_amount || ' ' || lower(v_label) || ' was not approved: ' || new.rejection_reason
          else 'Your ' || v_amount || ' ' || lower(v_label) || ' was not approved.'
        end,
        case
          when new.status = 'approved' then '/transactions?txn=' || new.transaction_id
          else '/transactions?editTransaction=' || new.transaction_id
        end
      );
    end if;
  end if;
  return new;
end;
$function$;

-- Repoint the notifications already sent with the dead links.
update public.notifications
set link = '/transactions?editTransaction=' || substring(link from '^/transactions/([0-9a-f-]{36})/edit$')
where link ~ '^/transactions/[0-9a-f-]{36}/edit$' and type = 'transaction_rejected';

update public.notifications
set link = '/transactions?txn=' || substring(link from '^/transactions/([0-9a-f-]{36})(/edit)?$')
where link ~ '^/transactions/[0-9a-f-]{36}(/edit)?$';
