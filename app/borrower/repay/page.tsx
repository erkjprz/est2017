"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import BorrowerHeader from "@/app/components/BorrowerHeader"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"
import SubmitConfirmation from "@/app/components/SubmitConfirmation"
import {
  AmountHero,
  BankIcon,
  FieldRow,
  NoteIcon,
  ReceiptsField,
  rowInputClass,
  rowSelectClass
} from "@/app/components/TransactionFormUI"
import { loanRemaining, startingAmount } from "@/lib/loanPayment"
import { removeReceipts, uploadReceipts } from "@/lib/receiptUrl"

function LoanIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-5 h-5 text-ink-soft shrink-0">
      <rect x="3" y="7" width="18" height="12" rx="2" />
      <path d="M8 7V5.5A1.5 1.5 0 019.5 4h5A1.5 1.5 0 0116 5.5V7" />
    </svg>
  )
}

const FILL_MESSAGE = "Fill in the highlighted fields."

function isValidPositiveNumber(value: string): boolean {
  if (!value.trim()) return false
  const n = Number(value)
  return !Number.isNaN(n) && n > 0
}

export default function BorrowerRepayPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()
  const [dataLoading, setDataLoading] = useState(true)
  const checkingAccess = authLoading || dataLoading

  const [banks, setBanks] = useState<any[]>([])
  const [myLoans, setMyLoans] = useState<any[]>([])
  const [loanRepaidTotals, setLoanRepaidTotals] = useState<Record<string, number>>({})
  const [selectedLoanId, setSelectedLoanId] = useState("")
  const [bankId, setBankId] = useState("")
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  // Saved default amount/bank (Preferences, or "Remember for next time").
  const [savedAmount, setSavedAmount] = useState<number | null>(null)
  // Once the borrower types an amount, picking a loan no longer resets it.
  const [amountEdited, setAmountEdited] = useState(false)
  const [saveAsDefault, setSaveAsDefault] = useState(false)
  const [defaultSaveWarning, setDefaultSaveWarning] = useState("")
  const [receipts, setReceipts] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState("")
  // Set when Submit is tapped with something missing -- see `missing`.
  const [showErrors, setShowErrors] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [loadError, setLoadError] = useState("")

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

    async function load() {
      const [{ data: bankList }, { data: borrowerRow }, { data: prefs }] = await Promise.all([
        supabase.from("bank_accounts").select("id, bank_name, account_name").order("bank_name"),
        supabase.from("borrowers").select("borrower_id").eq("member_id", member!.member_id).maybeSingle(),
        supabase
          .from("members")
          .select("default_loan_payment_amount, default_loan_payment_bank_id")
          .eq("member_id", member!.member_id)
          .single()
      ])

      setBanks(bankList ?? [])

      const saved = prefs?.default_loan_payment_amount != null ? Number(prefs.default_loan_payment_amount) : null
      if (saved != null) setAmount(String(saved))
      setSavedAmount(saved)
      if (prefs?.default_loan_payment_bank_id) setBankId(prefs.default_loan_payment_bank_id)

      const filter = borrowerRow?.borrower_id
        ? `member_id.eq.${member!.member_id},borrower_id.eq.${borrowerRow.borrower_id}`
        : `member_id.eq.${member!.member_id}`

      const { data: loans, error: loansError } = await supabase
        .from("loans")
        .select("loan_id, name, principal, interest_type, interest_rate, interest_amount, status, start_date, term_months, repayment_frequency")
        .or(filter)
        .eq("status", "active")
        .order("start_date", { ascending: false })

      if (loansError) {
        setLoadError(loansError.message)
        setDataLoading(false)
        return
      }

      setMyLoans(loans ?? [])

      const loanIds = (loans ?? []).map((l) => l.loan_id)
      if (loanIds.length > 0) {
        const { data: repayments, error: repaymentsError } = await supabase
          .from("transactions")
          .select("loan_id, amount")
          .in("loan_id", loanIds)
          .eq("classification", "Loan Repayment")
          .in("status", ["pending", "approved"])

        if (repaymentsError) {
          setLoadError(repaymentsError.message)
          setDataLoading(false)
          return
        }

        const totals: Record<string, number> = {}
        ;(repayments ?? []).forEach((r) => {
          totals[r.loan_id] = (totals[r.loan_id] || 0) + Number(r.amount)
        })
        setLoanRepaidTotals(totals)

        // Only one loan to pay (the usual case): pick it and start from its
        // saved or usual payment, capped at what's left.
        if (loans!.length === 1) {
          setSelectedLoanId(loans![0].loan_id)
          const start = startingAmount(loans![0], totals[loans![0].loan_id] || 0, saved)
          if (start > 0) setAmount(String(start))
        }
      }

      setDataLoading(false)
    }

    load()
  }, [authLoading, member, router])

  // Nothing is marked up front; once Submit is tapped with gaps, every
  // missing field shows its own message and clears as soon as it's filled.
  const missing = {
    loan: !selectedLoanId,
    amount: !isValidPositiveNumber(amount),
    bank: !bankId,
    receipt: receipts.length === 0
  }
  const anyMissing = Object.values(missing).some(Boolean)
  const err = (key: keyof typeof missing, text: string) => (showErrors && missing[key] ? text : undefined)

  async function handleSubmit() {
    setMessage("")

    if (anyMissing) {
      setShowErrors(true)
      setMessage(FILL_MESSAGE)
      setTimeout(() => document.querySelector('[role="alert"]')?.scrollIntoView({ behavior: "smooth", block: "center" }), 0)
      return
    }

    if (!selectedLoanId) {
      setMessage("Select which loan you're paying.")
      return
    }

    if (!isValidPositiveNumber(amount)) {
      setMessage("Enter a valid amount greater than zero.")
      return
    }

    if (!bankId) {
      setMessage("Select a bank.")
      return
    }

    if (receipts.length === 0) {
      setMessage("Attach a receipt.")
      return
    }

    setSubmitting(true)

    const { paths: receiptPaths, error: uploadError } = await uploadReceipts(receipts, member!.member_id)

    if (uploadError) {
      setMessage(uploadError)
      setSubmitting(false)
      return
    }

    const { error } = await supabase.from("transactions").insert({
      member_id: member!.member_id,
      bank_account_id: bankId,
      loan_id: selectedLoanId,
      classification: "Loan Repayment",
      amount: Number(amount),
      description,
      receipt_urls: receiptPaths,
      status: "pending"
    })

    if (error) {
      setSubmitting(false)
      // The receipts already uploaded successfully above -- if the insert
      // they belong to failed, clean them up rather than leaving them
      // orphaned in the bucket.
      await removeReceipts(receiptPaths)
      setMessage(error.message)
      return
    }

    // Same saved defaults Preferences edits -- only after the payment
    // itself went through, and never blocking it.
    if (saveAsDefault) {
      const [{ error: amountError }, { error: bankError }] = await Promise.all([
        supabase.rpc("set_default_loan_payment_amount", { p_amount: Number(amount) }),
        supabase.rpc("set_default_loan_payment_bank", { p_bank_id: bankId || null })
      ])
      if (amountError || bankError) setDefaultSaveWarning("Couldn't save it as your default — try again next time.")
    }

    setSubmitting(false)
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
              label={`Loan payment submitted${defaultSaveWarning ? `. ${defaultSaveWarning}` : ""}`}
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

          <div className="text-xs tracking-[0.18em] uppercase text-gold font-mono mb-2">Your loan</div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-2">Make a payment</h1>
          <p className="text-[13px] text-ink-soft mb-5">
            Record a payment you&apos;ve sent to the fund, with its receipt.
          </p>

          {loadError && <p className="mb-4 text-sm text-rust">Couldn&apos;t load your loans: {loadError}</p>}

          {!loadError && myLoans.length === 0 ? (
            <p className="mt-4 text-sm text-ink-soft text-center py-12 card">
              You don&apos;t have an active loan to pay right now.
            </p>
          ) : (
            !loadError && (
              <>
                <AmountHero
                  value={amount}
                  onChange={(v) => {
                    setAmount(v)
                    setAmountEdited(true)
                  }}
                  label="Amount"
                  error={err("amount", "Enter an amount")}
                />

                <div className="space-y-5 mt-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">Details</p>
                    <div className="card divide-y divide-hairline overflow-hidden">
                      <FieldRow icon={<LoanIcon />} error={err("loan", "Choose which loan")}>
                        <select
                          className={rowSelectClass}
                          value={selectedLoanId}
                          onChange={(e) => {
                            setSelectedLoanId(e.target.value)
                            const loan = myLoans.find((l) => l.loan_id === e.target.value)
                            if (loan && !amountEdited) {
                              const start = startingAmount(loan, loanRepaidTotals[loan.loan_id] || 0, savedAmount)
                              if (start > 0) setAmount(String(start))
                            }
                          }}
                        >
                          <option value="">Which loan?</option>
                          {myLoans.map((loan) => (
                            <option key={loan.loan_id} value={loan.loan_id}>
                              {loan.name || "Loan"} · ₱{fmt(loanRemaining(loan, loanRepaidTotals[loan.loan_id] || 0))} left
                            </option>
                          ))}
                        </select>
                      </FieldRow>
                      <FieldRow icon={<BankIcon />} error={err("bank", "Choose the bank you sent it to")}>
                        <select className={rowSelectClass} value={bankId} onChange={(e) => setBankId(e.target.value)}>
                          <option value="">Which bank did you send it to?</option>
                          {banks.map((bank) => (
                            <option key={bank.id} value={bank.id}>
                              {bank.account_name || bank.bank_name}
                            </option>
                          ))}
                        </select>
                      </FieldRow>
                      <FieldRow icon={<NoteIcon />}>
                        <div className="flex-1 min-w-0">
                          <input
                            className={`${rowInputClass} w-full`}
                            placeholder="Additional notes (optional)"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                          />
                          <p className="mt-0.5 text-[11px] text-ink-soft">Name, month &amp; date are saved automatically.</p>
                        </div>
                      </FieldRow>
                    </div>
                    {selectedLoanId &&
                      (() => {
                        const loan = myLoans.find((l) => l.loan_id === selectedLoanId)
                        if (!loan) return null
                        return (
                          <p className="mt-2 px-1 text-[12px] text-ink-soft">
                            ₱{fmt(loanRemaining(loan, loanRepaidTotals[loan.loan_id] || 0))} left to pay, counting payments
                            still waiting for approval.
                          </p>
                        )
                      })()}
                  </div>

                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">Receipts</p>
                    <ReceiptsField
                      files={receipts}
                      onAddFiles={(added) => setReceipts((prev) => [...prev, ...added])}
                      onRemoveFile={(i) => setReceipts((prev) => prev.filter((_, j) => j !== i))}
                      error={err("receipt", "Attach a receipt")}
                    />
                  </div>

                  {isValidPositiveNumber(amount) && (
                    <label className="card flex items-start gap-3 px-4 py-3.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={saveAsDefault}
                        onChange={(e) => setSaveAsDefault(e.target.checked)}
                        className="peer sr-only"
                      />
                      <span
                        aria-hidden
                        className={`flex items-center justify-center w-6 h-6 shrink-0 rounded-md border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-sage/50 ${
                          saveAsDefault ? "bg-sage border-sage text-white" : "border-ink-soft/60"
                        }`}
                      >
                        {saveAsDefault && (
                          <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
                            <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[15px] font-semibold text-ink">Remember for next time</span>
                        <span className="block text-sm text-ink-soft mt-0.5">
                          Start my next payment at ₱{fmt(Number(amount))}
                          {bankId
                            ? ` to ${(() => {
                                const b = banks.find((x) => x.id === bankId)
                                return b ? b.account_name || b.bank_name : "this bank"
                              })()}`
                            : ""}
                          . You can change this in Preferences.
                        </span>
                      </span>
                    </label>
                  )}

                  {message && !(message === FILL_MESSAGE && !anyMissing) && <p className="text-sm text-rust">{message}</p>}

                  <button
                    className="w-full bg-ink text-paper px-6 py-3.5 rounded-full text-base font-bold shadow-lg motion-safe:transition-transform motion-safe:active:scale-[0.97] disabled:opacity-50 disabled:shadow-none"
                    onClick={handleSubmit}
                    disabled={submitting}
                  >
                    {submitting ? "Submitting…" : "Submit payment"}
                  </button>
                </div>
              </>
            )
          )}
        </div>
      </main>
    </>
  )
}
