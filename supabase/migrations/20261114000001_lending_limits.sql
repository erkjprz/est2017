-- Lending limits: three admin-set caps the admin queue checks a pending
-- Loan Release against before approval. Warn-only -- nothing here blocks
-- an approval; the app shows a flag on the request instead.
--
--   max_total_loans_pct   all active loan principal still out, as a % of
--                         the fund (cash + that principal)
--   max_per_borrower_pct  one borrower's active principal still out plus
--                         their pending requests, as a % of the fund
--   max_member_hold_pct   any one member's money on hold, as a % of their
--                         own total value
--
-- One row only (id is always true). Admins only, for reading too: the
-- fund's lending headroom isn't something borrowers or members see.

create table public.lending_limits (
  id boolean primary key default true check (id),
  max_total_loans_pct numeric(5,2) not null default 50
    check (max_total_loans_pct > 0 and max_total_loans_pct <= 100),
  max_per_borrower_pct numeric(5,2) not null default 15
    check (max_per_borrower_pct > 0 and max_per_borrower_pct <= 100),
  max_member_hold_pct numeric(5,2) not null default 50
    check (max_member_hold_pct > 0 and max_member_hold_pct <= 100),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.members(member_id) on delete set null
);

insert into public.lending_limits default values;

-- Who changed the limits last, and when -- stamped server-side so the
-- client can't misreport it.
create or replace function public.lending_limits_stamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.id := true;
  new.updated_at := now();
  new.updated_by := current_member_id();
  return new;
end;
$$;

create trigger trg_lending_limits_stamp
  before update on public.lending_limits
  for each row execute function public.lending_limits_stamp();

alter table public.lending_limits enable row level security;

create policy lending_limits_select on public.lending_limits
  for select to authenticated
  using ((select is_admin()));

create policy lending_limits_update on public.lending_limits
  for update to authenticated
  using ((select is_admin()))
  with check ((select is_admin()));

-- No insert/delete for anyone: the single row above is the only one.
revoke all on public.lending_limits from anon;
revoke all on public.lending_limits from authenticated;
grant select, update (max_total_loans_pct, max_per_borrower_pct, max_member_hold_pct)
  on public.lending_limits to authenticated;
