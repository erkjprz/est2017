-- Telegram now announces a loan's disbursement, not just its request.
--
-- Until now Telegram only fired on insert (trg_notify_telegram_transaction_
-- insert), so a loan pinged once when it was requested -- the pending Loan
-- Release row -- and never when approve_loan_release flipped that row to
-- approved. The August migration dropped every approval ping; this adds
-- back exactly one: a Loan Release going pending -> approved.
--
-- Done as its own narrowly-gated trigger rather than a call inside
-- approve_loan_release, so the money-moving RPC is untouched, and every
-- approval path (the RPC, or any direct status update) is covered. The
-- WHEN clause matches trg_start_loan_on_release, so it fires on the same
-- transition the loan's start date is stamped on. net.http_post is queued
-- in the same transaction, so an approval that rolls back sends nothing.

-- Back-ports the live definition, which drifted from the August migration
-- (it also sends 'recorded' for admin Bank Interest/Expense/Investment
-- entries). Unchanged here -- recorded so the repo matches production.
create or replace function public.notify_telegram_transaction()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  webhook_secret text;
  event_name text;
begin
  if new.status = 'pending' then
    event_name := 'submitted';
  elsif new.status = 'approved' and new.classification in ('Bank Interest', 'Expense', 'Investment') then
    event_name := 'recorded';
  else
    return new;
  end if;

  select decrypted_secret into webhook_secret
  from vault.decrypted_secrets
  where name = 'telegram_webhook_secret';

  perform net.http_post(
    url := 'https://kepwsajtixlcjbabfxlk.functions.supabase.co/telegram-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object('event', event_name, 'record', row_to_json(new))
  );

  return new;
end;
$function$;

create or replace function public.notify_telegram_loan_released()
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
    body := jsonb_build_object('event', 'released', 'record', row_to_json(new))
  );

  return new;
end;
$function$;

revoke execute on function public.notify_telegram_loan_released() from public, anon, authenticated;

create or replace trigger trg_notify_telegram_loan_released
  after update on public.transactions
  for each row
  when (old.status = 'pending' and new.status = 'approved' and new.classification = 'Loan Release')
  execute function public.notify_telegram_loan_released();
