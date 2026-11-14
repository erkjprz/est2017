-- Members (and admins) can see the fund's lending policy: the three limits
-- and how much of the fund is out on loan right now, as a percentage.
-- Borrowers get nothing -- with a limit and their own loan they could work
-- out the size of the fund. lending_limits itself stays admin-only; this
-- function hands out just these four numbers.
--
-- loaned_out_pct uses the same definition as the admin lending page: unpaid
-- principal on active loans over (cash in the banks + that principal).

create or replace function public.get_lending_policy()
returns table (
  max_total_loans_pct numeric,
  max_per_borrower_pct numeric,
  max_member_hold_pct numeric,
  loaned_out_pct numeric
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    l.max_total_loans_pct,
    l.max_per_borrower_pct,
    l.max_member_hold_pct,
    round(100 * o.out / nullif(f.total_cash + o.out, 0), 1)
  from public.lending_limits l
  cross join (select coalesce(sum(outstanding), 0) as out from public.v_active_loan_outstanding) o
  cross join (select total_cash from public.v_fund_summary) f
  where exists (
    select 1 from public.members m
    where m.email = (auth.jwt() ->> 'email')
      and m.status = 'approved'
      and m.role in ('member', 'admin')
  );
$function$;

revoke all on function public.get_lending_policy() from public, anon;
grant execute on function public.get_lending_policy() to authenticated;
