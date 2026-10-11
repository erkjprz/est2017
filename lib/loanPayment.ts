import { totalRepayable, type InterestType } from "@/lib/loanMath"

// Where a loan payment's amount starts -- shared by the borrower repay page
// and the + New sheet's Loan Payment form.

export type PayableLoan = {
  principal: number
  interest_type: InterestType
  interest_rate: number | null
  interest_amount: number | null
  term_months: number | null
  repayment_frequency: string | null
}

// What's still owed on a loan once everything already submitted is
// counted, and the usual payment toward it: one installment (total ÷ term)
// for a monthly loan, or the whole remainder for a lump sum.
export function loanRemaining(loan: PayableLoan, submittedTotal: number): number {
  const total = totalRepayable(
    Number(loan.principal),
    loan.interest_type,
    Number(loan.interest_rate || 0),
    Number(loan.interest_amount || 0)
  )
  return Math.max(0, Math.round((total - submittedTotal) * 100) / 100)
}

export function suggestedPayment(loan: PayableLoan, submittedTotal: number): number {
  const remaining = loanRemaining(loan, submittedTotal)
  if (loan.repayment_frequency === "monthly" && loan.term_months) {
    const total = totalRepayable(
      Number(loan.principal),
      loan.interest_type,
      Number(loan.interest_rate || 0),
      Number(loan.interest_amount || 0)
    )
    return Math.min(Math.round((total / loan.term_months) * 100) / 100, remaining)
  }
  return remaining
}

// Where the amount starts for a loan: the saved default if there is one,
// otherwise the usual payment -- either way never more than what's left.
export function startingAmount(loan: PayableLoan, submittedTotal: number, savedAmount: number | null): number {
  if (savedAmount == null) return suggestedPayment(loan, submittedTotal)
  const remaining = loanRemaining(loan, submittedTotal)
  return remaining > 0 ? Math.min(savedAmount, remaining) : savedAmount
}
