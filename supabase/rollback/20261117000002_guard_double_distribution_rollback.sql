-- Rollback for 20261117000002_guard_double_distribution.sql. Restores the
-- three functions exactly as they were (no state check, no lock, no fixed
-- search_path).
CREATE OR REPLACE FUNCTION public.close_loan_and_distribute_gain(p_loan_id uuid, p_closing_date date, p_shares jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
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

CREATE OR REPLACE FUNCTION public.close_investment_and_distribute_gain(p_investment_id uuid, p_closing_date date, p_shares jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
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

CREATE OR REPLACE FUNCTION public.distribute_investment_gain(p_investment_id uuid, p_allocation_date date, p_shares jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
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
