"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import BorrowerHeader from "@/app/components/BorrowerHeader"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"
import SubmitConfirmation from "@/app/components/SubmitConfirmation"
import { LoanTermsCard } from "@/app/components/LoanTermsCard"
import {
  AmountHero,
  FieldError,
  FieldGroup,
  FieldRow,
  NoteIcon,
  ReceiptField,
  ReviewRow,
  StepTrack,
  rowInputClass
} from "@/app/components/TransactionFormUI"
import { totalRepayable, type InterestType } from "@/lib/loanMath"
import { ordinalDay } from "@/lib/loanFormat"

const MISSING_DUE_DAY_MESSAGE = "Pick the day of the month your payment is due."
const MISSING_PAYOUT_MESSAGE = "Add your bank or e-wallet details, or a QR code, so we know where to send the money."

const FILL_MESSAGE = "Fill in the highlighted fields."

function isValidPositiveNumber(value: string, allowZero = false): boolean {
  if (!value.trim()) return false
  const n = Number(value)
  if (Number.isNaN(n)) return false
  return allowZero ? n >= 0 : n > 0
}

export default function BorrowerRequestLoanPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()
  const [dataLoading, setDataLoading] = useState(true)
  const checkingAccess = authLoading || dataLoading

  const [amount, setAmount] = useState("")
  const [interestType, setInterestType] = useState<InterestType>("rate")
  const [interestRate, setInterestRate] = useState("")
  const [interestAmount, setInterestAmount] = useState("")
  const [termMonths, setTermMonths] = useState("")
  const [repaymentFrequency, setRepaymentFrequency] = useState("monthly")
  const [dueDay, setDueDay] = useState("")
  const [description, setDescription] = useState("")
  // Where the admin should send the money: typed bank/e-wallet details,
  // a photo of the borrower's payment QR code, or both.
  const [payoutDetails, setPayoutDetails] = useState("")
  const [payoutQr, setPayoutQr] = useState<File | null>(null)
  const [payoutQrPreview, setPayoutQrPreview] = useState<string | null>(null)
  const [qrDragActive, setQrDragActive] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState("")
  // Set when Continue is tapped with something missing -- see `missing`.
  const [showErrors, setShowErrors] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  // Same Details -> Review sub-flow a member's Loan Request uses in
  // NewTransactionSheet.
  const [formStep, setFormStep] = useState<1 | 2>(1)

  useEffect(() => {
    if (authLoading) return

    if (!member) {
      router.push("/login")
      return
    }

    if (member.role !== "borrower") {
      router.push("/dashboard")
      return
    }

    if (member.status !== "approved") {
      router.push("/waiting")
      return
    }

    setDataLoading(false)
  }, [authLoading, member, router])

  const previewTotalRepayable =
    isValidPositiveNumber(amount) &&
    (interestType === "rate"
      ? isValidPositiveNumber(interestRate, true)
      : isValidPositiveNumber(interestAmount, true))
      ? totalRepayable(Number(amount), interestType, Number(interestRate || 0), Number(interestAmount || 0))
      : 0

  // Once they've added payout info, the "where do we send it" error no
  // longer applies -- clear it right away instead of on the next Continue.
  function clearMissingPayoutMessage() {
    if (message === MISSING_PAYOUT_MESSAGE) setMessage("")
  }

  function setPayoutQrFile(file: File | null) {
    setPayoutQr(file)
    setPayoutQrPreview(file ? URL.createObjectURL(file) : null)
    if (file) clearMissingPayoutMessage()
  }

  function detailsError(): string {
    if (!isValidPositiveNumber(amount)) return "Enter a valid amount greater than zero."
    if (interestType === "rate" && !isValidPositiveNumber(interestRate, true)) {
      return "Enter a valid interest rate (0 or higher)."
    }
    if (interestType === "amount" && !isValidPositiveNumber(interestAmount, true)) {
      return "Enter a valid interest amount (0 or higher)."
    }
    if (!isValidPositiveNumber(termMonths)) return "Enter a valid term, in months greater than zero."
    if (repaymentFrequency === "monthly" && !dueDay) return MISSING_DUE_DAY_MESSAGE
    if (!payoutDetails.trim() && !payoutQr) return MISSING_PAYOUT_MESSAGE
    return ""
  }

  // Nothing is marked up front; once Continue is tapped with gaps, every
  // missing field shows its own message and clears as soon as it's filled.
  const missing = {
    amount: !isValidPositiveNumber(amount),
    terms:
      !(interestType === "rate" ? interestRate : interestAmount) ||
      !termMonths ||
      (repaymentFrequency === "monthly" && !dueDay),
    payout: !payoutDetails.trim() && !payoutQr
  }
  const anyMissing = Object.values(missing).some(Boolean)

  function handleContinueToReview() {
    if (anyMissing) {
      setShowErrors(true)
      setMessage(FILL_MESSAGE)
      setTimeout(() => document.querySelector('[role="alert"]')?.scrollIntoView({ behavior: "smooth", block: "center" }), 0)
      return
    }
    const error = detailsError()
    if (error) {
      setMessage(error)
      return
    }
    setMessage("")
    setFormStep(2)
  }

  async function handleSubmit() {
    setMessage("")

    const detailsMessage = detailsError()
    if (detailsMessage) {
      setMessage(detailsMessage)
      return
    }

    setSubmitting(true)

    // Named "<member_id>-..." like repayment receipts, so the Receipts
    // bucket's storage policy still lets the borrower view their own file.
    let qrPath: string | null = null
    if (payoutQr) {
      qrPath = `${member!.member_id}-payout-${Date.now()}-${payoutQr.name}`
      const { error: uploadError } = await supabase.storage
        .from("Receipts")
        .upload(qrPath, payoutQr, { contentType: payoutQr.type })

      if (uploadError) {
        setSubmitting(false)
        setMessage(uploadError.message)
        return
      }
    }

    // Both the loans row and its paired "Loan Release" transaction are
    // written in one atomic RPC call -- previously these were two separate
    // client-side inserts, and a failure on the second one (dropped
    // connection, closed tab mid-submit) left an orphaned loan stuck at
    // "requested" with nothing in the approval queue to ever approve it
    // against, and no error shown. See submit_loan_request in Supabase.
    const { error } = await supabase.rpc("submit_loan_request", {
      p_member_id: member!.member_id,
      p_principal: Number(amount),
      p_interest_type: interestType,
      p_interest_rate: interestType === "rate" ? Number(interestRate) : 0,
      p_interest_amount: interestType === "amount" ? Number(interestAmount) : null,
      p_term_months: Number(termMonths),
      p_repayment_frequency: repaymentFrequency,
      p_start_date: new Date().toISOString().slice(0, 10),
      p_notes: description,
      p_description: description,
      p_payout_details: payoutDetails,
      p_payout_qr_path: qrPath,
      p_due_day: repaymentFrequency === "monthly" ? Number(dueDay) : null
    })

    setSubmitting(false)

    if (error) {
      // The QR already uploaded -- don't leave it orphaned in storage.
      if (qrPath) await supabase.storage.from("Receipts").remove([qrPath])
      setMessage(error.message)
      return
    }

    setSubmitted(true)
  }

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (checkingAccess) {
    return (
      <>
        <BorrowerHeader />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-lg mx-auto px-4 sm:px-5 pt-8 pb-24">
            <SkeletonPanel />
          </div>
        </main>
      </>
    )
  }

  if (submitted) {
    return (
      <>
        <BorrowerHeader />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-lg mx-auto px-4 sm:px-5 pt-8 pb-24">
            <SubmitConfirmation
              amount={Number(amount)}
              label="Loan request submitted"
              pending
              continueLabel="View Your Loan →"
              onContinue={() => router.push("/borrower")}
            />
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <BorrowerHeader />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-lg mx-auto px-4 sm:px-5 pt-8 pb-24">
          <button
            onClick={() => router.push("/borrower")}
            className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors"
          >
            ← Your loan
          </button>

          <div className="text-xs tracking-[0.18em] uppercase text-gold font-mono mb-2">Request a Loan</div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-2">How much do you need?</h1>

          <AmountHero value={amount} onChange={setAmount} error={showErrors && missing.amount ? "Enter an amount" : undefined} />

          <div className="space-y-4 mt-4">
            <StepTrack step={formStep} labels={["Details", "Review"]} />

            {formStep === 1 && (
              <>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">Details</p>
                  <div className="card divide-y divide-hairline overflow-hidden">
                    <FieldRow icon={<NoteIcon />}>
                      <div className="flex-1 min-w-0">
                        <input
                          className={`${rowInputClass} w-full`}
                          placeholder="What's it for? (optional)"
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                        />
                        <p className="mt-0.5 text-[11px] text-ink-soft">Name, month &amp; date are saved automatically.</p>
                      </div>
                    </FieldRow>
                  </div>
                </div>

                <LoanTermsCard
                  showErrors={showErrors}
                  amount={amount}
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
                  setDueDay={(v) => {
                    setDueDay(v)
                    if (message === MISSING_DUE_DAY_MESSAGE) setMessage("")
                  }}
                />

                <div>
                  <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">
                    Where should we send it?
                  </p>
                  <div className={`card p-4 space-y-3 ${showErrors && missing.payout ? "!border-rust" : ""}`}>
                    <textarea
                      rows={2}
                      className="block w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-soft resize-none"
                      placeholder={"Bank or e-wallet, account name & number\ne.g. GCash · Juan Dela Cruz · 0917 123 4567"}
                      value={payoutDetails}
                      onChange={(e) => {
                        setPayoutDetails(e.target.value)
                        if (e.target.value.trim()) clearMissingPayoutMessage()
                      }}
                    />
                    <ReceiptField
                      receipt={payoutQr}
                      receiptPreview={payoutQrPreview}
                      dragActive={qrDragActive}
                      setDragActive={setQrDragActive}
                      onFileChange={setPayoutQrFile}
                      emptyLabel="Or upload QR code"
                    />
                  </div>
                  {showErrors && missing.payout && (
                    <FieldError message="Add your bank or e-wallet details, or a QR code" className="px-1 mt-1.5" />
                  )}
                </div>
              </>
            )}

            {formStep === 2 && (
              <FieldGroup>
                <ReviewRow label="Amount to borrow" value={`₱${fmt(isValidPositiveNumber(amount) ? Number(amount) : 0)}`} />
                <ReviewRow
                  label="Interest"
                  value={interestType === "rate" ? `${interestRate || 0}%` : `₱${fmt(Number(interestAmount) || 0)} fixed`}
                />
                <ReviewRow label="Term" value={`${termMonths || 0} months`} />
                <ReviewRow
                  label="Repayment"
                  value={repaymentFrequency === "monthly" ? "Monthly installments" : "Lump sum at end of term"}
                />
                {repaymentFrequency === "monthly" && dueDay && (
                  <ReviewRow label="Due date" value={`${ordinalDay(Number(dueDay))} of each month`} />
                )}
                {previewTotalRepayable > 0 && <ReviewRow label="Est. total repayable" value={`₱${fmt(previewTotalRepayable)}`} />}
                {description && <ReviewRow label="Description" value={description} />}
                {payoutDetails.trim() && <ReviewRow label="Send to" value={payoutDetails.trim()} />}
                {payoutQr && <ReviewRow label="QR code" value="Attached" />}
              </FieldGroup>
            )}

            {message && !(message === FILL_MESSAGE && !anyMissing) && <p className="text-sm text-rust">{message}</p>}

            <div className="flex items-center gap-3">
              {formStep === 2 && (
                <button
                  type="button"
                  className="shrink-0 border border-hairline text-ink-soft px-5 py-3.5 rounded-full text-base font-semibold"
                  onClick={() => setFormStep(1)}
                >
                  Back
                </button>
              )}
              <button
                type="button"
                className="flex-1 bg-ink text-paper px-6 py-3.5 rounded-full text-base font-bold shadow-lg motion-safe:transition-transform motion-safe:active:scale-[0.97] disabled:opacity-50 disabled:shadow-none"
                onClick={formStep === 1 ? handleContinueToReview : handleSubmit}
                disabled={submitting}
              >
                {submitting ? "Submitting…" : formStep === 1 ? "Continue" : "Submit Request"}
              </button>
            </div>
          </div>
        </div>
      </main>
    </>
  )
}
