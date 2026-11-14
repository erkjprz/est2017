"use client"

import { dateOnly } from "@/lib/currentValue"
import { firstUnpaidDueDate, longDate, ordinalDay } from "@/lib/loanFormat"

// Shown in place of a release sheet's Approve button when a monthly loan's
// First payment is still "from release", so payments starting right away
// is a choice rather than a missed field. Used by the admin queue's review
// sheet and the loan page's Release Loan sheet.
export function needsFirstPaymentConfirm(loan: {
  repayment_frequency?: string | null
  payments_start_date?: string | null
} | null | undefined): boolean {
  return loan?.repayment_frequency === "monthly" && !loan?.payments_start_date
}

export function FirstPaymentConfirm({
  dueDay,
  busy = false,
  onBack,
  onApprove
}: {
  dueDay: number | null | undefined
  busy?: boolean
  onBack: () => void
  onApprove: () => void
}) {
  const today = dateOnly(new Date())
  const firstDue = dueDay ? new Date(firstUnpaidDueDate(null, today, null, dueDay)).toISOString().slice(0, 10) : null

  return (
    <div>
      <div className="rounded-md border border-gold/40 bg-gold/5 px-4 py-3 mb-3">
        <p className="text-sm font-semibold text-ink mb-1">First payment is set to &ldquo;from release&rdquo;</p>
        <p className="text-[13px] text-ink-soft">
          {firstDue ? (
            <>
              If you approve today, the first payment is due <span className="text-ink font-semibold">{longDate(firstDue)}</span>{" "}
              (then the {ordinalDay(dueDay!)} of each month), with a reminder 3 days before.
            </>
          ) : (
            <>If you approve today, payments start now, and the loan shows overdue after 45 days without one.</>
          )}{" "}
          If payments should start later, go back and set a First payment date.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="shrink-0 border border-hairline text-ink px-5 py-3.5 rounded-full text-base font-semibold"
          onClick={onBack}
          disabled={busy}
        >
          Go back
        </button>
        <button
          type="button"
          className="flex-1 bg-ink text-paper px-6 py-3.5 rounded-full text-base font-bold shadow-lg disabled:opacity-50 disabled:shadow-none"
          onClick={onApprove}
          disabled={busy}
        >
          {busy ? "Approving…" : "Approve, payments from release"}
        </button>
      </div>
    </div>
  )
}
