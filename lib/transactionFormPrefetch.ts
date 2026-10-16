import { supabase } from "@/lib/supabase"
import { readCache, writeCache } from "@/lib/cache"

// Everything NewTransactionSheet needs before it can render anything but
// "Loading..." -- pulled out of the sheet itself so Navbar can kick this
// off the moment a page mounts (well before the FAB is ever tapped),
// while the sheet itself still owns re-fetching pieces of this in
// response to user interaction (on-behalf-of switch, type switch).
export type TransactionFormData = {
  banks: any[]
  allMembers: any[]
  investmentsList: any[]
  myLoans: any[]
  loanRepaidTotals: Record<string, number>
  contributionDefault: number | null
  contributionBankDefault: string | null
  loanPaymentDefault: number | null
  loanPaymentBankDefault: string | null
}

// Backed by lib/cache.ts's localStorage-based cache, same as auth-context's
// member seed and dashboard's own snapshot -- an in-memory-only version of
// this (the original approach) meant a genuine app relaunch (not just
// navigating within an already-open session) always started cold, since
// there's nothing left in memory to reuse. That defeated the purpose for
// exactly the case people actually hit: opening the app and tapping the
// FAB, not just tapping it again mid-session.
//
// Keyed on isAdmin as well as memberId -- auth-context.tsx can seed
// `member` from a stale cached role before the real Supabase check
// corrects it (see its own comment), so a role flip (or a plain stale
// cached role from an earlier session) can mean this fires once with the
// wrong isAdmin before firing again with the right one moments later.
// Without isAdmin in the key, that first wrong-shaped fetch (e.g.
// allMembers left empty for a not-yet-known admin) would satisfy the
// cache check for the corrected render too, and NewTransactionSheet
// would never re-fetch to pick up the correction -- it only seeds state
// once at mount and bails on any fetch of its own if *something* is
// already cached, not specifically something cached for the current
// isAdmin.
function cacheKey(memberId: string, isAdmin: boolean): string {
  return `transactionForm:${memberId}:${isAdmin}`
}

export function getCachedTransactionFormData(memberId: string, isAdmin: boolean): TransactionFormData | null {
  return readCache<TransactionFormData>(cacheKey(memberId, isAdmin)) ?? null
}

// Callable from both Navbar (fire-and-forget, to warm the cache early)
// and NewTransactionSheet itself (awaited, as a fallback when the sheet
// gets opened before Navbar's own prefetch has finished -- e.g. tapping
// the FAB within the first instant of a page load).
export async function loadTransactionFormData(
  memberId: string,
  isAdmin: boolean
): Promise<{ data: TransactionFormData | null; error: string | null }> {
  const { data: bankList, error: bankError } = await supabase
    .from("bank_accounts")
    .select("id, bank_name, account_name")
    .order("bank_name")

  if (bankError) return { data: null, error: bankError.message }

  let allMembers: any[] = []
  if (isAdmin) {
    const { data: memberList } = await supabase.from("members").select("member_id, name").order("name")
    allMembers = memberList ?? []
  }

  // Closed investments are excluded -- closing settles the books, so no
  // new returns should get recorded against one afterward without
  // reopening it first.
  const { data: investmentList } = await supabase
    .from("investments")
    .select("investment_id, name, affects_cash")
    .eq("status", "open")
    .order("name")

  const { data: borrowerRow } = await supabase
    .from("borrowers")
    .select("borrower_id")
    .eq("member_id", memberId)
    .maybeSingle()

  const loanFilter = borrowerRow?.borrower_id
    ? `member_id.eq.${memberId},borrower_id.eq.${borrowerRow.borrower_id}`
    : `member_id.eq.${memberId}`

  const { data: loans } = await supabase
    .from("loans")
    .select("loan_id, principal, interest_type, interest_rate, interest_amount, term_months, status, start_date")
    .or(loanFilter)
    .in("status", ["active", "requested"])
    .order("start_date", { ascending: false })

  const myLoans = loans ?? []
  const loanIds = myLoans.map((l) => l.loan_id)
  const loanRepaidTotals: Record<string, number> = {}
  if (loanIds.length > 0) {
    const { data: repayments } = await supabase
      .from("transactions")
      .select("loan_id, amount")
      .in("loan_id", loanIds)
      .eq("classification", "Loan Repayment")
      .in("status", ["pending", "approved"])

    ;(repayments ?? []).forEach((r) => {
      loanRepaidTotals[r.loan_id] = (loanRepaidTotals[r.loan_id] || 0) + Number(r.amount)
    })
  }

  const { data: prefs } = await supabase
    .from("members")
    .select(
      "default_contribution_amount, default_contribution_bank_id, default_loan_payment_amount, default_loan_payment_bank_id"
    )
    .eq("member_id", memberId)
    .maybeSingle()

  const data: TransactionFormData = {
    banks: bankList ?? [],
    allMembers,
    investmentsList: investmentList ?? [],
    myLoans,
    loanRepaidTotals,
    contributionDefault: prefs?.default_contribution_amount != null ? Number(prefs.default_contribution_amount) : null,
    contributionBankDefault: prefs?.default_contribution_bank_id ?? null,
    loanPaymentDefault: prefs?.default_loan_payment_amount != null ? Number(prefs.default_loan_payment_amount) : null,
    loanPaymentBankDefault: prefs?.default_loan_payment_bank_id ?? null
  }

  writeCache(cacheKey(memberId, isAdmin), data)
  return { data, error: null }
}
