"use client"

import { loanPickLabel } from "@/lib/loanFormat"
import { Sheet } from "@/app/components/Sheet"
import { totalRepayable } from "@/lib/loanMath"

type Loan = {
  loan_id: string
  principal: number
  interest_type: "rate" | "amount"
  interest_rate: number | null
  interest_amount: number | null
  status: string
  start_date: string
}

export function LoanRowIcon() {
  return (
    <span className="w-9 h-9 rounded-full bg-ink-soft flex items-center justify-center flex-shrink-0">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4.5 h-4.5 text-paper">
        <rect x="3.5" y="7" width="17" height="12" rx="1.5" />
        <path d="M3.5 11h17M8 7V5.5a1.5 1.5 0 011.5-1.5h5a1.5 1.5 0 011.5 1.5V7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

// Lists a member's active loans as tappable rows -- same picker-sheet
// pattern budget-tracker uses for anything with more to show per option
// than a plain <option> can (WalletPickerSheet, RecurrencePickerSheet):
// each row surfaces what's actually left to pay, so picking the right
// loan doesn't need selecting one first just to check.
export function LoanPickerSheet({
  loans,
  repaidTotals,
  onSelect,
  onClose
}: {
  loans: Loan[]
  repaidTotals: Record<string, number>
  onSelect: (loan: Loan) => void
  onClose: () => void
}) {
  const fmt = (n: number) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <Sheet title="Which loan" onClose={onClose}>
      {loans.length === 0 ? (
        <p className="text-center text-sm text-ink-soft py-6">No active loans to pay against.</p>
      ) : (
        <div className="card divide-y divide-hairline overflow-hidden">
          {loans.map((loan) => {
            const remaining = Math.max(
              0,
              totalRepayable(Number(loan.principal), loan.interest_type, Number(loan.interest_rate || 0), Number(loan.interest_amount || 0)) -
                (repaidTotals[loan.loan_id] || 0)
            )
            return (
              <button
                key={loan.loan_id}
                onClick={() => onSelect(loan)}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
              >
                <LoanRowIcon />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-ink">
                    {loanPickLabel(Number(loan.principal), loan.start_date, fmt)}
                  </span>
                  <span className="block text-xs text-ink-soft mt-0.5">₱{fmt(remaining)} left to pay</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </Sheet>
  )
}
