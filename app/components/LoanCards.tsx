"use client"

import { useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import ReceiptModal from "@/app/components/ReceiptModal"
import { Sheet } from "@/app/components/Sheet"
import { ReviewRow } from "@/app/components/TransactionFormUI"
import { ReceiptThumbs } from "@/app/components/admin/ReceiptThumb"
import { receiptPaths } from "@/lib/receiptUrl"
import { formatInterestLabel, nextDueDate, paymentOverdueLabel } from "@/lib/loanFormat"
import { TRANSACTION_TYPE_LABELS } from "@/lib/transactionLabels"
import type { Loan, LoanTransaction } from "@/lib/useLoansSummary"
import { cacheTransactionRow } from "@/lib/transactionRowCache"

// A closed loan isn't always a full repayment -- an admin can close one
// early via "Close Early" with less than totalRepayable
// actually repaid. Label off the real repaid amount instead of assuming
// every closed loan was paid off in full (same rule as LoanDetailPanel
// and the Breakdown > Loans list).
function loanStatusMeta(loan: Loan): { label: string; dot: string; text: string } {
  if (loan.status === "active") return { label: "Active", dot: "bg-gold", text: "text-gold" }
  if (loan.status === "requested") return { label: "Requested", dot: "bg-ink-soft", text: "text-ink-soft" }
  return loan.repaid >= loan.totalRepayable
    ? { label: "Repaid", dot: "bg-sage", text: "text-sage" }
    : { label: "Closed early", dot: "bg-rust", text: "text-rust" }
}

const fmt = (n: number) =>
  Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// "15 Oct", with the year only when it isn't this year.
const shortDate = (ms: number) => {
  const d = new Date(ms)
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(d.getUTCFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
    timeZone: "UTC"
  })
}

// What the borrower owes next on an active loan: one installment (total ÷
// term) for a monthly loan, due on the next due date when one is set; the
// whole remaining balance for a lump sum, due at the end of the term.
// Payments still waiting for approval already count against what's left.
type NextPayment =
  | { kind: "due"; amount: number; dueLabel: string | null; overdue: string | null }
  | { kind: "covered" }

function nextPayment(loan: Loan): NextPayment | null {
  if (loan.status !== "active") return null
  const remaining = Math.max(0, loan.outstanding - (loan.pendingRepaid ?? 0))
  if (remaining <= 0.005) return (loan.pendingRepaid ?? 0) > 0 ? { kind: "covered" } : null

  // A payment waiting for approval pauses the overdue flag, the same way
  // it pauses the overdue reminders -- the borrower already paid; the admin
  // just hasn't approved it yet.
  const hasPending = (loan.pendingRepaid ?? 0) > 0
  const overdue = hasPending
    ? null
    : paymentOverdueLabel(
        loan.status,
        loan.repayment_frequency,
        loan.start_date,
        loan.lastRepaymentDate ?? null,
        loan.due_day
      )

  if (loan.repayment_frequency === "monthly" && loan.term_months) {
    const installment = Math.round((loan.totalRepayable / loan.term_months) * 100) / 100
    const dueLabel = loan.due_day ? shortDate(nextDueDate(
          [loan.lastRepaymentDate, loan.lastPendingDate].filter((d): d is string => !!d).sort().pop() ?? loan.start_date,
          loan.due_day
        )) : null
    return { kind: "due", amount: Math.min(installment, remaining), dueLabel, overdue }
  }

  let dueLabel: string | null = null
  if (loan.term_months) {
    const [y, m, d] = loan.start_date.split("-").map(Number)
    dueLabel = shortDate(Date.UTC(y, m - 1 + loan.term_months, d))
  }
  return { kind: "due", amount: remaining, dueLabel, overdue }
}

// `editable` gates the Edit/Fix & resend actions -- off for the admin
// "view as" preview, which is read-only.
export function LoanCards({ loans, editable }: { loans: Loan[]; editable: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const [openReceipt, setOpenReceipt] = useState<{ paths: string[]; index: number } | null>(null)
  const [openTxn, setOpenTxn] = useState<LoanTransaction | null>(null)

  if (loans.length === 0) {
    return (
      <p className="text-sm text-ink-soft text-center py-12 card">
        No loans on record yet.
      </p>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        {loans.map((loan) => {
          const meta = loanStatusMeta(loan)
          const fullyRepaid = loan.repaid >= loan.totalRepayable
          const repaidPct = loan.totalRepayable > 0
            ? Math.min(100, (loan.repaid / loan.totalRepayable) * 100)
            : 0

          return (
            <div key={loan.loan_id} className="card px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <p className="font-display text-[17px] font-semibold text-ink truncate">
                  {loan.name || "Loan"}
                </p>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                  <span className={`text-[11px] font-mono uppercase tracking-wide ${meta.text}`}>
                    {meta.label}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 items-baseline mt-3.5">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">Principal</p>
                  <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-ink">
                    ₱{fmt(loan.principal)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gold font-mono font-bold">Interest</p>
                  <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-gold">
                    {formatInterestLabel(loan.interest_type, loan.interest_rate, loan.interest_amount, fmt)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">
                    {loan.status === "closed" ? "Repaid" : "Outstanding"}
                  </p>
                  <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-ink">
                    ₱{fmt(loan.status === "closed" ? loan.repaid : loan.outstanding)}
                  </p>
                </div>
              </div>

              {!(loan.status === "closed" && fullyRepaid) && (
                <div className="h-1.5 rounded-full bg-hairline overflow-hidden mt-2.5">
                  <div
                    className={`h-full ${loan.status === "closed" ? "bg-rust" : "bg-gold"}`}
                    style={{ width: `${repaidPct}%` }}
                  />
                </div>
              )}

              <p className="text-[11px] text-ink-soft mt-1.5 font-mono [font-variant-numeric:tabular-nums]">
                ₱{fmt(loan.repaid)} of ₱{fmt(loan.totalRepayable)} repaid
              </p>

              {(() => {
                const next = nextPayment(loan)
                const pending = loan.pendingRepaid ?? 0
                return (
                  <>
                    {pending > 0 && (
                      <p className="text-[12px] text-gold mt-1">₱{fmt(pending)} waiting for approval</p>
                    )}
                    {next?.kind === "covered" && (
                      <p className="mt-3 rounded-md bg-paper px-3.5 py-2.5 text-sm text-ink">
                        Fully paid once your pending payment is approved.
                      </p>
                    )}
                    {next?.kind === "due" && (
                      <div className="mt-3 rounded-md bg-paper px-3.5 py-2.5 flex items-baseline justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block text-[10px] uppercase tracking-wide text-ink-soft font-mono">Next payment</span>
                          {/* No due day on the loan (older monthly loans) means
                              no date to show -- just the amount, unless it's
                              overdue. */}
                          {(next.overdue || next.dueLabel) && (
                            <span className={`block text-[12px] ${next.overdue ? "text-rust font-semibold" : "text-ink-soft"}`}>
                              {next.overdue ?? `Due ${next.dueLabel}`}
                            </span>
                          )}
                        </span>
                        <span className="font-mono [font-variant-numeric:tabular-nums] text-base font-bold text-ink whitespace-nowrap">
                          ₱{fmt(next.amount)}
                        </span>
                      </div>
                    )}
                  </>
                )
              })()}

              {loan.transactions.length > 0 && (
                <div className="mt-4 pt-3 border-t border-hairline">
                  <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono mb-2">
                    Transactions
                  </p>
                  {(() => {
                    // First entry that isn't a repayment -- i.e. where the
                    // origin (Loan Release) group starts, chronologically
                    // last since the list is newest-first. Gets extra
                    // breathing room above so it reads as a different kind
                    // of entry from the repayment activity above it, not
                    // just another row in the same flow.
                    const firstOriginIndex = loan.transactions.findIndex(
                      (t) => t.classification !== "Loan Repayment"
                    )

                    return loan.transactions.map((t, idx) => {
                      // Loan Release (the disbursement) and any other
                      // loan-linked entry can't be resubmitted by the
                      // borrower the way a repayment can -- rejecting a
                      // Loan Release already deletes the loan record, so
                      // there's nothing left to fix here. Also used to mute
                      // its row below -- it's background context (how the
                      // loan started), not the ongoing repayment activity
                      // this list exists to surface.
                      const isRepayment = t.classification === "Loan Repayment"

                      return (
                        // Tapping a row opens its detail sheet (receipt,
                        // status, and Edit / Fix & resend when allowed) --
                        // same idea as a row on the Transactions page.
                        <button
                          key={t.transaction_id}
                          type="button"
                          onClick={() => setOpenTxn(t)}
                          className={`w-full text-left py-3 ${idx !== loan.transactions.length - 1 ? "border-b border-dashed border-hairline" : ""} ${
                            idx === firstOriginIndex && idx > 0 ? "!mt-2" : ""
                          }`}
                        >
                          <span className="flex items-center justify-between gap-3">
                            <span className="min-w-0">
                              <span className={`block text-sm truncate ${isRepayment ? "text-ink" : "text-ink-soft"}`}>
                                {TRANSACTION_TYPE_LABELS[t.classification] ?? t.classification}
                              </span>
                              <span className="block text-[11px] text-ink-soft font-mono">
                                {new Date(t.date).toLocaleDateString(undefined, {
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric"
                                })}
                                {t.status === "pending" && <span className="text-gold"> · pending</span>}
                                {t.status === "rejected" && <span className="text-rust"> · rejected</span>}
                              </span>
                            </span>
                            <span className="flex items-center gap-2 shrink-0">
                              <span
                                className={`font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold ${
                                  isRepayment ? "text-ink" : "text-ink-soft"
                                }`}
                              >
                                ₱{fmt(Math.abs(t.amount))}
                              </span>
                              <span className="text-ink-soft">›</span>
                            </span>
                          </span>
                          {t.status === "rejected" && t.rejection_reason && (
                            <span className="block mt-1 text-[11px] text-rust">{t.rejection_reason}</span>
                          )}
                        </button>
                      )
                    })
                  })()}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {openTxn && (
        <LoanTxnSheet
          t={openTxn}
          editable={editable}
          onClose={() => setOpenTxn(null)}
          onOpenReceipt={(paths, index) => setOpenReceipt({ paths, index })}
          onEdit={() => {
            const t = openTxn
            setOpenTxn(null)
            // Hands the exact row already on screen to EditTransactionSheet,
            // so it renders instantly instead of re-fetching by ID.
            cacheTransactionRow(t)
            router.push(`${pathname}?editTransaction=${t.transaction_id}`, { scroll: false })
          }}
        />
      )}

      {openReceipt && (
        <ReceiptModal paths={openReceipt.paths} startIndex={openReceipt.index} onClose={() => setOpenReceipt(null)} />
      )}
    </>
  )
}

// One loan entry in full. Only a repayment that's still pending or was
// rejected can be changed -- rejecting a Loan Release already deletes the
// loan record, so there's nothing left to fix there. `editable` is off for
// the admin "view as" preview, which is read-only.
function LoanTxnSheet({
  t,
  editable,
  onClose,
  onEdit,
  onOpenReceipt
}: {
  t: LoanTransaction
  editable: boolean
  onClose: () => void
  onEdit: () => void
  onOpenReceipt: (paths: string[], index: number) => void
}) {
  const isRepayment = t.classification === "Loan Repayment"
  const receipts = receiptPaths(t)
  const canEdit = editable && isRepayment && (t.status === "pending" || t.status === "rejected")
  const statusLabel = t.status === "pending" ? "Waiting for approval" : t.status === "rejected" ? "Rejected" : "Approved"

  return (
    <Sheet
      title={TRANSACTION_TYPE_LABELS[t.classification] ?? t.classification}
      onClose={onClose}
      footer={
        canEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="w-full bg-ink text-paper px-6 py-3.5 rounded-full text-base font-bold shadow-lg motion-safe:transition-transform motion-safe:active:scale-[0.97]"
          >
            {t.status === "rejected" ? "Fix & resend" : "Edit"}
          </button>
        ) : undefined
      }
    >
      <p className="text-center font-mono [font-variant-numeric:tabular-nums] text-[34px] font-bold text-ink pt-1 pb-4">
        ₱{fmt(Math.abs(t.amount))}
      </p>

      {t.status === "rejected" && t.rejection_reason && (
        <div className="rounded-md border border-rust/40 bg-paper px-3.5 py-2.5 mb-4">
          <p className="text-[10px] uppercase tracking-[0.1em] text-rust font-mono">Why it was rejected</p>
          <p className="text-sm text-ink mt-0.5">{t.rejection_reason}</p>
        </div>
      )}

      <div className="card px-4">
        <ReviewRow
          label="Date"
          value={new Date(t.date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
        />
        <ReviewRow label="Status" value={statusLabel} />
        {t.description && <ReviewRow label="Notes" value={t.description} />}
      </div>

      {receipts.length > 0 && (
        <div className="mt-4">
          <ReceiptThumbs paths={receipts} onOpen={(i) => onOpenReceipt(receipts, i)} />
        </div>
      )}
    </Sheet>
  )
}
