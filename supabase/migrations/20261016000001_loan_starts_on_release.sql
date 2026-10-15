-- A loan now starts on the day its release is approved, not the day it was
-- requested. Admins approve once the last transfer has gone out (large
-- loans take several days at the bank's per-day transfer limit), so that's
-- the day the borrower actually has the full amount.
--
-- When a pending Loan Release flips to approved, by any path, this sets
-- the release transaction's txn_date and the loan's start_date to today
-- in Manila time -- the same local date the payment reminders use. Due
-- dates and reminders count from start_date, and the bank history shows
-- the money leaving on the day it did. The loan's name ("<member> · YYYY-MM")
-- keeps the request month; it's only a label.

create or replace function public.start_loan_on_release()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  new.txn_date := v_today;
  if new.loan_id is not null then
    update public.loans set start_date = v_today where loan_id = new.loan_id;
  end if;
  return new;
end;
$function$;

create or replace trigger trg_start_loan_on_release
before update on public.transactions
for each row
when (old.status = 'pending' and new.status = 'approved' and new.classification = 'Loan Release')
execute function public.start_loan_on_release();
