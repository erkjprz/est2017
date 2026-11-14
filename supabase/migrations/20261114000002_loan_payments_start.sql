-- Payments start: an optional date a loan's first monthly payment is due,
-- for a loan released now but repaid later (e.g. a second loan that only
-- starts once the borrower's current one is paid off).
--
-- start_date stays the release date (bank history, gain shares). Payment
-- reminders, the overdue flag and the "next payment" date count from
-- payments_start_date when it's set, and from start_date as before when
-- it's null, so existing loans behave exactly as they did. The term is
-- counted from payments start. Admins set it; the borrower's request form
-- doesn't offer it.

alter table public.loans add column payments_start_date date;

comment on column public.loans.payments_start_date is
  'First monthly payment due date when it is later than the release. Null = schedule counts from start_date.';

-- The first due date still unpaid: payments_start_date itself until a
-- payment covers it, then the usual next due date after the last payment.
-- A payment up to 15 days early counts toward that first due date, the
-- same tolerance loan_next_due_date gives every other due date.
create or replace function public.loan_first_unpaid_due(
  p_last_repayment date,
  p_start date,
  p_payments_start date,
  p_due_day integer
)
returns date
language plpgsql
immutable
set search_path to 'public'
as $function$
begin
  if p_payments_start is not null
     and (p_last_repayment is null or p_last_repayment < p_payments_start - 15) then
    return p_payments_start;
  end if;
  return public.loan_next_due_date(coalesce(p_last_repayment, p_start), p_due_day);
end;
$function$;

-- Expose payments_start_date on v_loan_summary (appended last, as create or
-- replace view requires). security_invoker restated so the replace can't
-- drop it.
create or replace view public.v_loan_summary
with (security_invoker = true) as
 SELECT l.loan_id,
    l.name AS loan,
    l.status,
    l.start_date,
    l.principal,
    l.interest_rate,
    l.term_months,
    l.notes,
    COALESCE(b.name, m.name) AS borrower,
    l.member_id AS borrower_member_id,
    COALESCE(sum(
        CASE
            WHEN t.classification = 'Loan Repayment'::text THEN t.amount
            ELSE 0::numeric
        END), 0::numeric) AS repayment,
    COALESCE(sum(
        CASE
            WHEN t.classification = 'Loan Repayment'::text THEN t.amount
            ELSE 0::numeric
        END), 0::numeric) - l.principal AS gain,
        CASE
            WHEN l.status = 'closed'::text THEN 0::numeric
            ELSE GREATEST(0::numeric, l.principal +
            CASE
                WHEN l.interest_type = 'amount'::text THEN COALESCE(l.interest_amount, 0::numeric)
                ELSE l.principal * COALESCE(l.interest_rate, 0::numeric) / 100::numeric
            END - COALESCE(sum(
            CASE
                WHEN t.classification = 'Loan Repayment'::text THEN t.amount
                ELSE 0::numeric
            END), 0::numeric))
        END AS outstanding,
    COALESCE(lga.closed_date,
        CASE
            WHEN l.status = 'closed'::text THEN max(
            CASE
                WHEN t.classification = 'Loan Repayment'::text THEN t.txn_date
                ELSE NULL::date
            END)
            ELSE NULL::date
        END) AS closed_date,
    l.interest_type,
    l.interest_amount,
    l.principal +
        CASE
            WHEN l.interest_type = 'amount'::text THEN COALESCE(l.interest_amount, 0::numeric)
            ELSE l.principal * COALESCE(l.interest_rate, 0::numeric) / 100::numeric
        END AS total_repayable,
    l.repayment_frequency,
    max(
        CASE
            WHEN t.classification = 'Loan Repayment'::text THEN t.txn_date
            ELSE NULL::date
        END) AS last_repayment_date,
    l.due_day,
    l.due_date,
    l.payments_start_date
   FROM loans l
     LEFT JOIN borrowers b ON b.borrower_id = l.borrower_id
     LEFT JOIN members m ON m.member_id = l.member_id
     LEFT JOIN transactions t ON t.loan_id = l.loan_id AND t.status = 'approved'::text
     LEFT JOIN ( SELECT loan_gain_allocations.loan_id,
            max(loan_gain_allocations.allocation_date) AS closed_date
           FROM loan_gain_allocations
          GROUP BY loan_gain_allocations.loan_id) lga ON lga.loan_id = l.loan_id
  GROUP BY l.loan_id, l.name, l.status, l.start_date, l.principal, l.interest_rate, l.term_months, l.notes, l.repayment_frequency, b.name, m.name, l.member_id, lga.closed_date, l.interest_type, l.interest_amount, l.due_day, l.due_date, l.payments_start_date
  ORDER BY l.start_date;

revoke all on public.v_loan_summary from anon;

-- Reminders count from payments start when one is set. Everything else is
-- unchanged from 20261026000001_lump_sum_due_date.sql.
create or replace function public.send_loan_payment_reminders(
  p_today date default (now() at time zone 'Asia/Manila')::date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_sent integer := 0;
  v_link text;
  v_amount numeric;
  v_amount_text text;
  v_next date;
  v_day date;
  v_missed integer;
  v_days integer;
  v_kind text;
  v_due date;
  v_log_date date;
  v_title text;
  v_body text;
begin
  for r in
    select
      s.loan_id, s.loan, s.repayment_frequency, s.due_day, s.start_date, s.term_months,
      s.total_repayable, s.outstanding, s.last_repayment_date, s.due_date, l.payments_start_date,
      m.member_id as recipient, m.role
    from public.v_loan_summary s
    join public.loans l on l.loan_id = s.loan_id
    left join public.borrowers b on b.borrower_id = l.borrower_id
    join public.members m on m.member_id = coalesce(l.member_id, b.member_id) and m.status = 'approved'
    where s.status = 'active'
      and s.outstanding > 0
      and not exists (
        select 1 from public.transactions t
        where t.loan_id = s.loan_id and t.classification = 'Loan Repayment' and t.status = 'pending'
      )
  loop
    v_link := case when r.role = 'borrower' then '/borrower' else '/fund-breakdown?tab=loans&view=you' end;
    v_kind := null;

    if r.repayment_frequency = 'monthly' and r.due_day is not null then
      v_next := public.loan_first_unpaid_due(r.last_repayment_date, r.start_date, r.payments_start_date, r.due_day);
      v_amount := least(r.outstanding, round(r.total_repayable / nullif(r.term_months, 0), 2));

      -- Checked in this order so at most one reminder goes out per loan per
      -- day. v_next <= day means that due date hasn't been covered yet.
      v_day := p_today + 3;
      if v_day = public.loan_due_date_in_month(extract(year from v_day)::integer, extract(month from v_day)::integer, r.due_day)
         and v_next <= v_day then
        v_kind := 'upcoming';
        v_due := v_day;
      end if;

      v_day := p_today;
      if v_kind is null
         and v_day = public.loan_due_date_in_month(extract(year from v_day)::integer, extract(month from v_day)::integer, r.due_day)
         and v_next <= v_day then
        v_kind := 'due';
        v_due := v_day;
      end if;

      -- Overdue: the day after the first unpaid due date, then every 10
      -- days until it's covered.
      if v_kind is null and v_next < p_today and (p_today - v_next - 1) % 10 = 0 then
        v_kind := 'overdue';
        v_due := v_next;
      end if;
    elsif r.repayment_frequency = 'monthly' then
      -- No due_day: 45-day fallback. Day 46 is the first day the app's
      -- overdue flag shows; repeats every 10 days after.
      -- With a later payments start, count as if released a month before
      -- it, so the first overdue can't come before that first payment.
      v_days := p_today - greatest(coalesce(r.last_repayment_date, r.start_date), r.payments_start_date - 30);
      v_amount := least(r.outstanding, round(r.total_repayable / nullif(r.term_months, 0), 2));
      if v_days > 45 and (v_days - 46) % 10 = 0 then
        v_kind := 'overdue';
        v_due := p_today;
      end if;
    elsif r.repayment_frequency = 'lump_sum' and (r.due_date is not null or r.term_months is not null) then
      v_due := coalesce(r.due_date, (r.start_date + make_interval(months => r.term_months))::date);
      v_amount := r.outstanding;
      v_kind := case
        when p_today = v_due - 3 then 'upcoming'
        when p_today = v_due then 'due'
        when p_today > v_due and (p_today - v_due - 1) % 10 = 0 then 'overdue'
      end;
    end if;

    continue when v_kind is null or v_amount is null;

    -- Overdue reminders repeat for the same due date, so they're logged
    -- under the day they're sent instead.
    v_log_date := case when v_kind = 'overdue' then p_today else v_due end;

    insert into public.loan_payment_reminders (loan_id, due_date, kind)
    values (r.loan_id, v_log_date, v_kind)
    on conflict do nothing;
    continue when not found;

    v_amount_text := '₱' || replace(to_char(v_amount, 'FM999,999,999,990.00'), '.00', '');

    if v_kind = 'upcoming' then
      v_title := 'Loan Payment Due Soon';
      v_body := 'Your ' || v_amount_text || ' payment for ' || r.loan || ' is due on '
        || trim(to_char(v_due, 'Mon FMDD')) || '.';
    elsif v_kind = 'due' then
      v_title := 'Loan Payment Due Today';
      v_body := 'Your ' || v_amount_text || ' payment for ' || r.loan || ' is due today.';
    else
      v_title := 'Loan Payment Overdue';
      if r.repayment_frequency = 'monthly' and r.due_day is null then
        v_missed := 0;
      elsif r.repayment_frequency = 'monthly' then
        -- Every due date from the first unpaid one through yesterday.
        select count(*) into v_missed
        from generate_series(date_trunc('month', v_next), date_trunc('month', p_today - 1), interval '1 month') g
        where public.loan_due_date_in_month(extract(year from g)::integer, extract(month from g)::integer, r.due_day)
              between v_next and p_today - 1;
      else
        v_missed := 1;
      end if;
      v_body := case
        when v_missed = 0 then 'It''s been ' || v_days || ' days since '
          || case when r.last_repayment_date is null then r.loan || ' was released' else 'your last payment on ' || r.loan end
          || '. Your ' || v_amount_text || ' monthly payment is overdue.'
        when v_missed > 1 then r.loan || ' has ' || v_missed || ' missed payments. Please make a repayment as soon as you can.'
        else 'Your ' || v_amount_text || ' payment for ' || r.loan || ' was due on '
          || trim(to_char(v_due, 'Mon FMDD')) || ' and hasn''t been received yet.'
      end;
    end if;

    perform public.create_notification(r.recipient, 'loan_payment_reminder', v_title, v_body, v_link);
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$$;

revoke execute on function public.send_loan_payment_reminders(date) from public, anon, authenticated;

notify pgrst, 'reload schema';
