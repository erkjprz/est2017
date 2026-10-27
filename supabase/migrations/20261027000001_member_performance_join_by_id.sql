-- v_member_performance joined v_member_ledger on member *name*, so two
-- members sharing a name (an existing member plus their own pending signup,
-- before an admin links them) each matched both ledger rows. The member then
-- had two performance rows -- one with the real contributions, one with 0 --
-- and every `.single()` read of it (Breakdown, Dashboard's Available Balance)
-- failed with "Cannot coerce the result to a single JSON object".
-- v_member_ledger now also exposes member_id (appended, so existing columns
-- keep their positions) and the join uses it.
--
-- security_invoker is restated on both: create or replace view without a
-- WITH clause resets it, which would make these anon/authenticated-granted
-- views run as their owner and bypass RLS.

create or replace view public.v_member_ledger with (security_invoker = true) as
 SELECT m.name AS member,
    sum(
        CASE
            WHEN (t.classification = 'Member Contribution'::text) THEN t.amount
            ELSE (0)::numeric
        END) AS contribution,
    sum(
        CASE
            WHEN (t.classification = 'Member Withdrawal'::text) THEN t.amount
            ELSE (0)::numeric
        END) AS withdrawal,
    sum(
        CASE
            WHEN (t.classification = ANY (ARRAY['Member Contribution'::text, 'Member Withdrawal'::text])) THEN t.amount
            ELSE (0)::numeric
        END) AS net,
    sum(
        CASE
            WHEN ((t.classification = 'Member Contribution'::text) AND (t.source_sheet = 'tracker'::text)) THEN t.amount
            ELSE (0)::numeric
        END) AS tracker_contribution,
    sum(
        CASE
            WHEN ((t.classification = 'Member Withdrawal'::text) AND (t.source_sheet = 'tracker'::text)) THEN t.amount
            ELSE (0)::numeric
        END) AS tracker_withdrawal,
    m.member_id
   FROM (members m
     LEFT JOIN transactions t ON (((t.member_id = m.member_id) AND (t.status = 'approved'::text))))
  GROUP BY m.member_id, m.name
  ORDER BY m.name;

create or replace view public.v_member_performance with (security_invoker = true) as
 SELECT m.member_id,
    m.name AS member,
    COALESCE(ml.contribution, (0)::numeric) AS total_contribution,
    COALESCE(ml.withdrawal, (0)::numeric) AS total_withdrawal,
    COALESCE(ml.net, (0)::numeric) AS net_contribution,
    COALESCE(bi.bank_interest, (0)::numeric) AS bank_interest,
    COALESCE(inv.investment_gain_loss, (0)::numeric) AS investment_gain_loss,
    COALESCE(lg.loan_gain, (0)::numeric) AS loan_gain,
    COALESCE(wo.bank_writeoff, (0)::numeric) AS bank_writeoff,
    ((((COALESCE(ml.net, (0)::numeric) + COALESCE(bi.bank_interest, (0)::numeric)) + COALESCE(inv.investment_gain_loss, (0)::numeric)) + COALESCE(lg.loan_gain, (0)::numeric)) + COALESCE(wo.bank_writeoff, (0)::numeric)) AS total_value,
    (COALESCE(hold.money_on_hold, (0)::numeric) + COALESCE(inv_hold.money_on_hold, (0)::numeric)) AS money_on_hold,
    (((((COALESCE(ml.net, (0)::numeric) + COALESCE(bi.bank_interest, (0)::numeric)) + COALESCE(inv.investment_gain_loss, (0)::numeric)) + COALESCE(lg.loan_gain, (0)::numeric)) + COALESCE(wo.bank_writeoff, (0)::numeric)) - (COALESCE(hold.money_on_hold, (0)::numeric) + COALESCE(inv_hold.money_on_hold, (0)::numeric))) AS withdrawable_now
   FROM (((((((members m
     LEFT JOIN v_member_ledger ml ON ((ml.member_id = m.member_id)))
     LEFT JOIN ( SELECT bank_interest_allocations.member_id,
            sum(bank_interest_allocations.amount) AS bank_interest
           FROM bank_interest_allocations
          GROUP BY bank_interest_allocations.member_id) bi ON ((bi.member_id = m.member_id)))
     LEFT JOIN ( SELECT investment_allocations.member_id,
            sum(
                CASE
                    WHEN (investment_allocations.allocation_type = 'Investment Loss'::text) THEN (- investment_allocations.amount)
                    ELSE investment_allocations.amount
                END) AS investment_gain_loss
           FROM investment_allocations
          GROUP BY investment_allocations.member_id) inv ON ((inv.member_id = m.member_id)))
     LEFT JOIN ( SELECT loan_gain_allocations.member_id,
            sum(loan_gain_allocations.amount) AS loan_gain
           FROM loan_gain_allocations
          GROUP BY loan_gain_allocations.member_id) lg ON ((lg.member_id = m.member_id)))
     LEFT JOIN ( SELECT transactions.member_id,
            sum(transactions.amount) AS bank_writeoff
           FROM transactions
          WHERE ((transactions.classification = 'Bank Write-off'::text) AND (transactions.status = 'approved'::text) AND (transactions.member_id IS NOT NULL))
          GROUP BY transactions.member_id) wo ON ((wo.member_id = m.member_id)))
     LEFT JOIN v_member_loan_hold hold ON ((hold.member_id = m.member_id)))
     LEFT JOIN v_member_investment_hold inv_hold ON ((inv_hold.member_id = m.member_id)));
