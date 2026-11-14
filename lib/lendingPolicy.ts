import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

// The fund's lending policy as members see it: the three limits and how
// much of the fund is out on loan, as percentages only (get_lending_policy).
// Borrowers get nothing back, so this resolves to null for them -- and for
// anyone if the call fails, in which case the policy simply isn't shown.
export type LendingPolicy = {
  maxTotalLoansPct: number
  maxPerBorrowerPct: number
  maxMemberHoldPct: number
  loanedOutPct: number
}

export async function fetchLendingPolicy(): Promise<LendingPolicy | null> {
  const { data, error } = await supabase.rpc("get_lending_policy")
  const row = !error && Array.isArray(data) ? data[0] : null
  if (!row) return null
  return {
    maxTotalLoansPct: Number(row.max_total_loans_pct),
    maxPerBorrowerPct: Number(row.max_per_borrower_pct),
    maxMemberHoldPct: Number(row.max_member_hold_pct),
    loanedOutPct: Number(row.loaned_out_pct ?? 0)
  }
}

export function useLendingPolicy(): LendingPolicy | null {
  const [policy, setPolicy] = useState<LendingPolicy | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchLendingPolicy()
      .then((p) => {
        if (!cancelled) setPolicy(p)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return policy
}

export const policyPct = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
