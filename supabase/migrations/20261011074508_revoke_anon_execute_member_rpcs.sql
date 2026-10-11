-- These RPCs are only ever called by signed-in members/admins. Each already
-- guards itself (is_admin() or "Not an approved member"), so this is defence
-- in depth: signed-out visitors (anon, and PUBLIC which anon inherits) can no
-- longer call them at all. authenticated and service_role keep their own
-- explicit grants.
--
-- Deliberately left alone:
--   is_admin(), current_member_id(), current_member_role(),
--   current_borrower_id() -- RLS policies that apply to every role (e.g. the
--   *_allocations write policies) call these, and they return nothing for a
--   signed-out caller anyway.
--   handle_new_member_signup(), sync_member_email(),
--   notify_telegram_transaction(), rls_auto_enable() -- trigger / event
--   trigger functions, which can't be invoked through the API.
revoke execute on function public.admin_link_member(uuid, uuid) from public, anon;
revoke execute on function public.approve_borrower_member(uuid, uuid) from public, anon;
revoke execute on function public.list_unclaimed_members() from public, anon;
revoke execute on function public.set_default_contribution_amount(numeric) from public, anon;
revoke execute on function public.set_default_contribution_bank(uuid) from public, anon;
revoke execute on function public.set_default_loan_payment_amount(numeric) from public, anon;
revoke execute on function public.set_default_loan_payment_bank(uuid) from public, anon;
revoke execute on function public.update_my_name(text) from public, anon;
revoke execute on function public.distribute_bank_interest_group(text, date, uuid[], jsonb) from public, anon;
