<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Testing against the real Supabase project

This app's only Supabase project is production -- there is no separate
staging database. Real members (including admins with push notifications
enabled) can be notified by test activity if you're not careful.

**Read `docs/TESTING.md` before any test that touches the database or signs
in.** It has the full runbook: what can notify people, the forced-rollback
dry-run pattern for DB changes, creating/using/removing the test account, and
local build gotchas. The essentials:

- Three channels reach real people: web push (`trg_dispatch_push_notification`
  on `public.notifications`), Telegram (`trg_notify_telegram_transaction_insert`
  on `public.transactions`), and the `loan-payment-reminders` cron job.
- Prefer tests that write nothing: dry-run DB changes inside a transaction that
  ends in `raise exception`, and validate queries with the publishable key.
- Disable a delivery trigger only *inside the same transaction* as the action
  that fires it, and re-enable it before `commit` -- never leave it off across
  steps, since that silences real members' notifications too:

```sql
begin;
alter table public.notifications disable trigger trg_dispatch_push_notification;
-- ...the test write...
alter table public.notifications enable trigger trg_dispatch_push_notification;
commit;
```

- Test accounts are named "Claude Test Agent" (`claude-test-agent@example.invalid`),
  `gain_sharing_eligible = false`, and are used read-only. Delete them and any
  rows they caused (including the "New Signup" notifications sent to admins)
  when done.
- The Supabase MCP tools hold `DELETE`/`DROP` for a confirmation that times out
  -- don't work around it. Disable the test account instead (`status =
  'inactive'`, banned login) and hand the user the cleanup SQL from
  `docs/TESTING.md`.
