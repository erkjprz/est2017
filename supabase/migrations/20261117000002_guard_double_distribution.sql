-- Closing a loan or an investment, or distributing an investment gain, wrote
-- its allocations without checking what state the loan/investment was in and
-- without a lock. Two admins on the same screen, a double tap, or a request
-- retried after a dropped connection would credit every member twice.
-- distribute_bank_interest_group already guards against this; these three
-- now do too. Each takes a row lock first, so a second call waits for the
-- first to finish and then sees what it did.
--
-- All three stay SECURITY INVOKER (row-level security is what limits them to
-- admins) and gain a fixed search_path.

create or replace function public.close_loan_and_distribute_gain(p_loan_id uuid, p_closing_date date, p_shares jsonb)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_status text;
begin
  select status into v_status from loans where loan_id = p_loan_id for update;

  if v_status is null then
    raise exception 'Loan not found.';
  end if;
  if v_status <> 'active' then
    raise exception 'This loan is % -- only an active loan can be closed. It may have just been closed by someone else.', v_status;
  end if;
  if exists (select 1 from loan_gain_allocations where loan_id = p_loan_id) then
    raise exception 'This loan''s gain has already been distributed.';
  end if;

  if jsonb_array_length(p_shares) > 0 then
    insert into loan_gain_allocations (loan_id, member_id, amount, allocation_date, current_value, pct_share, notes)
    select p_loan_id, (s->>'member_id')::uuid, (s->>'amount')::numeric, p_closing_date,
           (s->>'current_value')::numeric, (s->>'pct_share')::numeric, s->>'notes'
    from jsonb_array_elements(p_shares) as s;

    insert into transactions (member_id, bank_account_id, loan_id, classification, affects_cash, amount, description, status)
    select (s->>'member_id')::uuid, null, p_loan_id, 'Gain Allocation', 0, (s->>'amount')::numeric, s->>'description', 'approved'
    from jsonb_array_elements(p_shares) as s;
  end if;

  update loans set status = 'closed' where loan_id = p_loan_id;
end;
$function$;

create or replace function public.close_investment_and_distribute_gain(p_investment_id uuid, p_closing_date date, p_shares jsonb)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_status text;
begin
  select status into v_status from investments where investment_id = p_investment_id for update;

  if v_status is null then
    raise exception 'Investment not found.';
  end if;
  if v_status <> 'open' then
    raise exception 'This investment is already closed. It may have just been closed by someone else.';
  end if;

  if jsonb_array_length(p_shares) > 0 then
    insert into investment_allocations (investment_id, member_id, allocation_type, amount, allocation_date, current_value, pct_share, notes, is_closing_distribution)
    select p_investment_id, (s->>'member_id')::uuid, s->>'allocation_type', (s->>'amount')::numeric,
           p_closing_date, (s->>'current_value')::numeric, (s->>'pct_share')::numeric, s->>'notes', true
    from jsonb_array_elements(p_shares) as s;

    insert into transactions (member_id, bank_account_id, investment_id, classification, affects_cash, amount, description, status, is_closing_distribution)
    select (s->>'member_id')::uuid, null, p_investment_id, 'Gain Allocation', 0,
      case when s->>'allocation_type' = 'Investment Loss' then -(s->>'amount')::numeric else (s->>'amount')::numeric end,
      s->>'description', 'approved', true
    from jsonb_array_elements(p_shares) as s
    where (s->>'amount')::numeric != 0;
  end if;

  update investments set status = 'closed', closed_date = p_closing_date where investment_id = p_investment_id;
end;
$function$;

-- An investment can be distributed against any number of times, so there is
-- no status to check. What a repeat looks like instead: the same signed
-- total, for the same investment and date, recorded in the last ten minutes.
-- A deliberate second distribution of the same amount goes through once that
-- window has passed, or straight away under a different date.
create or replace function public.distribute_investment_gain(p_investment_id uuid, p_allocation_date date, p_shares jsonb)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_new_total numeric;
  v_recent_total numeric;
begin
  perform 1 from investments where investment_id = p_investment_id for update;
  if not found then
    raise exception 'Investment not found.';
  end if;

  select coalesce(sum(case when s->>'allocation_type' = 'Investment Loss' then -(s->>'amount')::numeric else (s->>'amount')::numeric end), 0)
  into v_new_total
  from jsonb_array_elements(p_shares) as s;

  select sum(case when allocation_type = 'Investment Loss' then -amount else amount end)
  into v_recent_total
  from investment_allocations
  where investment_id = p_investment_id
    and allocation_date = p_allocation_date
    and is_closing_distribution = false
    and created_at > now() - interval '10 minutes';

  if v_recent_total is not null and v_recent_total = v_new_total then
    raise exception 'This distribution was already recorded a moment ago. Check the investment''s history before trying again.';
  end if;

  insert into investment_allocations (investment_id, member_id, allocation_type, amount, allocation_date, current_value, pct_share, notes)
  select p_investment_id, (s->>'member_id')::uuid, s->>'allocation_type', (s->>'amount')::numeric,
         p_allocation_date, (s->>'current_value')::numeric, (s->>'pct_share')::numeric, s->>'notes'
  from jsonb_array_elements(p_shares) as s;

  insert into transactions (member_id, bank_account_id, investment_id, classification, affects_cash, amount, description, status)
  select (s->>'member_id')::uuid, null, p_investment_id, 'Gain Allocation', 0,
    case when s->>'allocation_type' = 'Investment Loss' then -(s->>'amount')::numeric else (s->>'amount')::numeric end,
    s->>'description', 'approved'
  from jsonb_array_elements(p_shares) as s
  where (s->>'amount')::numeric != 0;
end;
$function$;
