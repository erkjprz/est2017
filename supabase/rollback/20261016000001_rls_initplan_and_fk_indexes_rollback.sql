-- ROLLBACK for supabase/migrations/20261016000001_rls_initplan_and_fk_indexes.sql
--
-- Restores every public RLS policy expression to exactly what it was before that
-- migration (generated from pg_policies on 2026-10-16), and drops the indexes it
-- added. Safe to run more than once. Only run this if something broke after the
-- migration; it makes the app slower again but changes no data.
--
-- Verify after running: this should return policy_md5 = 314c6022be53d4348e80444421392b42, n = 42
--   select md5(string_agg(format('%s|%s|%s|%s|%s|%s|%s', tablename, policyname, permissive,
--          roles, cmd, qual, with_check), E'\n' order by tablename, policyname)) policy_md5, count(*) n
--   from pg_policies where schemaname = 'public';

BEGIN;

ALTER POLICY bank_accounts_select ON public.bank_accounts
  USING ((current_member_role() IS NOT NULL));

ALTER POLICY bank_accounts_write ON public.bank_accounts
  USING (is_admin())
  WITH CHECK (is_admin());

ALTER POLICY "Allow approved users to read bank interest allocations" ON public.bank_interest_allocations
  USING (((current_member_role() <> 'borrower'::text) OR (member_id = current_member_id())));

ALTER POLICY bank_interest_allocations_write ON public.bank_interest_allocations
  USING (is_admin())
  WITH CHECK (is_admin());

ALTER POLICY borrowers_select ON public.borrowers
  USING (((current_member_role() <> 'borrower'::text) OR (member_id = current_member_id())));

ALTER POLICY borrowers_write ON public.borrowers
  USING (is_admin())
  WITH CHECK (is_admin());

ALTER POLICY conversation_messages_insert ON public.conversation_messages
  WITH CHECK (((sender_id = current_member_id()) AND (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = conversation_messages.conversation_id) AND ((c.member_id = current_member_id()) OR is_admin()))))));

ALTER POLICY conversation_messages_select ON public.conversation_messages
  USING ((EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = conversation_messages.conversation_id) AND ((c.member_id = current_member_id()) OR is_admin())))));

ALTER POLICY conversation_reads_select_own ON public.conversation_reads
  USING ((member_id = current_member_id()));

ALTER POLICY conversations_select ON public.conversations
  USING (((member_id = current_member_id()) OR is_admin()));

ALTER POLICY "Allow approved users to read investment allocations" ON public.investment_allocations
  USING (((current_member_role() <> 'borrower'::text) OR (member_id = current_member_id())));

ALTER POLICY investment_allocations_write ON public.investment_allocations
  USING (is_admin())
  WITH CHECK (is_admin());

ALTER POLICY investment_hold_allocations_select ON public.investment_hold_allocations
  USING (((current_member_role() <> 'borrower'::text) OR (member_id = current_member_id())));

ALTER POLICY investment_hold_allocations_write ON public.investment_hold_allocations
  USING (is_admin())
  WITH CHECK (is_admin());

ALTER POLICY investments_select ON public.investments
  USING ((current_member_role() <> 'borrower'::text));

ALTER POLICY investments_write ON public.investments
  USING (is_admin())
  WITH CHECK (is_admin());

ALTER POLICY loan_gain_allocations_select ON public.loan_gain_allocations
  USING (((current_member_role() <> 'borrower'::text) OR (member_id = current_member_id())));

ALTER POLICY loan_gain_allocations_write ON public.loan_gain_allocations
  USING (is_admin())
  WITH CHECK (is_admin());

ALTER POLICY loan_hold_allocations_select ON public.loan_hold_allocations
  USING (((current_member_role() <> 'borrower'::text) OR (member_id = current_member_id())));

ALTER POLICY loan_hold_allocations_write ON public.loan_hold_allocations
  USING (is_admin())
  WITH CHECK (is_admin());

ALTER POLICY loans_delete_admin ON public.loans
  USING (is_admin());

ALTER POLICY loans_insert ON public.loans
  WITH CHECK ((is_admin() OR ((status = 'requested'::text) AND (member_id = current_member_id()))));

ALTER POLICY loans_select ON public.loans
  USING (((current_member_role() <> 'borrower'::text) OR (member_id = current_member_id()) OR (borrower_id = current_borrower_id())));

ALTER POLICY loans_update_admin ON public.loans
  USING (is_admin())
  WITH CHECK (is_admin());

ALTER POLICY members_delete_admin ON public.members
  USING (is_admin());

ALTER POLICY members_insert_admin ON public.members
  WITH CHECK (is_admin());

ALTER POLICY members_select ON public.members
  USING (((current_member_role() <> 'borrower'::text) OR (member_id = current_member_id()) OR (email = (auth.jwt() ->> 'email'::text))));

ALTER POLICY members_update_admin ON public.members
  USING (is_admin())
  WITH CHECK (is_admin());

ALTER POLICY notifications_delete_own ON public.notifications
  USING ((member_id = current_member_id()));

ALTER POLICY notifications_select ON public.notifications
  USING ((member_id = current_member_id()));

ALTER POLICY notifications_update_own ON public.notifications
  USING ((member_id = current_member_id()))
  WITH CHECK ((member_id = current_member_id()));

ALTER POLICY push_subscriptions_delete ON public.push_subscriptions
  USING ((member_id = current_member_id()));

ALTER POLICY push_subscriptions_insert ON public.push_subscriptions
  WITH CHECK ((member_id = current_member_id()));

ALTER POLICY push_subscriptions_select ON public.push_subscriptions
  USING ((member_id = current_member_id()));

ALTER POLICY push_subscriptions_update ON public.push_subscriptions
  USING ((member_id = current_member_id()))
  WITH CHECK ((member_id = current_member_id()));

ALTER POLICY reconciliation_log_select ON public.reconciliation_log
  USING (is_admin());

ALTER POLICY reconciliation_log_write ON public.reconciliation_log
  USING (is_admin())
  WITH CHECK (is_admin());

ALTER POLICY transactions_delete_admin ON public.transactions
  USING (is_admin());

ALTER POLICY transactions_insert ON public.transactions
  WITH CHECK ((is_admin() OR ((status = 'pending'::text) AND (member_id = current_member_id()) AND (submitted_by IS NULL))));

ALTER POLICY transactions_select ON public.transactions
  USING (((current_member_role() <> 'borrower'::text) OR (member_id = current_member_id()) OR (loan_id IN ( SELECT loans.loan_id
   FROM loans
  WHERE ((loans.member_id = current_member_id()) OR (loans.borrower_id = current_borrower_id()))))));

ALTER POLICY transactions_update_admin ON public.transactions
  USING (is_admin())
  WITH CHECK (is_admin());

ALTER POLICY transactions_update_own_pending ON public.transactions
  USING (((member_id = current_member_id()) AND (status = ANY (ARRAY['pending'::text, 'rejected'::text]))))
  WITH CHECK (((member_id = current_member_id()) AND (submitted_by IS NULL) AND (status = ANY (ARRAY['pending'::text, 'cancelled'::text]))));

DROP INDEX IF EXISTS public.idx_borrowers_member_id;
DROP INDEX IF EXISTS public.idx_loans_borrower_id;
DROP INDEX IF EXISTS public.idx_loans_member_id;
DROP INDEX IF EXISTS public.idx_transactions_submitted_by;
DROP INDEX IF EXISTS public.idx_transactions_bank_account_id;
DROP INDEX IF EXISTS public.idx_transactions_to_bank_account_id;
DROP INDEX IF EXISTS public.idx_investment_allocations_investment_id;
DROP INDEX IF EXISTS public.idx_investment_allocations_member_id;
DROP INDEX IF EXISTS public.idx_bank_interest_allocations_member_id;
DROP INDEX IF EXISTS public.idx_loan_gain_allocations_loan_id;
DROP INDEX IF EXISTS public.idx_loan_gain_allocations_member_id;
DROP INDEX IF EXISTS public.idx_loan_hold_allocations_member_id;
DROP INDEX IF EXISTS public.idx_investment_hold_allocations_investment_id;
DROP INDEX IF EXISTS public.idx_investment_hold_allocations_member_id;
DROP INDEX IF EXISTS public.idx_members_default_contribution_bank_id;
DROP INDEX IF EXISTS public.idx_members_default_loan_payment_bank_id;
DROP INDEX IF EXISTS public.idx_notifications_member_id;
DROP INDEX IF EXISTS public.idx_push_subscriptions_member_id;
DROP INDEX IF EXISTS public.idx_conversations_created_by;
DROP INDEX IF EXISTS public.idx_conversation_messages_sender_id;
DROP INDEX IF EXISTS public.idx_conversation_reads_member_id;

COMMIT;
