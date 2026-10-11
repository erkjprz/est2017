-- Let members (and borrowers) resubmit their own rejected entries.
--
-- The Edit sheet's "Fix & resend" saves a rejected row back as pending
-- (clearing rejection_reason), and trg_notify_admins_transaction_resubmitted
-- already tells admins when that happens -- but the update policy only
-- matched rows that were already pending, so the save hit zero rows and the
-- member saw "This entry has changed since you opened it".
--
-- Only USING widens (which rows a member may touch: their own pending or
-- rejected ones). WITH CHECK is unchanged -- the row must still end up
-- theirs, self-submitted, and pending or cancelled, so a member can never
-- approve anything or edit someone else's entry.
alter policy transactions_update_own_pending
  on public.transactions
  using (member_id = current_member_id() and status in ('pending', 'rejected'))
  with check (
    member_id = current_member_id()
    and submitted_by is null
    and status = any (array['pending'::text, 'cancelled'::text])
  );
