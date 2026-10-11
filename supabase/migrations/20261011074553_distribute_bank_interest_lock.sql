-- distribute_bank_interest_group: lock the group's rows before checking
-- interest_distributed. The plain count(*) only stopped sequential repeats --
-- two admins (or a double-tap) running at the same instant both saw "not yet
-- distributed" and both inserted shares, crediting every member twice. With
-- FOR UPDATE the second call waits for the first to commit, then sees the
-- flag and raises.
--
-- Also pins search_path (Supabase advisor: function_search_path_mutable).
-- Still SECURITY INVOKER, same as before; grants are kept by CREATE OR
-- REPLACE. Everything else is unchanged from 20261011000001.
create or replace function public.distribute_bank_interest_group(
  p_bank text,
  p_distribution_date date,
  p_transaction_ids uuid[],
  p_shares jsonb
)
returns void
language plpgsql
set search_path = public
as $function$
declare
  v_already_distributed_count int;
begin
  perform 1 from transactions where transaction_id = any(p_transaction_ids) for update;

  select count(*) into v_already_distributed_count
  from transactions
  where transaction_id = any(p_transaction_ids) and interest_distributed = true;

  if v_already_distributed_count > 0 then
    raise exception 'This bank interest group has already been distributed.';
  end if;

  insert into bank_interest_allocations (member_id, bank, allocation_date, amount, current_value, pct_share, notes)
  select (s->>'member_id')::uuid, p_bank, p_distribution_date, (s->>'amount')::numeric,
         (s->>'current_value')::numeric, (s->>'pct_share')::numeric, s->>'notes'
  from jsonb_array_elements(p_shares) as s;

  insert into transactions (member_id, bank_account_id, classification, affects_cash, amount, description, status, txn_date)
  select (s->>'member_id')::uuid, null, 'Gain Allocation', 0, (s->>'amount')::numeric, s->>'description', 'approved', p_distribution_date
  from jsonb_array_elements(p_shares) as s
  where (s->>'amount')::numeric != 0;

  update transactions set interest_distributed = true where transaction_id = any(p_transaction_ids);
end;
$function$;
