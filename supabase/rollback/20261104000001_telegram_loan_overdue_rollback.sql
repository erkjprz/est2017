-- Rollback for 20261104000001_telegram_loan_overdue.sql. Overdue reminders
-- go back to in-app/push only.
drop trigger if exists trg_notify_telegram_loan_overdue on public.loan_payment_reminders;
drop function if exists public.notify_telegram_loan_overdue();
