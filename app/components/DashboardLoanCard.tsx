"use client"

import { useRouter } from "next/navigation"
import { formatInterestLabel } from "@/lib/loanFormat"
import type { Loan } from "@/lib/useLoansSummary"
import { NextPaymentBox, nextPayment } from "@/app/components/LoanCards"

const fmt = (n: number) =>
  Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// A member's active loan on their dashboard -- what's left, how far along,
// and what's due next, same as a borrower's /borrower card minus the
// transaction list. Tapping opens the loan's full detail in Breakdown.
export function DashboardLoanCard({ loan }: { loan: Loan }) {
  const router = useRouter()
  const interestFree = loan.totalRepayable <= loan.principal
  const repaidPct = loan.totalRepayable > 0 ? Math.min(100, (loan.repaid / loan.totalRepayable) * 100) : 0

  return (
    <button
      onClick={() => router.push(`/fund-breakdown?tab=loans&loan=${loan.loan_id}`)}
      className="w-full text-left card px-5 pt-4 pb-3.5 mt-3 hover:bg-paper transition-colors"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono">My Loan</p>
        <p className="text-[11px] font-mono text-gold truncate">
          {interestFree ? "No interest" : formatInterestLabel(loan.interest_type, loan.interest_rate, loan.interest_amount, fmt)}
        </p>
      </div>
      <p className="font-mono [font-variant-numeric:tabular-nums] text-2xl font-bold text-ink mt-1.5">
        ₱{fmt(loan.outstanding)}
      </p>
      <p className="text-[11px] text-ink-soft font-mono">outstanding</p>

      <div className="h-1.5 rounded-full bg-hairline overflow-hidden mt-3">
        <div className="h-full bg-gold" style={{ width: `${repaidPct}%` }} />
      </div>
      <p className="text-[11px] text-ink-soft mt-1.5 font-mono [font-variant-numeric:tabular-nums]">
        ₱{fmt(loan.repaid)} of ₱{fmt(loan.totalRepayable)} repaid
      </p>
      {loan.pendingRepaid > 0 && (
        <p className="text-[12px] text-gold mt-1">₱{fmt(loan.pendingRepaid)} waiting for approval</p>
      )}

      <NextPaymentBox next={nextPayment(loan)} />

      <p className="text-[12px] text-gold font-semibold mt-2.5">View loan →</p>
    </button>
  )
}
