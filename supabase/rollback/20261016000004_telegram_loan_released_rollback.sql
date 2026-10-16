-- Rollback for 20261016000004_telegram_loan_released.sql. Removes only the
-- new loan-released ping; notify_telegram_transaction was re-created with
-- its live body unchanged, so there's nothing to restore there.
drop trigger if exists trg_notify_telegram_loan_released on public.transactions;
drop function if exists public.notify_telegram_loan_released();
