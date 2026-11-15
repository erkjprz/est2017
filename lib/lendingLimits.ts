import { supabase } from "@/lib/supabase"
import { computeCurrentValueByMember, dateOnly } from "@/lib/currentValue"

// The three admin-set caps in public.lending_limits. Warn-only: the admin
// queue flags a Loan Release that would go over one, nothing blocks it.
export type LendingLimits = {
  max_total_loans_pct: number
  max_per_borrower_pct: number
  max_member_hold_pct: number
  updated_at: string | null
  updated_by_name: string | null
}

export type BorrowerExposure = {
  key: string
  name: string
  // Principal still unpaid on their active loans.
  active: number
  // Principal of their loans still waiting on approval.
  requested: number
}

export type MemberHold = {
  member_id: string
  name: string
  totalValue: number
  onHold: number
}

export type LendingPosition = {
  limits: LendingLimits
  cash: number
  // Principal still unpaid across every active loan.
  loanedOut: number
  // Cash plus what's out on loan -- releasing a loan moves money from one
  // to the other, so this doesn't change when a loan is approved.
  fundTotal: number
  borrowers: BorrowerExposure[]
  members: MemberHold[]
  // Each member's share of a loan approved today -- the same pool split
  // approveLoanRelease freezes into the loan's hold.
  sharesToday: Map<string, number>
  // Requested loan -> whose it is, so a pending Loan Release can be
  // matched to the borrower's other loans.
  requestedLoanBorrower: Record<string, string>
}

export type RequestCheck = {
  amount: number
  borrowerName: string
  availableBefore: number
  totalAfter: number
  totalAfterPct: number
  borrowerAfter: number
  borrowerAfterPct: number
  overTotalBy: number
  overBorrowerBy: number
  // Members whose hold would be over the limit once this loan is approved,
  // highest first.
  overHold: { name: string; pct: number }[]
  highestHold: { name: string; pct: number } | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

// A loan points at its borrower either directly (member_id) or through
// borrowers (older borrower-only records like Joy's, or Andy's first
// loan) -- both resolve to the same person when that borrower has a member
// account, so their loans are counted together.
function borrowerKey(loan: { member_id: string | null; borrower_id: string | null }, borrowerMember: Record<string, string | null>) {
  if (loan.member_id) return loan.member_id
  if (loan.borrower_id) return borrowerMember[loan.borrower_id] ?? `borrower:${loan.borrower_id}`
  return "unknown"
}

export async function fetchLendingLimits(): Promise<LendingLimits> {
  const { data, error } = await supabase
    .from("lending_limits")
    .select("max_total_loans_pct, max_per_borrower_pct, max_member_hold_pct, updated_at, updated_by")
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error("Lending limits aren't set up yet.")

  let updated_by_name: string | null = null
  if (data.updated_by) {
    const { data: who } = await supabase.from("members").select("name").eq("member_id", data.updated_by).maybeSingle()
    updated_by_name = who?.name ?? null
  }

  return {
    max_total_loans_pct: Number(data.max_total_loans_pct),
    max_per_borrower_pct: Number(data.max_per_borrower_pct),
    max_member_hold_pct: Number(data.max_member_hold_pct),
    updated_at: data.updated_at,
    updated_by_name
  }
}

export async function saveLendingLimits(limits: Pick<LendingLimits, "max_total_loans_pct" | "max_per_borrower_pct" | "max_member_hold_pct">) {
  const { error } = await supabase
    .from("lending_limits")
    .update({
      max_total_loans_pct: limits.max_total_loans_pct,
      max_per_borrower_pct: limits.max_per_borrower_pct,
      max_member_hold_pct: limits.max_member_hold_pct
    })
    .eq("id", true)
  if (error) throw new Error(error.message)
}

export async function fetchLendingPosition(): Promise<LendingPosition> {
  const today = dateOnly(new Date())

  const [limits, fundRes, loansRes, repaymentsRes, borrowersRes, membersRes, perfRes, sharesToday] = await Promise.all([
    fetchLendingLimits(),
    supabase.from("v_fund_summary").select("total_cash").single(),
    supabase.from("loans").select("loan_id, member_id, borrower_id, status, principal").in("status", ["active", "requested"]),
    supabase.from("transactions").select("loan_id, amount").eq("classification", "Loan Repayment").eq("status", "approved"),
    supabase.from("borrowers").select("borrower_id, member_id, name"),
    supabase.from("members").select("member_id, name, status"),
    supabase.from("v_member_performance").select("member_id, total_value, money_on_hold"),
    computeCurrentValueByMember(today).then((values) => {
      const total = Array.from(values.values()).reduce((sum, v) => sum + v, 0)
      const shares = new Map<string, number>()
      if (total > 0) values.forEach((v, id) => shares.set(id, v / total))
      return shares
    })
  ])

  const firstError = fundRes.error || loansRes.error || repaymentsRes.error || borrowersRes.error || membersRes.error || perfRes.error
  if (firstError) throw new Error(firstError.message)

  const memberName: Record<string, string> = {}
  const memberApproved = new Set<string>()
  for (const m of membersRes.data ?? []) {
    memberName[m.member_id] = m.name
    if (m.status === "approved") memberApproved.add(m.member_id)
  }

  const borrowerMember: Record<string, string | null> = {}
  const borrowerName: Record<string, string> = {}
  for (const b of borrowersRes.data ?? []) {
    borrowerMember[b.borrower_id] = b.member_id
    borrowerName[`borrower:${b.borrower_id}`] = b.name
  }

  const repaid: Record<string, number> = {}
  for (const r of repaymentsRes.data ?? []) {
    if (r.loan_id) repaid[r.loan_id] = (repaid[r.loan_id] ?? 0) + Number(r.amount)
  }

  const byBorrower = new Map<string, BorrowerExposure>()
  const requestedLoanBorrower: Record<string, string> = {}
  let loanedOut = 0

  for (const loan of loansRes.data ?? []) {
    const key = borrowerKey(loan, borrowerMember)
    const entry =
      byBorrower.get(key) ??
      { key, name: memberName[key] ?? borrowerName[key] ?? "Unknown borrower", active: 0, requested: 0 }

    if (loan.status === "active") {
      // Same "principal still out" as v_active_loan_outstanding, which the
      // member holds are built on.
      const out = Math.max(0, Number(loan.principal) - (repaid[loan.loan_id] ?? 0))
      entry.active += out
      loanedOut += out
    } else {
      entry.requested += Number(loan.principal)
      requestedLoanBorrower[loan.loan_id] = key
    }
    byBorrower.set(key, entry)
  }

  const members: MemberHold[] = (perfRes.data ?? [])
    .filter((p) => memberApproved.has(p.member_id) && Number(p.total_value) > 0)
    .map((p) => ({
      member_id: p.member_id,
      name: memberName[p.member_id] ?? "Unknown",
      totalValue: Number(p.total_value),
      onHold: Number(p.money_on_hold ?? 0)
    }))
    .sort((a, b) => b.onHold / b.totalValue - a.onHold / a.totalValue)

  const cash = Number(fundRes.data.total_cash)

  return {
    limits,
    cash: round2(cash),
    loanedOut: round2(loanedOut),
    fundTotal: round2(cash + loanedOut),
    borrowers: Array.from(byBorrower.values()).sort((a, b) => b.active + b.requested - (a.active + a.requested)),
    members,
    sharesToday,
    requestedLoanBorrower
  }
}

export function availableToLend(position: LendingPosition): number {
  return Math.max(0, round2((position.limits.max_total_loans_pct / 100) * position.fundTotal - position.loanedOut))
}

export function maxPerBorrower(position: LendingPosition): number {
  return round2((position.limits.max_per_borrower_pct / 100) * position.fundTotal)
}

export function holdPct(m: MemberHold): number {
  return m.totalValue > 0 ? (m.onHold / m.totalValue) * 100 : 0
}

// What approving one pending Loan Release would do to all three limits.
export function checkLoanRequest(position: LendingPosition, loanId: string, amount: number): RequestCheck {
  const { limits, fundTotal } = position
  const key = position.requestedLoanBorrower[loanId]
  const borrower = position.borrowers.find((b) => b.key === key)

  const totalAfter = position.loanedOut + amount
  // Everything this borrower has out or waiting, this request included --
  // a top-up counts as the whole amount they'd owe, not just the new cash.
  const borrowerAfter = borrower ? borrower.active + borrower.requested : amount

  const holdLimit = limits.max_member_hold_pct
  const after = position.members.map((m) => {
    const added = (position.sharesToday.get(m.member_id) ?? 0) * amount
    return { name: m.name, pct: ((m.onHold + added) / m.totalValue) * 100 }
  })
  after.sort((a, b) => b.pct - a.pct)

  return {
    amount,
    borrowerName: borrower?.name ?? "This borrower",
    availableBefore: availableToLend(position),
    totalAfter: round2(totalAfter),
    totalAfterPct: fundTotal > 0 ? (totalAfter / fundTotal) * 100 : 0,
    borrowerAfter: round2(borrowerAfter),
    borrowerAfterPct: fundTotal > 0 ? (borrowerAfter / fundTotal) * 100 : 0,
    overTotalBy: Math.max(0, round2(totalAfter - (limits.max_total_loans_pct / 100) * fundTotal)),
    overBorrowerBy: Math.max(0, round2(borrowerAfter - maxPerBorrower(position))),
    overHold: after.filter((m) => m.pct > holdLimit + 1e-9),
    highestHold: after[0] ?? null
  }
}
