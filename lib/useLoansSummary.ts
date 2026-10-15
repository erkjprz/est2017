import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { totalRepayable, type InterestType } from "@/lib/loanMath"
import { readCache, writeCache } from "@/lib/cache"

export type LoanTransaction = {
  transaction_id: string
  classification: string
  amount: number
  status: "pending" | "approved" | "rejected" | "cancelled"
  date: string
  rejection_reason: string | null
  receipt_url: string | null
  receipt_urls: string[]
  // Not read by LoanCards' own rendering -- carried through so a row can
  // be handed straight to EditTransactionSheet via transactionRowCache
  // instead of it re-fetching by ID (see LoanCards' Edit button).
  member_id: string | null
  bank_account_id: string | null
  to_bank_account_id: string | null
  loan_id: string | null
  investment_id: string | null
  description: string | null
  submitted_by: string | null
  interest_distributed: boolean
}

export type Loan = {
  loan_id: string
  name: string | null
  status: "requested" | "active" | "closed"
  start_date: string
  principal: number
  interest_type: InterestType
  interest_rate: number
  interest_amount: number
  term_months: number | null
  repayment_frequency: string | null
  due_day: number | null
  repaid: number
  // Submitted repayments still waiting on an admin -- not in `repaid` yet.
  pendingRepaid: number
  lastRepaymentDate: string | null
  // Latest payment still waiting for approval -- the card's next due date
  // counts it as paid.
  lastPendingDate: string | null
  totalRepayable: number
  outstanding: number
  transactions: LoanTransaction[]
}

// Shared between /borrower (the borrower's own view), the admin "view as"
// preview, and the splash at / -- same loans-plus-transactions query for
// any of them, parameterized by whose member_id/borrower_id to fetch.
const cacheKeyFor = (memberId: string) => `loans:${memberId}`

// The actual fetch, pulled out of the hook so the splash can run it
// imperatively to warm the cache before ever navigating to /borrower.
export async function fetchLoansSummary(memberId: string): Promise<{ loans: Loan[]; error: string | null }> {
  const { data: borrowerRow } = await supabase
    .from("borrowers")
    .select("borrower_id")
    .eq("member_id", memberId)
    .maybeSingle()

  const filter = borrowerRow?.borrower_id
    ? `member_id.eq.${memberId},borrower_id.eq.${borrowerRow.borrower_id}`
    : `member_id.eq.${memberId}`

  const { data: myLoans, error } = await supabase
    .from("loans")
    .select("*")
    .or(filter)
    .order("start_date", { ascending: false })

  if (error) return { loans: [], error: error.message }

  const loanIds = (myLoans ?? []).map((l) => l.loan_id)
  const { data: allTxns, error: txnsError } = loanIds.length
    ? await supabase
        .from("transactions")
        .select(
          "transaction_id, loan_id, classification, amount, status, txn_date, created_at, rejection_reason, receipt_url, receipt_urls, member_id, bank_account_id, to_bank_account_id, investment_id, description, submitted_by, interest_distributed"
        )
        .in("loan_id", loanIds)
        .neq("status", "cancelled")
        .order("txn_date", { ascending: false })
    : { data: [], error: null }

  if (txnsError) return { loans: [], error: txnsError.message }

  const withProgress: Loan[] = (myLoans ?? []).map((loan) => {
    const related = (allTxns ?? []).filter((t) => t.loan_id === loan.loan_id)

    // Only actual repayments count toward progress/outstanding -- the
    // Loan Release (disbursement) and any other loan-linked entries are
    // shown for context but never repayment amounts.
    const repaid = related
      .filter((t) => t.classification === "Loan Repayment" && t.status === "approved")
      .reduce((sum, t) => sum + Number(t.amount), 0)

    const pendingRepaid = related
      .filter((t) => t.classification === "Loan Repayment" && t.status === "pending")
      .reduce((sum, t) => sum + Number(t.amount), 0)
    const lastRepaymentDate =
      related
        .filter((t) => t.classification === "Loan Repayment" && t.status === "approved")
        .map((t) => (t.txn_date ?? t.created_at ?? "").slice(0, 10))
        .filter(Boolean)
        .sort()
        .pop() ?? null
    const lastPendingDate =
      related
        .filter((t) => t.classification === "Loan Repayment" && t.status === "pending")
        .map((t) => (t.txn_date ?? t.created_at ?? "").slice(0, 10))
        .filter(Boolean)
        .sort()
        .pop() ?? null

    const interestType: InterestType = loan.interest_type === "amount" ? "amount" : "rate"
    const totalRepayableVal = totalRepayable(
      Number(loan.principal),
      interestType,
      Number(loan.interest_rate ?? 0),
      Number(loan.interest_amount ?? 0)
    )

    return {
      loan_id: loan.loan_id,
      name: loan.name,
      status: loan.status,
      start_date: loan.start_date,
      principal: Number(loan.principal),
      interest_type: interestType,
      interest_rate: Number(loan.interest_rate ?? 0),
      interest_amount: Number(loan.interest_amount ?? 0),
      term_months: loan.term_months,
      repayment_frequency: loan.repayment_frequency ?? null,
      due_day: loan.due_day ?? null,
      repaid,
      pendingRepaid,
      lastRepaymentDate,
      lastPendingDate,
      totalRepayable: totalRepayableVal,
      outstanding: loan.status === "closed" ? 0 : Math.max(0, totalRepayableVal - repaid),
      transactions: related.map((t) => ({
        transaction_id: t.transaction_id,
        classification: t.classification,
        amount: Number(t.amount),
        status: t.status,
        date: t.txn_date ?? t.created_at,
        rejection_reason: t.rejection_reason ?? null,
        receipt_url: t.receipt_url ?? null,
        receipt_urls: t.receipt_urls ?? [],
        member_id: t.member_id ?? null,
        bank_account_id: t.bank_account_id ?? null,
        to_bank_account_id: t.to_bank_account_id ?? null,
        loan_id: t.loan_id ?? null,
        investment_id: t.investment_id ?? null,
        description: t.description ?? null,
        submitted_by: t.submitted_by ?? null,
        interest_distributed: t.interest_distributed === true
      }))
    }
  })

  return { loans: withProgress, error: null }
}

// Called from the splash at / -- best-effort, same as warmDashboardCache:
// on error, just don't warm the cache and let /borrower's own fetch on
// mount cover it.
export async function warmLoansCache(memberId: string): Promise<void> {
  const { loans, error } = await fetchLoansSummary(memberId)
  if (!error) writeCache(cacheKeyFor(memberId), loans)
}

export function useLoansSummary(memberId: string | undefined) {
  const cached = memberId ? readCache<Loan[]>(cacheKeyFor(memberId)) : undefined
  const [loading, setLoading] = useState(!cached)
  const [loans, setLoans] = useState<Loan[]>(cached ?? [])
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    if (!memberId) return

    let cancelled = false

    async function load() {
      // Only show the blocking loader on a true cold start -- if we
      // already rendered cached data, refresh quietly behind it instead
      // of flashing back to a spinner on every navigation.
      if (!readCache(cacheKeyFor(memberId!))) setLoading(true)
      setLoadError("")

      const { loans: nextLoans, error } = await fetchLoansSummary(memberId!)

      if (cancelled) return

      if (error) {
        setLoadError(error)
        setLoading(false)
        return
      }

      setLoans(nextLoans)
      setLoading(false)
      writeCache(cacheKeyFor(memberId!), nextLoans)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [memberId])

  return { loading, loans, loadError }
}
