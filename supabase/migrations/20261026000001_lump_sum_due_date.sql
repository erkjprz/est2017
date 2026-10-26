-- A lump-sum loan can be due on a date picked outright (e.g. Dec 15)
-- instead of start_date + term_months. Null means "end of the term", the
-- old behaviour, and is always null for monthly loans. Unlike the term,
-- the date stays put when start_date moves to the release day.
-- term_months is still stored for these loans (whole months to the date,
-- rounded up), so anything that only reads the term keeps working.
alter table public.loans
  add column if not exists due_date date;

-- submit_loan_request gains p_due_date. Dropping the old signature first so
-- PostgREST doesn't see two overloads and fail to pick one.
drop function if exists public.submit_loan_request(
  uuid, numeric, text, numeric, numeric, integer, text, date, text, text, uuid, text, text, smallint
);

create or replace function public.submit_loan_request(
  p_member_id uuid,
  p_principal numeric,
  p_interest_type text,
  p_interest_rate numeric,
  p_interest_amount numeric,
  p_term_months integer,
  p_repayment_frequency text,
  p_start_date date,
  p_notes text,
  p_description text,
  p_submitted_by uuid default null,
  p_payout_details text default null,
  p_payout_qr_path text default null,
  p_due_day smallint default null,
  p_due_date date default null
)
returns table(loan_id uuid, transaction_id uuid)
language plpgsql
set search_path to 'public'
as $function$
declare
  v_loan_id uuid;
  v_transaction_id uuid;
  v_base_name text;
  v_name text;
  v_attempt integer := 1;
  v_constraint text;
begin
  select name || ' · ' || to_char(p_start_date, 'YYYY-MM') into v_base_name
  from members where member_id = p_member_id;
  v_name := v_base_name;

  loop
    begin
      insert into loans (
        member_id, name, principal, interest_type, interest_rate, interest_amount,
        term_months, repayment_frequency, status, start_date, notes,
        payout_details, payout_qr_path, due_day, due_date
      ) values (
        p_member_id, v_name, p_principal, p_interest_type, p_interest_rate, p_interest_amount,
        p_term_months, p_repayment_frequency, 'requested', p_start_date, p_notes,
        nullif(btrim(p_payout_details), ''), p_payout_qr_path,
        case when p_repayment_frequency = 'monthly' then p_due_day end,
        case when p_repayment_frequency = 'lump_sum' then p_due_date end
      )
      returning loans.loan_id into v_loan_id;
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'loans_name_key' or v_attempt >= 50 then
        raise;
      end if;
      v_attempt := v_attempt + 1;
      v_name := v_base_name || ' (' || v_attempt || ')';
    end;
  end loop;

  insert into transactions (
    member_id, bank_account_id, loan_id, classification, amount,
    description, receipt_url, status, submitted_by, txn_date
  ) values (
    p_member_id, null, v_loan_id, 'Loan Release', -p_principal,
    p_description, null, 'pending', p_submitted_by, p_start_date
  )
  returning transactions.transaction_id into v_transaction_id;

  return query select v_loan_id, v_transaction_id;
end;
$function$;

grant execute on function public.submit_loan_request(uuid, numeric, text, numeric, numeric, integer, text, date, text, text, uuid, text, text, smallint, date)
  to anon, authenticated, service_role;

-- Expose due_date on v_loan_summary (appended last, as create or replace
-- view requires). security_invoker restated so the replace can't drop it.
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
    l.due_date
   FROM loans l
     LEFT JOIN borrowers b ON b.borrower_id = l.borrower_id
     LEFT JOIN members m ON m.member_id = l.member_id
     LEFT JOIN transactions t ON t.loan_id = l.loan_id AND t.status = 'approved'::text
     LEFT JOIN ( SELECT loan_gain_allocations.loan_id,
            max(loan_gain_allocations.allocation_date) AS closed_date
           FROM loan_gain_allocations
          GROUP BY loan_gain_allocations.loan_id) lga ON lga.loan_id = l.loan_id
  GROUP BY l.loan_id, l.name, l.status, l.start_date, l.principal, l.interest_rate, l.term_months, l.notes, l.repayment_frequency, b.name, m.name, l.member_id, lga.closed_date, l.interest_type, l.interest_amount, l.due_day, l.due_date
  ORDER BY l.start_date;

revoke all on public.v_loan_summary from anon;

-- Lump-sum reminders count from due_date when one is set.
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
      s.total_repayable, s.outstanding, s.last_repayment_date, s.due_date,
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
      v_next := public.loan_next_due_date(coalesce(r.last_repayment_date, r.start_date), r.due_day);
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
      v_days := p_today - coalesce(r.last_repayment_date, r.start_date);
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
