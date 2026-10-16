# Testing against production

The app has one Supabase project (`kepwsajtixlcjbabfxlk`, "Est 2017"), and it
is production: real members, real money, admins with push notifications on.
There is no staging database. Every test runs against real data, so the
priorities are, in order: never notify a real person, never change real data,
leave nothing behind.

This is the process used in October 2026 to verify the RLS/index migration and
the lazy-loading / transactions-list changes. Follow it the next time.

## 1. What can reach a real person

All in-app notifications are rows in `public.notifications`; outside the app,
three things deliver:

| Channel | Fires on | How to silence |
|---|---|---|
| Web push | `trg_dispatch_push_notification` on every insert into `public.notifications` | disable that trigger |
| Telegram | `trg_notify_telegram_transaction_insert` on every insert into `public.transactions` | disable that trigger |
| Loan reminders | the `loan-payment-reminders` cron job (`send_loan_payment_reminders()`) | don't create test loans; if one is unavoidable, see below |

Triggers that *write* notification rows (and so cascade into push):
new signups (`trg_notify_admins_member_pending`), pending/resubmitted
transactions, approve/reject decisions, bank-interest / investment / loan-gain
allocations, and chat messages.

Re-check this list before testing, since new triggers get added:

```sql
select c.relname tbl, t.tgname, p.proname fn
from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
where not t.tgisinternal and c.relnamespace in ('public'::regnamespace, 'auth'::regnamespace)
order by 1, 2;
select jobname, command from cron.job;
```

**Rule:** disable a delivery trigger *inside the same transaction* as the
action that would fire it, and re-enable it before `commit`. Then real members'
notifications are never silenced for longer than that one statement. Never
leave a trigger disabled across tool calls. Afterwards, confirm it's back on:

```sql
select tgname, tgenabled from pg_trigger
where tgname in ('trg_dispatch_push_notification', 'trg_notify_telegram_transaction_insert');
-- tgenabled must be 'O' (enabled)
```

## 2. Prefer tests that write nothing

Most checks don't need a test account at all:

- **Database / RLS changes: dry-run in a forced-rollback transaction.** Inside a
  `DO` block, take a fingerprint of what every kind of user can see, apply the
  change, fingerprint again, and finish with `raise exception` carrying the
  result. The exception rolls everything back, guaranteed, and the result comes
  back as the error message. Impersonate a user with
  `set_config('request.jwt.claims', '{"role":"authenticated","email":"..."}', true)`
  plus `set local role authenticated`. Cover every real member (admins,
  members, borrowers), plus a signed-in non-member and `anon`. Use
  `begin isolation level repeatable read` so live activity can't skew the
  comparison, and `set local lock_timeout = '2s'` so it gives up rather than
  stall the app.
- **Backups for DB changes:** before applying, generate the rollback script
  from the live catalog (e.g. `pg_policies`) rather than by hand. Record an md5
  fingerprint of the definitions, then dry-run "forward + rollback" and check
  the fingerprint comes back identical. Commit it under `supabase/rollback/`.
- **Query shape:** PostgREST validates column names even for signed-out
  requests. A `select` can be checked with the publishable key and no login: an
  invalid column errors, a valid one returns 0 rows under RLS. Include a
  deliberate-typo control to prove the check works.
- **Read-only performance:** `pg_stat_statements`, `pg_stat_user_tables`,
  `get_advisors`, and `EXPLAIN ANALYZE` (as an impersonated user, in a
  `begin read only` transaction).

## 3. Signed-in browser tests: the test account

Needed when something only happens signed in (sheets, real data in the list).

### Create

One transaction: silence push, create the auth user and identity, let the
signup trigger create the member row, approve it, re-enable push.

- Name it **"Claude Test Agent"**, email `claude-test-agent@example.invalid`.
- Set `gain_sharing_eligible = false` so it can never be counted in a payout
  that runs while it exists.
- Use a random password and keep it in a `chmod 600` file in the scratchpad
  only.
- Use `role = 'admin'` only if the test needs admin screens or the Edit button
  on any transaction; otherwise use `'member'`.

```sql
begin;
set local lock_timeout = '3s';
alter table public.notifications disable trigger trg_dispatch_push_notification;
with u as (
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
    'claude-test-agent@example.invalid', extensions.crypt('<PASSWORD>', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"name":"Claude Test Agent"}', now(), now(), '', '', '', '')
  returning id, email
)
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text, json_build_object('sub', id::text, 'email', email, 'email_verified', true),
       'email', now(), now(), now() from u;
update public.members set status = 'approved', role = 'member', gain_sharing_eligible = false, name = 'Claude Test Agent'
  where email = 'claude-test-agent@example.invalid';
alter table public.notifications enable trigger trg_dispatch_push_notification;
commit;
```

The signup still writes a silent "New Signup" row into every admin's in-app
list. Delete those (see Cleanup). If you can't delete them yet, at least
`update public.notifications set read = true` on them so admins don't see an
unread badge.

### Test

- Build and run the app locally against production, using the **publishable**
  key (it's public; get it with `get_publishable_keys`). Vercel previews may
  sit behind deployment protection.
  `NEXT_PUBLIC_SUPABASE_URL=https://kepwsajtixlcjbabfxlk.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable key> npx next build && npx next start -p <port>`
- **Compare against `main`, not just "does it work".** Check out `main` in a
  `git worktree`, build it the same way on a second port, and run the same
  Playwright script against both. Diff the results: counts, search and filter
  results, first rows, screenshots, network requests. Behaviour that's
  identical on `main` is pre-existing, not a regression.
- Use a desktop-width Chromium user agent; `/login` shows a full-screen install
  gate on mobile UAs. If the onboarding sheet appears, press **Not now**.
  Never enable notifications.
- **Read-only:** open sheets and screens, search, filter, scroll. Never press
  Submit / Save / Approve, send chat messages, or upload files. If a test must
  write (e.g. submit a transaction), disable *both* the push and Telegram
  triggers in the same transaction as the write, and delete the rows afterwards.

### Cleanup

```sql
delete from public.notifications where body = 'Claude Test Agent signed up and needs approval.';
delete from public.notifications where member_id = (select member_id from public.members where email = 'claude-test-agent@example.invalid');
delete from public.members where email = 'claude-test-agent@example.invalid';
delete from auth.users where email = 'claude-test-agent@example.invalid';  -- cascades identities, sessions, tokens
```

First check nothing else references the test member (any FK into
`public.members`); there should be nothing if the test stayed read-only.

**The Supabase MCP `execute_sql` / `apply_migration` tools hold `DELETE` and
`DROP` statements for a confirmation that times out after 60s, and the
statement never reaches Postgres.** If that happens, don't try to work around
it. Disable the account instead, which updates are allowed to do, and give the
user the cleanup SQL above to run in the Supabase SQL editor:

```sql
update public.members set status = 'inactive', role = 'member', gain_sharing_eligible = false
  where email = 'claude-test-agent@example.invalid';
update auth.users set banned_until = '2999-01-01',
  encrypted_password = extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf'))
  where email = 'claude-test-agent@example.invalid';
update auth.refresh_tokens set revoked = true
  where user_id = (select id from auth.users where email = 'claude-test-agent@example.invalid')::text;
```

`inactive` keeps it out of member counts and the admin approval queue, and
every RLS helper requires `approved`, so it can see nothing.

Also: stop the local servers, `git worktree remove` the `main` checkout, and
delete the password file.

## 4. Local gotchas

- `next start` on a port that's still taken fails quietly. The old server keeps
  serving stale HTML that points at chunks the new build replaced, and pages
  look broken or "faster". Check the server log for `EADDRINUSE`, and stop old
  servers by PID (`ps -eo pid,args | grep next-server`).
- Don't `pkill -f "next start"`: it matches the shell running the command and
  kills it.
- Turbopack refuses a symlinked `node_modules` in a worktree. Use
  `cp -al <repo>/node_modules node_modules` (hard links, instant) instead.
- Locally, `/_vercel/insights/script.js` 404s on every page. That's Vercel
  Analytics, which only exists on Vercel; ignore it.
- `next build` with Turbopack doesn't print per-route sizes. Measure the JS
  each route downloads with Playwright plus CDP network events (throttle with
  `Network.emulateNetworkConditions` and `Emulation.setCPUThrottlingRate` for
  phone-like numbers).
