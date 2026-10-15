"use client"

// Admin-only bottom sheets for a loan's detail page. Every admin action on
// a loan (edit terms, release, close, reopen) opens from either the ⋯ menu
// next to the loan's title or its "Next step" card, each in its own sheet
// in place of the old inline "Manage loan" box and browser confirm()
// prompts. The writes themselves are unchanged from that box.

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { Sheet } from "@/app/components/Sheet"
import { LoanTermsCard } from "@/app/components/LoanTermsCard"
import { FieldRow, ReceiptsField, BankIcon, NoteIcon, rowInputClass, rowSelectClass } from "@/app/components/TransactionFormUI"
import { closeLoanAndDistributeGain, previewLoanClose, type LoanCloseSharePreview } from "@/lib/closeLoan"
import { approveLoanRelease } from "@/lib/approveLoan"
import { removeReceipts, uploadReceipts } from "@/lib/receiptUrl"
import { dateOnly } from "@/lib/currentValue"
import type { InterestType } from "@/lib/loanMath"
import { fetchBankBalances, groupImpacts, txnImpact } from "@/lib/bankImpact"
import { BankImpactPreview } from "@/app/components/BankImpact"

export type AdminLoan = {
  loan_id: string
  member_id: string | null
  status: "requested" | "active" | "closed"
  principal: number
  interest_type: InterestType
  interest_rate: number
  interest_amount: number
  term_months: number | null
  repayment_frequency: string
  due_day: number | null
  notes: string | null
  disbursed: number
  repaid: number
  repaidApproved: number
  totalRepayable: number
  remaining: number
  remainingApproved: number
  pendingRepayment: number
}

export type BankOption = { id: string; bank_name: string; account_name: string | null }

const fmt = (n: number) =>
  Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const primaryButtonClass = "w-full bg-ink text-paper px-4 py-3 rounded-sm text-sm font-medium disabled:opacity-50"
const dangerButtonClass = "w-full bg-rust text-paper px-4 py-3 rounded-sm text-sm font-medium disabled:opacity-50"
const sectionLabelClass = "text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-2 px-1"

function Callout({ tone = "neutral", children }: { tone?: "neutral" | "warn"; children: React.ReactNode }) {
  return (
    <p
      className={`text-[12px] rounded-md px-4 py-3 border ${
        tone === "warn" ? "text-rust border-rust/30 bg-rust/5" : "text-ink-soft border-hairline bg-paper"
      }`}
    >
      {children}
    </p>
  )
}

/* ------------------------------ Edit terms ------------------------------ */

export function EditLoanTermsSheet({
  adminLoan,
  onClose,
  onSaved
}: {
  adminLoan: AdminLoan
  onClose: () => void
  onSaved: () => void
}) {
  const [principal, setPrincipal] = useState(String(adminLoan.principal))
  const [interestType, setInterestType] = useState<InterestType>(adminLoan.interest_type)
  const [interestRate, setInterestRate] = useState(String(adminLoan.interest_rate))
  const [interestAmount, setInterestAmount] = useState(String(adminLoan.interest_amount))
  const [termMonths, setTermMonths] = useState(String(adminLoan.term_months ?? ""))
  const [repaymentFrequency, setRepaymentFrequency] = useState(adminLoan.repayment_frequency)
  const [dueDay, setDueDay] = useState(adminLoan.due_day != null ? String(adminLoan.due_day) : "")
  const [notes, setNotes] = useState(adminLoan.notes ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const isRequested = adminLoan.status === "requested"

  async function save() {
    setSaving(true)
    setError("")

    try {
      const updates: Record<string, unknown> = {
        interest_type: interestType,
        interest_rate: interestType === "rate" ? Number(interestRate) : 0,
        interest_amount: interestType === "amount" ? Number(interestAmount) : null,
        term_months: Number(termMonths),
        repayment_frequency: repaymentFrequency,
        due_day: repaymentFrequency === "monthly" && dueDay ? Number(dueDay) : null,
        notes
      }

      if (isRequested) {
        updates.principal = Number(principal)
      }

      const { error: loanError } = await supabase.from("loans").update(updates).eq("loan_id", adminLoan.loan_id)
      if (loanError) throw loanError

      if (isRequested) {
        // Loan releases are stored negative in the ledger.
        const { error: txnError } = await supabase
          .from("transactions")
          .update({ amount: -Number(principal) })
          .eq("loan_id", adminLoan.loan_id)
          .eq("classification", "Loan Release")
          .eq("status", "pending")
        if (txnError) throw txnError
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
      setSaving(false)
      return
    }

    setSaving(false)
    onSaved()
    onClose()
  }

  return (
    <Sheet
      title="Edit Loan Terms"
      onClose={onClose}
      footer={
        <div>
          {error && <p className="text-sm text-rust mb-2">{error}</p>}
          <button className={primaryButtonClass} onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Unlike a still-"requested" loan, an active one already has real
            repayments tracked against its current terms -- changing interest
            or term here changes what "outstanding"/"fully repaid" means
            going forward. Said up front, before Save, instead of a
            confirm() popup after it. */}
        {adminLoan.status === "active" && (
          <Callout tone="warn">
            This loan is already active. Changing its interest or term changes what counts as outstanding or
            fully repaid from now on, including what the borrower sees they still owe.
          </Callout>
        )}

        {isRequested && (
          <div>
            <p className={sectionLabelClass}>Principal</p>
            <div className="card overflow-hidden">
              <FieldRow icon={<span className="w-[18px] text-center text-ink-soft text-sm shrink-0">₱</span>}>
                <input
                  className={`${rowInputClass} font-mono`}
                  type="number"
                  inputMode="decimal"
                  value={principal}
                  onChange={(e) => setPrincipal(e.target.value)}
                />
              </FieldRow>
            </div>
          </div>
        )}

        <LoanTermsCard
          amount={isRequested ? principal : String(adminLoan.principal)}
          interestType={interestType}
          setInterestType={setInterestType}
          interestRate={interestRate}
          setInterestRate={setInterestRate}
          interestAmount={interestAmount}
          setInterestAmount={setInterestAmount}
          termMonths={termMonths}
          setTermMonths={setTermMonths}
          repaymentFrequency={repaymentFrequency}
          setRepaymentFrequency={setRepaymentFrequency}
          dueDay={dueDay}
          setDueDay={setDueDay}
        />

        <div>
          <p className={sectionLabelClass}>Notes</p>
          <div className="card overflow-hidden">
            <FieldRow icon={<NoteIcon />}>
              <input
                className={rowInputClass}
                placeholder="Optional"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </FieldRow>
          </div>
        </div>
      </div>
    </Sheet>
  )
}

/* -------------------------------- Release ------------------------------- */

export function ReleaseLoanSheet({
  adminLoan,
  banks,
  onClose,
  onReleased
}: {
  adminLoan: AdminLoan
  banks: BankOption[]
  onClose: () => void
  onReleased: () => void
}) {
  const [bankChoice, setBankChoice] = useState("")
  const [receipts, setReceipts] = useState<File[]>([])
  const [approving, setApproving] = useState(false)
  const [error, setError] = useState("")
  // Approve stays tappable; tapping it with the bank or proof missing
  // highlights what's still needed instead.
  const [showErrors, setShowErrors] = useState(false)
  const [balances, setBalances] = useState<Record<string, number> | null>(null)

  useEffect(() => {
    fetchBankBalances()
      .then(setBalances)
      .catch(() => setBalances(null))
  }, [])

  const chosenBank = banks.find((b) => b.id === bankChoice)

  async function approve() {
    if (!bankChoice || receipts.length === 0) {
      setShowErrors(true)
      return
    }
    setApproving(true)
    setError("")

    // Loan disbursement moves real money out -- requires proof of the
    // actual outgoing transfer before the loan can be activated.
    const { paths: receiptPaths, error: uploadError } = await uploadReceipts(receipts, adminLoan.member_id || "admin")
    if (uploadError) {
      setError(uploadError)
      setApproving(false)
      return
    }

    try {

      // Verifies a pending Loan Release exists, activates the loan, and
      // freezes each eligible member's pool share for its hold -- one
      // atomic RPC, same one the Txns review card uses.
      await approveLoanRelease({
        loanId: adminLoan.loan_id,
        bankAccountId: bankChoice,
        receiptUrls: receiptPaths,
        releaseDate: dateOnly(new Date())
      })
    } catch (err) {
      // The files uploaded fine but approveLoanRelease failed, so they're
      // now orphaned -- clean them up.
      await removeReceipts(receiptPaths)
      setError(err instanceof Error ? err.message : "Something went wrong.")
      setApproving(false)
      return
    }

    setApproving(false)
    onReleased()
    onClose()
  }

  return (
    <Sheet
      title="Release Loan"
      onClose={onClose}
      footer={
        <div>
          {error && <p className="text-sm text-rust mb-2">{error}</p>}
          {chosenBank && (
            <BankImpactPreview
              {...groupImpacts([
                txnImpact({ transaction_id: adminLoan.loan_id, amount: -adminLoan.principal, affects_cash: 1 }, chosenBank)
              ])}
              balances={balances}
              className="mb-3"
            />
          )}
          <button className={primaryButtonClass} onClick={approve} disabled={approving}>
            {approving ? "Releasing..." : `Approve & Release ₱${fmt(adminLoan.principal)}`}
          </button>
          <p className="text-[11px] text-ink-soft text-center mt-2">
            The loan starts today — approve once the last transfer has gone out. Activates the loan and
            sets aside each member&apos;s share of it.
          </p>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="card px-5 pt-4 pb-3.5">
          <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">Amount to send</p>
          <p className="font-mono [font-variant-numeric:tabular-nums] text-2xl font-bold text-ink">
            ₱{fmt(adminLoan.principal)}
          </p>
          <p className="text-[12px] text-ink-soft mt-1">₱{fmt(adminLoan.totalRepayable)} to be repaid</p>
        </div>

        <div>
          <p className={sectionLabelClass}>Disburse from</p>
          <div className="card overflow-hidden">
            <FieldRow icon={<BankIcon />} error={showErrors && !bankChoice ? "Choose the bank you're sending from" : undefined}>
              <select className={rowSelectClass} value={bankChoice} onChange={(e) => setBankChoice(e.target.value)}>
                <option value="">Select a bank</option>
                {banks.map((bank) => (
                  <option key={bank.id} value={bank.id}>
                    {bank.account_name || bank.bank_name}
                  </option>
                ))}
              </select>
            </FieldRow>
          </div>
        </div>

        <div>
          <p className={sectionLabelClass}>Proof of transfer</p>
          <ReceiptsField
            files={receipts}
            onAddFiles={(added) => setReceipts((prev) => [...prev, ...added])}
            onRemoveFile={(i) => setReceipts((prev) => prev.filter((_, j) => j !== i))}
            accept="image/*,.pdf"
            emptyLabel="Tap to upload a photo or PDF"
            addLabel="Add another file"
            error={showErrors && receipts.length === 0 ? "Attach proof of the transfer" : undefined}
          />
        </div>
      </div>
    </Sheet>
  )
}

/* --------------------------------- Close -------------------------------- */

// Review step for both closing paths -- "fully repaid" and "close early".
// Shows the resulting gain/loss and how it would split per member (a
// read-only preview using the same formula) before the irreversible write.
// The commit is the same closeLoanAndDistributeGain call as before.
export function CloseLoanSheet({
  adminLoan,
  borrowerName,
  early,
  onClose,
  onClosed
}: {
  adminLoan: AdminLoan
  borrowerName?: string
  early: boolean
  onClose: () => void
  onClosed: () => void
}) {
  const [preview, setPreview] = useState<{ gainOrLoss: number; shares: LoanCloseSharePreview[] } | null>(null)
  const [previewError, setPreviewError] = useState("")
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    previewLoanClose({ principal: adminLoan.principal, repaidApproved: adminLoan.repaidApproved })
      .then(setPreview)
      .catch((err) => setPreviewError(err instanceof Error ? err.message : "Couldn't load the preview."))
  }, [adminLoan.principal, adminLoan.repaidApproved])

  async function close() {
    setClosing(true)
    setError("")
    try {
      await closeLoanAndDistributeGain({
        id: adminLoan.loan_id,
        principal: adminLoan.principal,
        repaidApproved: adminLoan.repaidApproved,
        borrowerName
      })
      onClosed()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
      setClosing(false)
    }
  }

  const gainOrLoss = adminLoan.repaidApproved - adminLoan.principal
  const isLoss = gainOrLoss < 0
  const noRecipients = preview !== null && preview.shares.length === 0 && gainOrLoss !== 0

  return (
    <Sheet
      title={early ? "Close Loan Early" : "Close Loan"}
      onClose={onClose}
      footer={
        <div>
          {error && <p className="text-sm text-rust mb-2">{error}</p>}
          <button
            className={early ? dangerButtonClass : primaryButtonClass}
            onClick={close}
            disabled={closing || preview === null || noRecipients || !!previewError}
          >
            {closing
              ? "Closing..."
              : gainOrLoss === 0
              ? "Close Loan"
              : isLoss
              ? `Close & Record ₱${fmt(Math.abs(gainOrLoss))} Loss`
              : `Close & Distribute ₱${fmt(gainOrLoss)} Gain`}
          </button>
          <p className="text-[11px] text-ink-soft text-center mt-2">
            You can reopen it later from the ⋯ menu on this loan.
          </p>
        </div>
      }
    >
      {early && (
        <div className="mb-4">
          <Callout tone="warn">
            This loan isn&apos;t fully repaid yet. Closing it now settles it with only what&apos;s been repaid and
            approved so far
            {isLoss ? `, so the ₱${fmt(Math.abs(gainOrLoss))} shortfall is recorded as a loss across members.` : "."}
          </Callout>
        </div>
      )}

      <div className="card p-5">
        <div className="space-y-2">
          <SummaryRow label="Principal" value={`₱${fmt(adminLoan.principal)}`} />
          <SummaryRow label="Repaid (approved)" value={`₱${fmt(adminLoan.repaidApproved)}`} />
          {early && <SummaryRow label="Still owed" value={`₱${fmt(adminLoan.remainingApproved)}`} />}
          <div className="pt-2 border-t border-hairline">
            <SummaryRow
              label={isLoss ? "Loss" : "Gain"}
              value={`${isLoss ? "-" : "+"}₱${fmt(Math.abs(gainOrLoss))}`}
              valueClass={isLoss ? "text-rust" : gainOrLoss > 0 ? "text-sage" : "text-ink"}
              bold
            />
          </div>
        </div>
      </div>

      {gainOrLoss !== 0 && (
        <>
          <h3 className="text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mt-5 mb-2">
            Each member&apos;s share
          </h3>

          {previewError && <p className="text-sm text-rust">{previewError}</p>}
          {!previewError && preview === null && (
            <p className="text-sm text-ink-soft py-6 text-center">Calculating shares…</p>
          )}
          {noRecipients && (
            <p className="text-sm text-rust">
              No member has a positive value in the fund today, so there&apos;s no one to split this across.
            </p>
          )}

          {preview && preview.shares.length > 0 && (
            <div className="card">
              <div className="px-5">
                {preview.shares.map((s, i) => (
                  <div
                    key={s.member_id}
                    className={`py-2.5 flex justify-between items-center gap-3 ${
                      i !== preview.shares.length - 1 ? "border-b border-dashed border-hairline" : ""
                    }`}
                  >
                    <p className="text-sm text-ink truncate min-w-0">{s.name}</p>
                    <div className="flex flex-col items-end shrink-0">
                      <p
                        className={`font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold ${
                          s.amount < 0 ? "text-rust" : "text-sage"
                        }`}
                      >
                        {s.amount < 0 ? "-" : "+"}₱{fmt(Math.abs(s.amount))}
                      </p>
                      <p className="text-[11px] text-ink-soft font-mono">{s.pctShare.toFixed(2)}%</p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="px-5 py-2.5 border-t border-hairline text-[11px] text-ink-soft">
                Split by each member&apos;s current value in the fund as of today.
              </p>
            </div>
          )}
        </>
      )}
    </Sheet>
  )
}

function SummaryRow({
  label,
  value,
  valueClass = "text-ink",
  bold = false
}: {
  label: string
  value: string
  valueClass?: string
  bold?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={`text-[13px] ${bold ? "text-ink font-semibold" : "text-ink-soft"}`}>{label}</span>
      <span
        className={`font-mono [font-variant-numeric:tabular-nums] text-[13px] whitespace-nowrap ${
          bold ? "font-bold" : "font-semibold"
        } ${valueClass}`}
      >
        {value}
      </span>
    </div>
  )
}

/* -------------------------------- Reopen -------------------------------- */

export function ReopenLoanSheet({
  adminLoan,
  onClose,
  onReopened
}: {
  adminLoan: AdminLoan
  onClose: () => void
  onReopened: () => void
}) {
  const [reopening, setReopening] = useState(false)
  const [error, setError] = useState("")

  async function reopen() {
    setReopening(true)
    setError("")

    // Deleting loan_gain_allocations/its paired Gain Allocation
    // transactions and flipping the loan back to active happen in one
    // atomic RPC.
    const { data: orphanedReceipts, error: rpcError } = await supabase.rpc("reopen_loan", {
      p_loan_id: adminLoan.loan_id
    })

    if (rpcError) {
      setError(rpcError.message)
      setReopening(false)
      return
    }

    // Gain Allocation rows are system-generated and never carry a receipt
    // today, but clean up defensively in case that ever changes -- the DB
    // state already committed by this point, so a failure here shouldn't
    // block the reopen, just leave an orphaned file to clean up later.
    if (orphanedReceipts && orphanedReceipts.length > 0) {
      await supabase.storage.from("Receipts").remove(orphanedReceipts)
    }

    setReopening(false)
    onReopened()
    onClose()
  }

  return (
    <Sheet
      title="Reopen Loan"
      onClose={onClose}
      footer={
        <div>
          {error && <p className="text-sm text-rust mb-2">{error}</p>}
          <button className={primaryButtonClass} onClick={reopen} disabled={reopening}>
            {reopening ? "Reopening..." : "Reopen Loan"}
          </button>
        </div>
      }
    >
      <Callout>
        Reopening sets this loan back to active and removes the gain or loss shares recorded for members when it
        was closed. You can close it again once it&apos;s settled.
      </Callout>
    </Sheet>
  )
}
