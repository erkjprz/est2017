-- Performance: evaluate RLS helper functions once per query instead of once per row,
-- and index every foreign key that had no covering index.
--
-- 1. Every public RLS policy called current_member_role() / current_member_id() /
--    current_borrower_id() / is_admin() / auth.jwt() bare. Those helpers are
--    SECURITY DEFINER, so Postgres can't inline them and re-runs each one (a lookup
--    on members) for every row it checks -- members had been seq-scanned ~25.6M
--    times. Wrapping each call as (SELECT fn()) turns it into an InitPlan that runs
--    once per statement. The helpers take no arguments and are STABLE, so the
--    result is identical; only names/roles/commands are untouched (ALTER POLICY).
--    Measured on v_fund_summary as an admin: 21 ms -> ~3 ms.
--
-- 2. Covering indexes for the 21 foreign keys the Supabase performance advisor
--    flagged as unindexed (single-column, all on small tables).
--
-- Rollback: supabase/rollback/20261016000001_rls_initplan_and_fk_indexes_rollback.sql

ALTER POLICY bank_accounts_select ON public.bank_accounts
  USING (((SELECT current_member_role()) IS NOT NULL));

ALTER POLICY bank_accounts_write ON public.bank_accounts
  USING ((SELECT is_admin()))
  WITH CHECK ((SELECT is_admin()));

ALTER POLICY "Allow approved users to read bank interest allocations" ON public.bank_interest_allocations
  USING ((((SELECT current_member_role()) <> 'borrower'::text) OR (member_id = (SELECT current_member_id()))));

ALTER POLICY bank_interest_allocations_write ON public.bank_interest_allocations
  USING ((SELECT is_admin()))
  WITH CHECK ((SELECT is_admin()));

ALTER POLICY borrowers_select ON public.borrowers
  USING ((((SELECT current_member_role()) <> 'borrower'::text) OR (member_id = (SELECT current_member_id()))));

ALTER POLICY borrowers_write ON public.borrowers
  USING ((SELECT is_admin()))
  WITH CHECK ((SELECT is_admin()));

ALTER POLICY conversation_messages_insert ON public.conversation_messages
  WITH CHECK (((sender_id = (SELECT current_member_id())) AND (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = conversation_messages.conversation_id) AND ((c.member_id = (SELECT current_member_id())) OR (SELECT is_admin())))))));

ALTER POLICY conversation_messages_select ON public.conversation_messages
  USING ((EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = conversation_messages.conversation_id) AND ((c.member_id = (SELECT current_member_id())) OR (SELECT is_admin()))))));

ALTER POLICY conversation_reads_select_own ON public.conversation_reads
  USING ((member_id = (SELECT current_member_id())));

ALTER POLICY conversations_select ON public.conversations
  USING (((member_id = (SELECT current_member_id())) OR (SELECT is_admin())));

ALTER POLICY "Allow approved users to read investment allocations" ON public.investment_allocations
  USING ((((SELECT current_member_role()) <> 'borrower'::text) OR (member_id = (SELECT current_member_id()))));

ALTER POLICY investment_allocations_write ON public.investment_allocations
  USING ((SELECT is_admin()))
  WITH CHECK ((SELECT is_admin()));

ALTER POLICY investment_hold_allocations_select ON public.investment_hold_allocations
  USING ((((SELECT current_member_role()) <> 'borrower'::text) OR (member_id = (SELECT current_member_id()))));

ALTER POLICY investment_hold_allocations_write ON public.investment_hold_allocations
  USING ((SELECT is_admin()))
  WITH CHECK ((SELECT is_admin()));

ALTER POLICY investments_select ON public.investments
  USING (((SELECT current_member_role()) <> 'borrower'::text));

ALTER POLICY investments_write ON public.investments
  USING ((SELECT is_admin()))
  WITH CHECK ((SELECT is_admin()));

ALTER POLICY loan_gain_allocations_select ON public.loan_gain_allocations
  USING ((((SELECT current_member_role()) <> 'borrower'::text) OR (member_id = (SELECT current_member_id()))));

ALTER POLICY loan_gain_allocations_write ON public.loan_gain_allocations
  USING ((SELECT is_admin()))
  WITH CHECK ((SELECT is_admin()));

ALTER POLICY loan_hold_allocations_select ON public.loan_hold_allocations
  USING ((((SELECT current_member_role()) <> 'borrower'::text) OR (member_id = (SELECT current_member_id()))));

ALTER POLICY loan_hold_allocations_write ON public.loan_hold_allocations
  USING ((SELECT is_admin()))
  WITH CHECK ((SELECT is_admin()));

ALTER POLICY loans_delete_admin ON public.loans
  USING ((SELECT is_admin()));

ALTER POLICY loans_insert ON public.loans
  WITH CHECK (((SELECT is_admin()) OR ((status = 'requested'::text) AND (member_id = (SELECT current_member_id())))));

ALTER POLICY loans_select ON public.loans
  USING ((((SELECT current_member_role()) <> 'borrower'::text) OR (member_id = (SELECT current_member_id())) OR (borrower_id = (SELECT current_borrower_id()))));

ALTER POLICY loans_update_admin ON public.loans
  USING ((SELECT is_admin()))
  WITH CHECK ((SELECT is_admin()));

ALTER POLICY members_delete_admin ON public.members
  USING ((SELECT is_admin()));

ALTER POLICY members_insert_admin ON public.members
  WITH CHECK ((SELECT is_admin()));

ALTER POLICY members_select ON public.members
  USING ((((SELECT current_member_role()) <> 'borrower'::text) OR (member_id = (SELECT current_member_id())) OR (email = ((SELECT auth.jwt()) ->> 'email'::text))));

ALTER POLICY members_update_admin ON public.members
  USING ((SELECT is_admin()))
  WITH CHECK ((SELECT is_admin()));

ALTER POLICY notifications_delete_own ON public.notifications
  USING ((member_id = (SELECT current_member_id())));

ALTER POLICY notifications_select ON public.notifications
  USING ((member_id = (SELECT current_member_id())));

ALTER POLICY notifications_update_own ON public.notifications
  USING ((member_id = (SELECT current_member_id())))
  WITH CHECK ((member_id = (SELECT current_member_id())));

ALTER POLICY push_subscriptions_delete ON public.push_subscriptions
  USING ((member_id = (SELECT current_member_id())));

ALTER POLICY push_subscriptions_insert ON public.push_subscriptions
  WITH CHECK ((member_id = (SELECT current_member_id())));

ALTER POLICY push_subscriptions_select ON public.push_subscriptions
  USING ((member_id = (SELECT current_member_id())));

ALTER POLICY push_subscriptions_update ON public.push_subscriptions
  USING ((member_id = (SELECT current_member_id())))
  WITH CHECK ((member_id = (SELECT current_member_id())));

ALTER POLICY reconciliation_log_select ON public.reconciliation_log
  USING ((SELECT is_admin()));

ALTER POLICY reconciliation_log_write ON public.reconciliation_log
  USING ((SELECT is_admin()))
  WITH CHECK ((SELECT is_admin()));

ALTER POLICY transactions_delete_admin ON public.transactions
  USING ((SELECT is_admin()));

ALTER POLICY transactions_insert ON public.transactions
  WITH CHECK (((SELECT is_admin()) OR ((status = 'pending'::text) AND (member_id = (SELECT current_member_id())) AND (submitted_by IS NULL))));

ALTER POLICY transactions_select ON public.transactions
  USING ((((SELECT current_member_role()) <> 'borrower'::text) OR (member_id = (SELECT current_member_id())) OR (loan_id IN ( SELECT loans.loan_id
   FROM loans
  WHERE ((loans.member_id = (SELECT current_member_id())) OR (loans.borrower_id = (SELECT current_borrower_id())))))));

ALTER POLICY transactions_update_admin ON public.transactions
  USING ((SELECT is_admin()))
  WITH CHECK ((SELECT is_admin()));

ALTER POLICY transactions_update_own_pending ON public.transactions
  USING (((member_id = (SELECT current_member_id())) AND (status = ANY (ARRAY['pending'::text, 'rejected'::text]))))
  WITH CHECK (((member_id = (SELECT current_member_id())) AND (submitted_by IS NULL) AND (status = ANY (ARRAY['pending'::text, 'cancelled'::text]))));

CREATE INDEX IF NOT EXISTS idx_borrowers_member_id ON public.borrowers (member_id);
CREATE INDEX IF NOT EXISTS idx_loans_borrower_id ON public.loans (borrower_id);
CREATE INDEX IF NOT EXISTS idx_loans_member_id ON public.loans (member_id);
CREATE INDEX IF NOT EXISTS idx_transactions_submitted_by ON public.transactions (submitted_by);
CREATE INDEX IF NOT EXISTS idx_transactions_bank_account_id ON public.transactions (bank_account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_to_bank_account_id ON public.transactions (to_bank_account_id);
CREATE INDEX IF NOT EXISTS idx_investment_allocations_investment_id ON public.investment_allocations (investment_id);
CREATE INDEX IF NOT EXISTS idx_investment_allocations_member_id ON public.investment_allocations (member_id);
CREATE INDEX IF NOT EXISTS idx_bank_interest_allocations_member_id ON public.bank_interest_allocations (member_id);
CREATE INDEX IF NOT EXISTS idx_loan_gain_allocations_loan_id ON public.loan_gain_allocations (loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_gain_allocations_member_id ON public.loan_gain_allocations (member_id);
CREATE INDEX IF NOT EXISTS idx_loan_hold_allocations_member_id ON public.loan_hold_allocations (member_id);
CREATE INDEX IF NOT EXISTS idx_investment_hold_allocations_investment_id ON public.investment_hold_allocations (investment_id);
CREATE INDEX IF NOT EXISTS idx_investment_hold_allocations_member_id ON public.investment_hold_allocations (member_id);
CREATE INDEX IF NOT EXISTS idx_members_default_contribution_bank_id ON public.members (default_contribution_bank_id);
CREATE INDEX IF NOT EXISTS idx_members_default_loan_payment_bank_id ON public.members (default_loan_payment_bank_id);
CREATE INDEX IF NOT EXISTS idx_notifications_member_id ON public.notifications (member_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_member_id ON public.push_subscriptions (member_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_by ON public.conversations (created_by);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_sender_id ON public.conversation_messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_conversation_reads_member_id ON public.conversation_reads (member_id);
