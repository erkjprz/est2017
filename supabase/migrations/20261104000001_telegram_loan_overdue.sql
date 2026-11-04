-- Overdue loan reminders now also post to the Telegram group chat.
--
-- send_loan_payment_reminders logs every reminder it actually sends in
-- loan_payment_reminders (one row per loan per day at most, guarded by the
-- primary key), right before it creates the borrower's in-app/push
-- notification. This trigger hangs off that log, so the money/reminder
-- function itself is untouched, and only overdue rows reach Telegram:
-- 'upcoming' and 'due' stay in-app/push only, since the group chat is
-- shared and the bot can't message borrowers individually.
--
-- The edge function looks the loan up in v_loan_summary to build the
-- message. net.http_post is queued in the same transaction, so a run that
-- rolls back sends nothing.

create or replace function public.notify_telegram_loan_overdue()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  webhook_secret text;
begin
  select decrypted_secret into webhook_secret
  from vault.decrypted_secrets
  where name = 'telegram_webhook_secret';

  perform net.http_post(
    url := 'https://kepwsajtixlcjbabfxlk.functions.supabase.co/telegram-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object('event', 'loan_overdue', 'record', row_to_json(new))
  );

  return new;
end;
$function$;

revoke execute on function public.notify_telegram_loan_overdue() from public, anon, authenticated;

create or replace trigger trg_notify_telegram_loan_overdue
  after insert on public.loan_payment_reminders
  for each row
  when (new.kind = 'overdue')
  execute function public.notify_telegram_loan_overdue();
