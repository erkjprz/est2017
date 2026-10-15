-- Proof of transfer can now be several photos instead of one.
--
-- transactions.receipt_urls holds every attached file, in the order they
-- were added. receipt_url stays as a mirror of the first one so everything
-- that still reads or writes the single column keeps working unchanged:
-- validate_member_transaction's "Attach a receipt" check, the Telegram /
-- notification triggers, approve_loan_release's p_receipt_url (the app
-- sets the rest of a loan release's files right after), and any
-- client still running the previous build mid-deploy.

alter table public.transactions
  add column if not exists receipt_urls text[] not null default '{}';

update public.transactions
set receipt_urls = array[receipt_url]
where receipt_url is not null and receipt_urls = '{}';

-- Keeps the two columns in step. Whichever one the write changed wins:
-- a write to receipt_urls sets receipt_url to its first entry, a write to
-- only receipt_url (old clients, existing RPCs) replaces the list with
-- just that file. Named so it fires before trg_track_* / trg_validate_*
-- (same-timing triggers run alphabetically), so validation sees the
-- synced receipt_url.
create or replace function public.sync_transaction_receipts()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.receipt_urls := coalesce(array_remove(new.receipt_urls, null), '{}');

  if tg_op = 'INSERT' then
    if cardinality(new.receipt_urls) > 0 then
      new.receipt_url := new.receipt_urls[1];
    elsif new.receipt_url is not null then
      new.receipt_urls := array[new.receipt_url];
    end if;
  elsif new.receipt_urls is distinct from old.receipt_urls then
    new.receipt_url := new.receipt_urls[1];
  elsif new.receipt_url is distinct from old.receipt_url then
    new.receipt_urls := case when new.receipt_url is null then '{}'::text[] else array[new.receipt_url] end;
  end if;

  return new;
end;
$function$;

create or replace trigger trg_sync_transaction_receipts
before insert or update on public.transactions
for each row
execute function public.sync_transaction_receipts();

create index if not exists transactions_receipt_urls_idx
  on public.transactions using gin (receipt_urls);

-- A file is in use if it's any of a transaction's receipts, not just the
-- first -- otherwise the delete policy would let a second photo be
-- removed out from under the transaction it's attached to.
create or replace function public.receipt_file_in_use(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.transactions where receipt_urls @> array[p_name])
      or exists (select 1 from public.transactions where receipt_url = p_name)
      or exists (select 1 from public.transactions where payout_qr_path = p_name)
      or exists (select 1 from public.loans where payout_qr_path = p_name);
$$;

-- Reopening returns the deleted rows' receipt files so the client can
-- remove them from storage -- now every file, not just the first.
create or replace function public.reopen_investment(p_investment_id uuid)
returns text[]
language plpgsql
as $function$
declare
  v_receipt_urls text[];
begin
  delete from investment_allocations
  where investment_id = p_investment_id and is_closing_distribution = true;

  with deleted as (
    delete from transactions
    where investment_id = p_investment_id
      and classification = 'Gain Allocation'
      and is_closing_distribution = true
    returning receipt_urls
  )
  select array_agg(u) into v_receipt_urls from deleted, unnest(deleted.receipt_urls) as u;

  update investments set status = 'open', closed_date = null where investment_id = p_investment_id;

  return coalesce(v_receipt_urls, array[]::text[]);
end;
$function$;

create or replace function public.reopen_loan(p_loan_id uuid)
returns text[]
language plpgsql
as $function$
declare
  v_receipt_urls text[];
begin
  -- Unlike an investment, a loan only ever distributes once, at close --
  -- every loan_gain_allocations/Gain Allocation row for this loan_id
  -- belongs to that single closing event, so no is_closing_distribution
  -- flag is needed to scope the delete the way reopen_investment needs one.
  delete from loan_gain_allocations where loan_id = p_loan_id;

  with deleted as (
    delete from transactions
    where loan_id = p_loan_id and classification = 'Gain Allocation'
    returning receipt_urls
  )
  select array_agg(u) into v_receipt_urls from deleted, unnest(deleted.receipt_urls) as u;

  update loans set status = 'active' where loan_id = p_loan_id;

  return coalesce(v_receipt_urls, array[]::text[]);
end;
$function$;
