"use client"

// Inline replacement for the old standalone /loans/[id] route -- rendered
// in place inside LoansPanel so the Breakdown header and tab row stay on
// screen instead of a full page navigation. Auth is already gated by
// FundBreakdownHub by the time this mounts, so this only tracks its own
// data-loading state.

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { totalRepayable, type InterestType } from "@/lib/loanMath"
import { formatInterestLabel, durationLabel, paymentOverdueLabel, ordinalDay, longDate, lumpSumDueDate } from "@/lib/loanFormat"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"
import { InfoBox, InfoRow } from "@/app/components/breakdown/InfoBox"
import { TRANSACTION_TYPE_LABELS as TXN_TYPE_LABELS } from "@/lib/transactionLabels"
import { readCache, writeCache } from "@/lib/cache"
import { Sheet } from "@/app/components/Sheet"
import { AdminActionRow, AdminMenuButton } from "@/app/components/breakdown/AdminMenu"
import {
  CloseLoanSheet,
  EditLoanTermsSheet,
  ReleaseLoanSheet,
  ReopenLoanSheet,
  type AdminLoan,
  type BankOption
} from "@/app/components/breakdown/LoanAdminSheets"

type Loan = {
  loan_id: string
  loan: string
  status: "requested" | "active" | "closed"
  start_date: string
  closed_date: string | null
  borrower: string
  borrower_member_id: string | null
  principal: number
  repayment: number
  gain: number
  outstanding: number
  total_repayable: number
  interest_type: InterestType | null
  interest_rate: number | null
  interest_amount: number | null
  term_months: number | null
  notes: string | null
  repayment_frequency: string | null
  last_repayment_date: string | null
  due_day: number | null
  due_date: string | null
}

type GainShare = {
  member_id: string
  member: string
  amount: number
  current_value: number
  pct_share: number
}

type HoldShare = {
  member_id: string
  member: string
  share: number
}

type RecentTransaction = {
  transaction_id: string
  date: string
  classification: string
  amount: number
  status: string
}

type LoanDetailSnapshot = {
  loan: Loan | null
  shares: GainShare[]
  holds: HoldShare[]
  principalOutstanding: number
  recentTransactions: RecentTransaction[]
  adminLoan: AdminLoan | null
  banks: BankOption[]
}

type AdminSheet = "actions" | "edit" | "release" | "close" | "closeEarly" | "reopen" | null

export function LoanDetailPanel({
  loanId,
  onBack,
  onChanged
}: {
  loanId: string
  onBack: () => void
  // Lets the loan list refresh behind this panel after an admin action.
  onChanged?: () => void
}) {
  const router = useRouter()
  const { member } = useAuth()
  const isAdmin = member?.role === "admin"
  const myMemberId = member?.member_id ?? null

  const cacheKey = `loan-detail:${loanId}`
  const cached = readCache<LoanDetailSnapshot>(cacheKey)

  const [dataLoading, setDataLoading] = useState(!cached)
  const [loan, setLoan] = useState<Loan | null>(cached?.loan ?? null)
  const [shares, setShares] = useState<GainShare[]>(cached?.shares ?? [])
  const [holds, setHolds] = useState<HoldShare[]>(cached?.holds ?? [])
  const [principalOutstanding, setPrincipalOutstanding] = useState(cached?.principalOutstanding ?? 0)
  const [recentTransactions, setRecentTransactions] = useState<RecentTransaction[]>(cached?.recentTransactions ?? [])
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState("")

  // Admin-only management data/state -- mirrors what the old /admin/loans
  // page tracked, scoped down to just this one loan.
  const [adminLoan, setAdminLoan] = useState<AdminLoan | null>(cached?.adminLoan ?? null)
  const [banks, setBanks] = useState<BankOption[]>(cached?.banks ?? [])
  const [adminSheet, setAdminSheet] = useState<AdminSheet>(null)

  async function loadMemberFacing() {
    const loanPromise = supabase.from("v_loan_summary").select("*").eq("loan_id", loanId).single()

    // Gain share per member, per Section 14 of the audit doc: split
    // proportional to each eligible member's current value at the
    // moment this loan closed, borrower excluded, joined here to
    // members for display names and sorted highest share first.
    const sharesPromise = supabase
      .from("loan_gain_allocations")
      .select("amount, member_id, current_value, pct_share, members(name)")
      .eq("loan_id", loanId)
      .order("amount", { ascending: false })

    // Hold per member for an active loan -- the same loan_hold_allocations
    // snapshot (taken once at release) that already powers the aggregate
    // "money tied up in loans" figure on a member's Available Balance card,
    // just scoped to this one loan. amount is derived at render time from
    // share * principalOutstanding rather than stored, so it stays current
    // as the loan gets repaid without needing to refetch this.
    const holdsPromise = supabase
      .from("loan_hold_allocations")
      .select("member_id, share, members(name)")
      .eq("loan_id", loanId)
      .order("share", { ascending: false })

    // v_loan_summary.outstanding (used for loan.outstanding elsewhere on
    // this page) is principal + interest - repaid, i.e. what's still owed
    // in total. The hold figure needs principal - repaid instead -- the
    // capital of members' actual money still tied up, excluding interest
    // that hasn't been earned/allocated yet -- which is what
    // v_active_loan_outstanding (and therefore v_member_loan_hold, the
    // source of the aggregate figure this needs to match) uses. Using
    // loan.outstanding here previously overstated every member's hold by
    // their share of the loan's interest.
    const principalOutstandingPromise = supabase
      .from("v_active_loan_outstanding")
      .select("outstanding")
      .eq("loan_id", loanId)
      .maybeSingle()

    // Most recent 5 transactions tied to this loan, newest first -- a quick
    // "what's happened lately" glance, with a link to the full ledger
    // (pre-filtered to this loan) for anything older.
    const recentTxnsPromise = supabase
      .from("transactions")
      .select("transaction_id, txn_date, created_at, classification, amount, status")
      .eq("loan_id", loanId)
      .neq("status", "cancelled")
      .order("txn_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(5)

    const [loanResult, sharesResult, holdsResult, principalOutstandingResult, recentTxnsResult] = await Promise.all([
      loanPromise,
      sharesPromise,
      holdsPromise,
      principalOutstandingPromise,
      recentTxnsPromise
    ])

    let nextLoan = loan
    if (loanResult.error || !loanResult.data) {
      setNotFound(true)
    } else {
      nextLoan = loanResult.data as Loan
      setLoan(nextLoan)
    }

    let nextShares = shares
    if (!sharesResult.error && sharesResult.data) {
      nextShares = sharesResult.data.map((r: any) => ({
        member_id: r.member_id,
        member: r.members?.name ?? "Unknown",
        amount: Number(r.amount),
        current_value: Number(r.current_value),
        pct_share: Number(r.pct_share)
      }))
      setShares(nextShares)
    } else if (sharesResult.error) {
      setLoadError(sharesResult.error.message)
    }

    let nextHolds = holds
    if (!holdsResult.error && holdsResult.data) {
      nextHolds = holdsResult.data.map((r: any) => ({
        member_id: r.member_id,
        member: r.members?.name ?? "Unknown",
        share: Number(r.share)
      }))
      setHolds(nextHolds)
    } else if (holdsResult.error) {
      setLoadError(holdsResult.error.message)
    }

    let nextPrincipalOutstanding = principalOutstanding
    if (!principalOutstandingResult.error && principalOutstandingResult.data) {
      nextPrincipalOutstanding = Number(principalOutstandingResult.data.outstanding)
      setPrincipalOutstanding(nextPrincipalOutstanding)
    } else if (principalOutstandingResult.error) {
      setLoadError(principalOutstandingResult.error.message)
    }

    let nextRecentTransactions = recentTransactions
    if (!recentTxnsResult.error && recentTxnsResult.data) {
      nextRecentTransactions = recentTxnsResult.data.map((r) => ({
        transaction_id: r.transaction_id,
        date: r.txn_date ?? r.created_at,
        classification: r.classification,
        amount: Number(r.amount),
        status: r.status
      }))
      setRecentTransactions(nextRecentTransactions)
    }

    return {
      loan: nextLoan,
      shares: nextShares,
      holds: nextHolds,
      principalOutstanding: nextPrincipalOutstanding,
      recentTransactions: nextRecentTransactions
    }
  }

  async function loadAdminData() {
    const [{ data: rawLoan }, { data: related }, { data: bankList }] = await Promise.all([
      supabase.from("loans").select("*").eq("loan_id", loanId).single(),
      supabase
        .from("transactions")
        .select("classification, amount, status")
        .eq("loan_id", loanId)
        .neq("status", "rejected")
        .neq("status", "cancelled"),
      supabase.from("bank_accounts").select("id, bank_name, account_name").order("bank_name")
    ])

    const nextBanks = (bankList as BankOption[]) ?? []
    setBanks(nextBanks)

    if (!rawLoan) return { adminLoan, banks: nextBanks }

    // Loan releases are stored negative in the ledger; flip the sign so
    // "disbursed" reads as a positive magnitude.
    const disbursed = -(related ?? [])
      .filter((t) => t.classification === "Loan Release")
      .reduce((sum, t) => sum + Number(t.amount), 0)

    const repaid = (related ?? [])
      .filter((t) => t.classification === "Loan Repayment")
      .reduce((sum, t) => sum + Number(t.amount), 0)

    const repaidApproved = (related ?? [])
      .filter((t) => t.classification === "Loan Repayment" && t.status === "approved")
      .reduce((sum, t) => sum + Number(t.amount), 0)

    const interestType: InterestType = rawLoan.interest_type === "amount" ? "amount" : "rate"
    const totalRepayableVal = totalRepayable(
      Number(rawLoan.principal),
      interestType,
      Number(rawLoan.interest_rate ?? 0),
      Number(rawLoan.interest_amount ?? 0)
    )

    const remaining = totalRepayableVal - repaid
    const remainingApproved = totalRepayableVal - repaidApproved
    const pendingRepayment = Math.max(0, repaid - repaidApproved)

    const next: AdminLoan = {
      loan_id: rawLoan.loan_id,
      member_id: rawLoan.member_id,
      status: rawLoan.status,
      principal: Number(rawLoan.principal),
      interest_type: interestType,
      interest_rate: Number(rawLoan.interest_rate ?? 0),
      interest_amount: Number(rawLoan.interest_amount ?? 0),
      term_months: rawLoan.term_months,
      repayment_frequency: rawLoan.repayment_frequency ?? "monthly",
      due_day: rawLoan.due_day ?? null,
      due_date: rawLoan.due_date ?? null,
      start_date: rawLoan.start_date,
      notes: rawLoan.notes,
      disbursed,
      repaid,
      repaidApproved,
      totalRepayable: totalRepayableVal,
      remaining,
      remainingApproved,
      pendingRepayment
    }

    setAdminLoan(next)

    return { adminLoan: next, banks: nextBanks }
  }

  // Opening a drill-down while the list is scrolled down would otherwise
  // leave the Breakdown header out of view -- jump back to top so it's
  // visible the instant the detail mounts.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      // Only show the blocking loader on a true cold start -- if we
      // already rendered cached data, refresh quietly behind it instead
      // of flashing back to a spinner on every navigation.
      if (!readCache(cacheKey)) setDataLoading(true)

      const memberFacing = await loadMemberFacing()
      let adminData: { adminLoan: AdminLoan | null; banks: BankOption[] } = { adminLoan, banks }
      if (!cancelled && isAdmin) {
        adminData = await loadAdminData()
      }
      if (!cancelled) {
        setDataLoading(false)
        writeCache<LoanDetailSnapshot>(cacheKey, { ...memberFacing, ...adminData })
      }
    }

    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loanId])

  async function reloadAll() {
    const memberFacing = await loadMemberFacing()
    let adminData: { adminLoan: AdminLoan | null; banks: BankOption[] } = { adminLoan, banks }
    if (isAdmin) adminData = await loadAdminData()
    writeCache<LoanDetailSnapshot>(cacheKey, { ...memberFacing, ...adminData })
    onChanged?.()
  }

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (dataLoading) {
    return <SkeletonPanel />
  }

  if (notFound || !loan) {
    return (
      <div>
        <p className="text-sm text-ink-soft">This loan couldn&apos;t be found.</p>
        <button onClick={onBack} className="mt-4 text-sm font-medium text-gold">
          ← Back to Loans
        </button>
      </div>
    )
  }

  // A closed loan isn't always a full repayment -- "Close Early"
  // closes it with whatever was actually repaid, which can be less (or, if
  // extra interest came in, more) than total_repayable. Label and color off
  // the real repayment total instead of assuming every closed loan was paid
  // off in full.
  const fullyRepaid = loan.repayment >= loan.total_repayable
  const statusMeta: Record<Loan["status"], { label: string; dot: string; text: string }> = {
    closed: fullyRepaid
      ? { label: "Repaid in full", dot: "bg-sage", text: "text-sage" }
      : { label: "Closed early", dot: "bg-rust", text: "text-rust" },
    active: { label: "Active", dot: "bg-gold", text: "text-gold" },
    requested: { label: "Requested", dot: "bg-ink-soft", text: "text-ink-soft" }
  }
  const meta = statusMeta[loan.status]

  // Driven by the real repaid amount, not total_repayable - outstanding --
  // outstanding is forced to 0 for any closed loan (see v_loan_summary),
  // which would otherwise show a full green bar even for a write-off that
  // was never actually repaid.
  const repaidPct = loan.total_repayable > 0
    ? Math.min(100, (loan.repayment / loan.total_repayable) * 100)
    : 0

  const startLabel = new Date(loan.start_date).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric"
  })
  const closedLabel = loan.closed_date
    ? new Date(loan.closed_date).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric"
      })
    : null
  const overdueLabel = paymentOverdueLabel(
    loan.status,
    loan.repayment_frequency,
    loan.start_date,
    loan.last_repayment_date,
    loan.due_day
  )

  const totalShared = shares.reduce((sum, s) => sum + s.amount, 0)

  // A lump sum with a picked due date is described by that date (the Due
  // date row), not the month count stored alongside it.
  const termLabel =
    loan.repayment_frequency === "lump_sum" && loan.due_date
      ? "lump sum"
      : loan.term_months
        ? `${loan.term_months} mo · ${loan.repayment_frequency === "lump_sum" ? "lump sum" : "monthly"}`
        : null
  const lumpSumDue =
    loan.repayment_frequency === "lump_sum" ? lumpSumDueDate(loan.start_date, loan.term_months, loan.due_date) : null
  const pendingRepayment = adminLoan?.pendingRepayment ?? 0

  // What this loan is waiting on an admin for, if anything. Mirrors the
  // conditions the old Manage box used to pick which action to show.
  const nextStep: {
    title: string
    description: string
    amount: string
    cta: string
    onClick: () => void
  } | null = !adminLoan
    ? null
    : adminLoan.status === "requested"
    ? {
        title: "Release this loan",
        description: `${loan.borrower} is waiting for the money. Send it, then record which bank it came from.`,
        amount: `₱${fmt(adminLoan.principal)}`,
        cta: "Release",
        onClick: () => setAdminSheet("release")
      }
    : adminLoan.status === "active" && adminLoan.remainingApproved <= 0
    ? {
        title: "Fully repaid · ready to close",
        description: "Closing it splits the interest earned across members.",
        amount: `${adminLoan.repaidApproved - adminLoan.principal < 0 ? "-" : "+"}₱${fmt(
          Math.abs(adminLoan.repaidApproved - adminLoan.principal)
        )} gain`,
        cta: "Review & close",
        onClick: () => setAdminSheet("close")
      }
    : adminLoan.status === "active" && adminLoan.remaining <= 0
    ? {
        title: "Repayment pending approval",
        description: "It's fully repaid, but part of it hasn't been approved yet. Approve it, then close this loan.",
        amount: `₱${fmt(adminLoan.pendingRepayment)} pending`,
        cta: "View",
        onClick: () => router.push(`/transactions?loan=${loanId}`)
      }
    : null

  const menuItems: { label: string; hint: string; onClick: () => void; danger?: boolean }[] = []
  if (adminLoan && adminLoan.status !== "closed") {
    menuItems.push({
      label: "Edit terms",
      hint: adminLoan.status === "requested" ? "Amount, interest, term and due date" : "Interest, term and due date",
      onClick: () => setAdminSheet("edit")
    })
  }
  if (adminLoan?.status === "requested") {
    menuItems.push({ label: "Release loan", hint: "Record the transfer and activate it", onClick: () => setAdminSheet("release") })
  }
  if (adminLoan?.status === "active" && adminLoan.remainingApproved <= 0) {
    menuItems.push({ label: "Close loan", hint: "Split the gain across members", onClick: () => setAdminSheet("close") })
  }
  if (adminLoan?.status === "active" && adminLoan.remainingApproved > 0) {
    menuItems.push({
      label: "Close early",
      hint: "Settle with what's been repaid so far",
      onClick: () => setAdminSheet("closeEarly"),
      danger: true
    })
  }
  if (adminLoan?.status === "closed") {
    menuItems.push({ label: "Reopen loan", hint: "Set it back to active", onClick: () => setAdminSheet("reopen") })
  }
  const totalHold = holds.reduce((sum, h) => sum + h.share * principalOutstanding, 0)

  return (
    <div>
      <button onClick={onBack} className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors">
        ← Loans
      </button>

      <div className="flex items-center gap-2 mb-1">
        <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
        <span className={`text-[11px] font-mono uppercase tracking-wide ${meta.text}`}>{meta.label}</span>
        {overdueLabel && (
          <>
            <span className="text-ink-soft">·</span>
            <span className="text-[11px] font-mono uppercase tracking-wide text-rust">⚠ {overdueLabel}</span>
          </>
        )}
      </div>
      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink min-w-0 break-words">{loan.loan}</h1>
        {isAdmin && adminLoan && (
          <AdminMenuButton onClick={() => setAdminSheet("actions")} label="Loan admin actions" />
        )}
      </div>
      {/* Borrower already leads the loan's own name above -- this line
          only adds what that doesn't cover. */}
      <p className="text-[13px] text-ink-soft mb-6">
        {loan.borrower_member_id === myMemberId && "You · "}Released {startLabel}
      </p>

      {/* Principal / repayment overview */}
      <div className="card px-5 pt-4 pb-3.5">
        <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">
          {loan.status === "closed" ? "Total Repaid" : "Outstanding Balance"}
        </p>
        <p className="font-mono [font-variant-numeric:tabular-nums] text-3xl font-bold text-ink">
          ₱{fmt(loan.status === "closed" ? loan.repayment : loan.outstanding)}
        </p>
        {loan.status !== "closed" && (
          <p className="text-[12px] font-mono font-bold text-gold mt-1">
            of ₱{fmt(loan.total_repayable)} total ·{" "}
            {formatInterestLabel(loan.interest_type, loan.interest_rate, loan.interest_amount, fmt)} interest
          </p>
        )}
        {!(loan.status === "closed" && fullyRepaid) && (
          <div className="mt-3">
            <div className="h-2 rounded-full bg-hairline overflow-hidden">
              <div
                className={`h-full ${loan.status === "closed" ? "bg-rust" : "bg-gold"}`}
                style={{ width: `${repaidPct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Full terms and repayment figures in one place, visible to every
          member -- the admin-only "Loan terms" block that used to repeat
          most of these is gone. */}
      <div className="card p-5 mt-4">
        <InfoBox label="Terms">
          <InfoRow label="Principal" value={`₱${fmt(loan.principal)}`} />
          <InfoRow
            label="Interest"
            value={
              loan.interest_type === "amount"
                ? `₱${fmt(loan.interest_amount ?? 0)} flat`
                : `${Number(loan.interest_rate ?? 0)}%`
            }
          />
          {termLabel && <InfoRow label="Term" value={termLabel} />}
          {loan.repayment_frequency === "monthly" && loan.due_day != null && (
            <InfoRow label="Due date" value={`${ordinalDay(loan.due_day)} of each month`} />
          )}
          {lumpSumDue && <InfoRow label="Due date" value={longDate(lumpSumDue)} />}
          {loan.notes && <InfoRow label="Notes" value={loan.notes} />}
        </InfoBox>

        <InfoBox label="Repayment">
          <InfoRow label="Total repayable" value={`₱${fmt(loan.total_repayable)}`} />
          <InfoRow
            label={loan.status === "closed" ? "Total repaid" : "Repaid so far"}
            value={`₱${fmt(loan.repayment)}`}
          />
          {pendingRepayment > 0 && (
            <InfoRow label="Awaiting approval" value={`+₱${fmt(pendingRepayment)}`} valueClass="text-gold" />
          )}
          {loan.status !== "closed" && (
            <InfoRow
              label="Outstanding"
              value={`₱${fmt(loan.outstanding)}`}
              valueClass={loan.outstanding > 0 ? "text-gold" : "text-ink"}
              bold
            />
          )}
          {loan.status === "closed" && (
            <InfoRow
              label={loan.gain >= 0 ? "Interest earned" : "Loss"}
              value={`${loan.gain >= 0 ? "+" : "-"}₱${fmt(Math.abs(loan.gain))}`}
              valueClass={loan.gain >= 0 ? "text-sage" : "text-rust"}
              bold
            />
          )}
          {closedLabel && <InfoRow label="Closed" value={closedLabel} />}
          {durationLabel(loan.start_date, loan.closed_date) && (
            <InfoRow label="Time to pay off" value={durationLabel(loan.start_date, loan.closed_date)!} />
          )}
        </InfoBox>
      </div>

      {/* Admin-only: the one thing this loan is waiting on, if anything --
          shown only when there's a step to take, in place of the old
          collapsible "Manage loan" box. Everything else is behind ⋯. */}
      {isAdmin && adminLoan && nextStep && (
        <section className="mt-8">
          <h2 className="font-display text-lg font-medium text-ink mb-1">Next Step</h2>
          <p className="text-[13px] text-ink-soft mb-3">{nextStep.description}</p>
          <div className="card px-5 py-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-ink font-medium">{nextStep.title}</p>
              <p className="font-mono [font-variant-numeric:tabular-nums] text-[13px] font-semibold text-ink">
                {nextStep.amount}
              </p>
            </div>
            <button
              onClick={nextStep.onClick}
              className="shrink-0 bg-ink text-paper px-3.5 py-2 rounded-sm text-[13px] font-medium"
            >
              {nextStep.cta}
            </button>
          </div>
        </section>
      )}

      {adminSheet === "actions" && adminLoan && (
        <Sheet title={loan.loan} onClose={() => setAdminSheet(null)}>
          <div className="card">
            <div className="px-5">
              {menuItems.map((item, i) => (
                <AdminActionRow key={item.label} {...item} last={i === menuItems.length - 1} />
              ))}
            </div>
          </div>
        </Sheet>
      )}

      {adminSheet === "edit" && adminLoan && (
        <EditLoanTermsSheet adminLoan={adminLoan} onClose={() => setAdminSheet(null)} onSaved={reloadAll} />
      )}

      {adminSheet === "release" && adminLoan && (
        <ReleaseLoanSheet
          adminLoan={adminLoan}
          banks={banks}
          onClose={() => setAdminSheet(null)}
          onReleased={reloadAll}
        />
      )}

      {(adminSheet === "close" || adminSheet === "closeEarly") && adminLoan && (
        <CloseLoanSheet
          adminLoan={adminLoan}
          borrowerName={loan.borrower}
          early={adminSheet === "closeEarly"}
          onClose={() => setAdminSheet(null)}
          onClosed={reloadAll}
        />
      )}

      {adminSheet === "reopen" && adminLoan && (
        <ReopenLoanSheet adminLoan={adminLoan} onClose={() => setAdminSheet(null)} onReopened={reloadAll} />
      )}

      {/* Distributed share per member (closed) / hold per member (active) */}
      <section className="mt-8">
        <h2 className="font-display text-lg font-medium text-ink mb-1">
          {loan.status === "active" ? "Hold per Member" : "Distributed Share per Member"}
        </h2>
        <p className="text-[13px] text-ink-soft mb-3">
          {loan.status === "closed"
            ? `Split by each eligible member's value in the fund on the day it closed.`
            : loan.status === "active"
            ? `How much of each eligible member's fund value is currently tied up funding this loan, based on their share of the pool when it was released. Shrinks as ${loan.borrower} repays it.`
            : "Once this loan is released, this will show how much of the fund is on hold for it, then its final gain split when it closes."}
        </p>

        {loadError && <p className="text-sm text-rust">{loadError}</p>}

        {loan.status === "active" && holds.length > 0 && (
          <div className="card">
            <div className="px-5">
              {holds.map((h, i) => (
                <div
                  key={h.member_id}
                  className={`py-3 flex justify-between items-center gap-3 ${
                    i !== holds.length - 1 ? "border-b border-dashed border-hairline" : ""
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-sm text-ink truncate">{h.member}</p>
                    {h.member_id === myMemberId && (
                      <span className="shrink-0 text-[9px] uppercase tracking-wide font-mono text-gold border border-gold/40 rounded px-1.5 py-0.5">
                        You
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col items-end shrink-0">
                    <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-ink">
                      ₱{fmt(h.share * principalOutstanding)}
                    </p>
                    <p className="text-[11px] text-ink-soft font-mono whitespace-nowrap">
                      {(h.share * 100).toFixed(2)}% of loan
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-hairline flex justify-between items-center">
              <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono">
                On hold across {holds.length} member{holds.length === 1 ? "" : "s"}
              </p>
              <p className="font-mono [font-variant-numeric:tabular-nums] text-[13px] font-semibold text-ink">
                ₱{fmt(totalHold)}
              </p>
            </div>
          </div>
        )}

        {loan.status === "active" && holds.length === 0 && !loadError && (
          <p className="text-sm text-ink-soft text-center py-8 card">
            No hold recorded for this loan.
          </p>
        )}

        {loan.status === "closed" && shares.length > 0 && (
          <div className="card">
            <div className="px-5">
              {shares.map((s, i) => (
                <div
                  key={s.member_id}
                  className={`py-3 flex justify-between items-center gap-3 ${
                    i !== shares.length - 1 ? "border-b border-dashed border-hairline" : ""
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-sm text-ink truncate">{s.member}</p>
                    {s.member_id === myMemberId && (
                      <span className="shrink-0 text-[9px] uppercase tracking-wide font-mono text-gold border border-gold/40 rounded px-1.5 py-0.5">
                        You
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col items-end shrink-0">
                    <p
                      className={`font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold ${
                        s.amount >= 0 ? "text-sage" : "text-rust"
                      }`}
                    >
                      {s.amount >= 0 ? "+" : "-"}₱{fmt(Math.abs(s.amount))}
                    </p>
                    <p className="text-[11px] text-ink-soft font-mono whitespace-nowrap">
                      {s.pct_share.toFixed(2)}% of ₱{fmt(s.current_value)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-hairline flex justify-between items-center">
              <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono">
                Split among {shares.length} member{shares.length === 1 ? "" : "s"}
              </p>
              <p className="font-mono [font-variant-numeric:tabular-nums] text-[13px] font-semibold text-ink">
                ₱{fmt(totalShared)}
              </p>
            </div>
          </div>
        )}

        {loan.status === "closed" && shares.length === 0 && !loadError && (
          <p className="text-sm text-ink-soft text-center py-8 card">
            No gain was distributed for this loan.
          </p>
        )}
      </section>

      {/* Recent transactions */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h2 className="font-display text-lg font-medium text-ink">Recent Transactions</h2>
          <button
            onClick={() => router.push(`/transactions?loan=${loanId}`)}
            className="shrink-0 text-[13px] font-medium text-gold"
          >
            View all →
          </button>
        </div>

        {recentTransactions.length > 0 ? (
          <div className="card px-5">
            {recentTransactions.map((t, i) => (
              <div
                key={t.transaction_id}
                className={`py-3 flex justify-between items-center gap-3 ${
                  i !== recentTransactions.length - 1 ? "border-b border-dashed border-hairline" : ""
                }`}
              >
                <div className="min-w-0">
                  <p className="text-sm text-ink truncate">
                    {TXN_TYPE_LABELS[t.classification] ?? t.classification}
                  </p>
                  <p className="text-[11px] text-ink-soft font-mono">
                    {/* t.date is a plain "YYYY-MM-DD" when txn_date is
                        set (the common case) -- append a local midnight
                        time so parsing doesn't roll it back a day in
                        timezones behind UTC. Falls back to the full
                        created_at timestamp as-is when txn_date is
                        null, which needs no such adjustment. */}
                    {new Date(t.date.length === 10 ? `${t.date}T00:00:00` : t.date).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                      year: "numeric"
                    })}
                    {t.status === "pending" ? " · pending" : ""}
                  </p>
                </div>
                <p
                  className={`shrink-0 font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold ${
                    t.amount < 0 ? "text-rust" : "text-sage"
                  }`}
                >
                  {t.amount < 0 ? "-" : "+"}₱{fmt(Math.abs(t.amount))}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-soft text-center py-8 card">
            No transactions recorded for this loan yet.
          </p>
        )}
      </section>
    </div>
  )
}
