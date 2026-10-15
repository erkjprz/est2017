"use client"

import { useEffect, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/app/auth-context"
import { Sheet } from "@/app/components/Sheet"
import { LoanPickerSheet, LoanRowIcon } from "@/app/components/LoanPickerSheet"
import { InvestmentPickerSheet, InvestmentRowIcon } from "@/app/components/InvestmentPickerSheet"
import { TypePickerSheet, TypeBadge } from "@/app/components/TypePickerSheet"
import { LoanTermsCard } from "@/app/components/LoanTermsCard"
import { SkeletonPanel } from "@/app/components/Skeleton"
import {
  AmountHero,
  StepTrack,
  ReviewRow,
  ReceiptField,
  FieldError,
  invalidRowClass,
  FieldGroup,
  DateField,
  BankIcon,
  NoteIcon,
  PersonIcon,
  FieldRow,
  rowSelectClass,
  rowInputClass
} from "@/app/components/TransactionFormUI"
import { totalRepayable, type InterestType } from "@/lib/loanMath"
import { ordinalDay, loanPickLabel } from "@/lib/loanFormat"
import { fetchWithdrawable } from "@/lib/withdrawable"
import { dateOnly } from "@/lib/currentValue"
import { getCachedTransactionFormData, loadTransactionFormData } from "@/lib/transactionFormPrefetch"
import { snapshotInvestmentHold } from "@/lib/snapshotHold"
import { fetchBankBalances, groupImpacts, txnImpact, type TxnImpact } from "@/lib/bankImpact"
import { BankImpactPreview } from "@/app/components/BankImpact"
import { startingAmount, type PayableLoan } from "@/lib/loanPayment"

const MISSING_DUE_DAY_MESSAGE = "Pick the day of the month the payment is due."
const MISSING_PAYOUT_MESSAGE = "Add bank or e-wallet details, or a QR code, so we know where to send the money."
const FILL_MESSAGE = "Fill in the highlighted fields."

// The FAB's quick-entry sheet covers the types every member reaches for
// constantly (Contribution/Withdrawal/Loan Request/Loan Payment), plus
// Investment Return open to every member the same way, plus the
// admin-only fund-level bookkeeping types (Bank Interest/Expense/Bank
// Transfer/Investment) -- all sharing one insert shape (member_id null,
// approved immediately, no on-behalf-of -- these aren't attributed to
// any one member). Investment
// Return is the one type with two different shapes depending on who
// submits it (see the isInvestmentReturn branch in handleSubmit): a
// member's own return is a pending, self-attributed row like a
// Contribution, but an admin's is fund-level like the four adminOnly
// types below it.
const ENTRY_TYPES = [
  { key: "contribution", label: "Contribution", adminOnly: false },
  { key: "withdrawal", label: "Withdrawal", adminOnly: false },
  { key: "loan_request", label: "Loan Request", adminOnly: false },
  { key: "loan_payment", label: "Loan Payment", adminOnly: false },
  { key: "investment_return", label: "Investment Return", adminOnly: false },
  { key: "bank_interest", label: "Bank Interest", adminOnly: true },
  { key: "expense", label: "Expense", adminOnly: true },
  { key: "bank_transfer", label: "Bank Transfer", adminOnly: true },
  { key: "investment", label: "Investment", adminOnly: true }
]

const FLOW: Record<string, { arrow: string; tone: "in" | "out" | "neutral" }> = {
  contribution: { arrow: "↑", tone: "in" },
  withdrawal: { arrow: "↓", tone: "out" },
  loan_request: { arrow: "↓", tone: "out" },
  loan_payment: { arrow: "↑", tone: "in" },
  investment_return: { arrow: "↑", tone: "in" },
  bank_interest: { arrow: "↑", tone: "in" },
  expense: { arrow: "↓", tone: "out" },
  bank_transfer: { arrow: "⇄", tone: "neutral" },
  investment: { arrow: "↓", tone: "out" }
}

function isValidPositiveNumber(value: string, allowZero = false): boolean {
  if (!value.trim()) return false
  const n = Number(value)
  if (Number.isNaN(n)) return false
  return allowZero ? n >= 0 : n > 0
}

function withFlow(options: typeof ENTRY_TYPES) {
  return options.map((o) => ({ ...o, ...(FLOW[o.key] ?? { arrow: "•", tone: "neutral" as const }) }))
}

export function NewTransactionSheet({ onClose, onSaved }: { onClose: () => void; onSaved: (message: string) => void }) {
  const { member } = useAuth()
  const memberId = member?.member_id ?? null
  const isAdmin = member?.role === "admin"

  // Navbar starts warming this the moment a page has a signed-in member
  // (see its own effect) -- by the time someone actually taps the FAB,
  // the fetch below is very often already done. Seeding state from
  // whatever's cached (possibly nothing, on a very fast tap) means
  // dataLoading only starts true when there's genuinely nothing to show
  // yet, instead of unconditionally flashing "Loading..." every time.
  const cached = memberId ? getCachedTransactionFormData(memberId, isAdmin) : null

  const [dataLoading, setDataLoading] = useState(!cached)
  const [loadError, setLoadError] = useState("")
  const [banks, setBanks] = useState<any[]>(cached?.banks ?? [])
  const [allMembers, setAllMembers] = useState<any[]>(cached?.allMembers ?? [])
  const [myLoans, setMyLoans] = useState<any[]>(cached?.myLoans ?? [])
  const [loanRepaidTotals, setLoanRepaidTotals] = useState<Record<string, number>>(cached?.loanRepaidTotals ?? {})
  const [investmentsList, setInvestmentsList] = useState<any[]>(cached?.investmentsList ?? [])

  const [selectedType, setSelectedType] = useState("contribution")
  const [showTypePicker, setShowTypePicker] = useState(false)
  const [onBehalfOfId, setOnBehalfOfId] = useState("")
  const [bankId, setBankId] = useState(cached?.contributionBankDefault ?? "")
  const [toBankId, setToBankId] = useState("")
  const [investmentId, setInvestmentId] = useState("")
  const [amount, setAmount] = useState(cached?.contributionDefault != null ? String(cached.contributionDefault) : "")
  const [txnDate, setTxnDate] = useState(() => dateOnly(new Date()))
  const [description, setDescription] = useState("")
  const [receipt, setReceipt] = useState<File | null>(null)
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  // Loan Request only: where the admin should send the money -- typed
  // bank/e-wallet details, a photo of a payment QR code, or both. Same
  // section as the borrower's request page.
  const [payoutDetails, setPayoutDetails] = useState("")
  const [payoutQr, setPayoutQr] = useState<File | null>(null)
  const [payoutQrPreview, setPayoutQrPreview] = useState<string | null>(null)
  const [qrDragActive, setQrDragActive] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState("")
  // A Withdrawal flags a missing payout by outlining the "Where should we
  // send it?" card itself rather than with a footer message.
  // Set when Submit/Continue is tapped with something missing; every missing
  // field then highlights at once (see `missing` below) and clears itself
  // as it's filled.
  const [showErrors, setShowErrors] = useState(false)
  const payoutFieldRef = useRef<HTMLDivElement>(null)

  const [interestType, setInterestType] = useState<InterestType>("rate")
  const [interestRate, setInterestRate] = useState("")
  const [interestAmount, setInterestAmount] = useState("")
  const [termMonths, setTermMonths] = useState("")
  const [repaymentFrequency, setRepaymentFrequency] = useState("monthly")
  const [dueDay, setDueDay] = useState("")
  const [selectedLoanId, setSelectedLoanId] = useState("")
  const [showLoanPicker, setShowLoanPicker] = useState(false)
  const [showInvestmentPicker, setShowInvestmentPicker] = useState(false)

  const [contributionDefault, setContributionDefault] = useState<number | null>(cached?.contributionDefault ?? null)
  const [contributionBankDefault, setContributionBankDefault] = useState<string | null>(cached?.contributionBankDefault ?? null)
  const [loanPaymentDefault, setLoanPaymentDefault] = useState<number | null>(cached?.loanPaymentDefault ?? null)
  const [loanPaymentBankDefault, setLoanPaymentBankDefault] = useState<string | null>(cached?.loanPaymentBankDefault ?? null)
  const [saveAsDefault, setSaveAsDefault] = useState(false)
  // Once the amount's been typed, picking a loan (or member) no longer
  // replaces it.
  const [amountEdited, setAmountEditedState] = useState(false)
  // Mirrors amountEdited for the async loaders below: their closures hold
  // the value from when the load started, so an amount typed while loans
  // or defaults were still loading used to be overwritten when they landed.
  const amountEditedRef = useRef(false)
  function setAmountEdited(value: boolean) {
    amountEditedRef.current = value
    setAmountEditedState(value)
  }

  // Loan Request is the only type in this reduced set with enough
  // conditional fields to earn its own Details -> Review sub-flow --
  // Contribution/Withdrawal/Loan Payment stay a single flowing view.
  const [formStep, setFormStep] = useState<1 | 2>(1)

  // Each type/member switch bumps this; a load that finishes after a newer
  // one started (an admin flipping "on behalf of" quickly) is dropped, so
  // one member's loan can't end up selected under another member.
  const loadSeqRef = useRef(0)
  const isStale = (seq: number) => seq !== loadSeqRef.current

  async function loadLoansFor(id: string, seq: number) {
    const { data: borrowerRow } = await supabase
      .from("borrowers")
      .select("borrower_id")
      .eq("member_id", id)
      .maybeSingle()

    const loanFilter = borrowerRow?.borrower_id
      ? `member_id.eq.${id},borrower_id.eq.${borrowerRow.borrower_id}`
      : `member_id.eq.${id}`

    const { data } = await supabase
      .from("loans")
      .select("loan_id, principal, interest_type, interest_rate, interest_amount, term_months, repayment_frequency, status, start_date")
      .or(loanFilter)
      .in("status", ["active", "requested"])
      .order("start_date", { ascending: false })

    if (!isStale(seq)) setMyLoans(data ?? [])

    const totals: Record<string, number> = {}
    const loanIds = (data ?? []).map((l) => l.loan_id)
    if (loanIds.length > 0) {
      const { data: repayments } = await supabase
        .from("transactions")
        .select("loan_id, amount")
        .in("loan_id", loanIds)
        .eq("classification", "Loan Repayment")
        .in("status", ["pending", "approved"])

      ;(repayments ?? []).forEach((r) => {
        totals[r.loan_id] = (totals[r.loan_id] || 0) + Number(r.amount)
      })
    }
    if (!isStale(seq)) setLoanRepaidTotals(totals)
    return { loans: data ?? [], totals }
  }

  // Loan Payment's starting point, same as the borrower repay page: with
  // only one active loan, pick it and start from the saved default or one
  // installment, never more than what's left. Otherwise just the saved
  // default until a loan is picked.
  function applyLoanPaymentStart(loans: (PayableLoan & { loan_id: string; status: string })[], totals: Record<string, number>, saved: number | null) {
    const active = loans.filter((l) => l.status === "active")
    if (active.length === 1) {
      setSelectedLoanId(active[0].loan_id)
      if (amountEditedRef.current) return
      const start = startingAmount(active[0], totals[active[0].loan_id] || 0, saved)
      setAmount(start > 0 ? String(start) : "")
    } else if (!amountEditedRef.current) {
      setAmount(saved != null ? String(saved) : "")
    }
  }

  async function loadPreferencesFor(id: string, seq: number) {
    const { data } = await supabase
      .from("members")
      .select(
        "default_contribution_amount, default_contribution_bank_id, default_loan_payment_amount, default_loan_payment_bank_id"
      )
      .eq("member_id", id)
      .maybeSingle()

    const contrib = data?.default_contribution_amount != null ? Number(data.default_contribution_amount) : null
    const contribBank = data?.default_contribution_bank_id ?? null
    const loanPay = data?.default_loan_payment_amount != null ? Number(data.default_loan_payment_amount) : null
    const loanPayBank = data?.default_loan_payment_bank_id ?? null
    if (!isStale(seq)) {
      setContributionDefault(contrib)
      setContributionBankDefault(contribBank)
      setLoanPaymentDefault(loanPay)
      setLoanPaymentBankDefault(loanPayBank)
    }
    return { contrib, contribBank, loanPay, loanPayBank }
  }

  // If `cached` was already there at mount, state above is already fully
  // seeded and dataLoading started false -- nothing to do. Otherwise this
  // is the fallback path: Navbar's own prefetch (see its effect) hasn't
  // finished yet, most likely because the FAB got tapped within the very
  // first instant of a page load, so fetch the same data directly.
  useEffect(() => {
    if (!member || cached) return

    async function load() {
      const { data, error } = await loadTransactionFormData(member!.member_id, member!.role === "admin")
      if (error || !data) {
        setLoadError(error ?? "Couldn't load transaction data.")
        setDataLoading(false)
        return
      }

      setBanks(data.banks)
      setAllMembers(data.allMembers)
      setInvestmentsList(data.investmentsList)
      setMyLoans(data.myLoans)
      setLoanRepaidTotals(data.loanRepaidTotals)
      setContributionDefault(data.contributionDefault)
      setContributionBankDefault(data.contributionBankDefault)
      setLoanPaymentDefault(data.loanPaymentDefault)
      setLoanPaymentBankDefault(data.loanPaymentBankDefault)

      // selectedType starts at "contribution" above, so only that default
      // needs applying here -- loan_payment's own default is applied by
      // handleTypeChange whenever someone actually switches to it.
      if (data.contributionDefault != null && !amountEditedRef.current) setAmount(String(data.contributionDefault))
      if (data.contributionBankDefault) setBankId(data.contributionBankDefault)

      setDataLoading(false)
    }

    load()
    // cached is a plain value captured at mount (whether the sheet opened
    // already warm), not state -- it isn't expected to change through this
    // instance's lifetime, so it's deliberately left out of the deps list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member])

  const effectiveMemberId = isAdmin && onBehalfOfId ? onBehalfOfId : memberId

  // What the member can still withdraw (available balance less withdrawals
  // already waiting) -- shown under the amount and checked before Submit.
  // The database enforces the same limit; this just says it up front.
  const [withdrawable, setWithdrawable] = useState<{ memberId: string; amount: number } | null>(null)
  useEffect(() => {
    if (selectedType !== "withdrawal" || !effectiveMemberId) return
    let cancelled = false
    fetchWithdrawable([effectiveMemberId])
      .then((map) => {
        const w = map[effectiveMemberId]
        if (!cancelled && w) setWithdrawable({ memberId: effectiveMemberId, amount: Math.max(0, w.withdrawableNow - w.pendingOut) })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [selectedType, effectiveMemberId])
  const withdrawableNow = withdrawable && withdrawable.memberId === effectiveMemberId ? withdrawable.amount : null
  const submittedByForOnBehalf = isAdmin && onBehalfOfId ? memberId : null

  const activeLoans = myLoans.filter((l) => l.status === "active")
  const selectedLoan = activeLoans.find((l) => l.loan_id === selectedLoanId) ?? null
  const selectedInvestment = investmentsList.find((inv) => inv.investment_id === investmentId) ?? null

  const isLoanRequest = selectedType === "loan_request"
  const isLoanPayment = selectedType === "loan_payment"
  const isContribution = selectedType === "contribution"
  const isInvestmentReturn = selectedType === "investment_return"
  const isBankInterest = selectedType === "bank_interest"
  const isExpense = selectedType === "expense"
  const isBankTransfer = selectedType === "bank_transfer"
  const isInvestment = selectedType === "investment"
  // Both Investment and Investment Return need the same investment picker
  // and the same affects_cash mirroring of the selected investment -- see
  // the two admin-fund-level branches in handleSubmit.
  const isInvestmentEntry = isInvestment || isInvestmentReturn
  // The four adminOnly types are fund-level entries, not attributed to
  // any one member -- no on-behalf-of concept, same as Investment Return
  // when an admin submits it (see the isInvestmentReturn branch in
  // handleSubmit). Only the original four member-facing types support
  // picking who a submission is "for".
  const isAdminFundEntry = isBankInterest || isExpense || isBankTransfer || isInvestment
  const supportsOnBehalfOf = isContribution || selectedType === "withdrawal" || isLoanRequest || isLoanPayment
  const isWithdrawal = selectedType === "withdrawal"
  // Both get paid out by an admin after approval, so both ask where the
  // money should go.
  const needsPayout = isLoanRequest || isWithdrawal
  const isStepped = isLoanRequest
  const needsReceipt = selectedType !== "withdrawal" && selectedType !== "loan_request"
  const needsBank = isContribution || isLoanPayment || isInvestmentEntry || isBankInterest || isExpense || isBankTransfer
  // Contribution and Loan Payment collect bank + receipt right here, so an
  // on-behalf-of submission has everything a normal approved entry needs
  // and can safely skip the queue instead of landing pending.
  const willAutoApproveOnBehalf = isAdmin && !!onBehalfOfId && (isContribution || isLoanPayment)

  // Every required field that's still empty for this type. Nothing is marked
  // up front (only "(optional)" fields say anything); once Submit/Continue
  // is tapped with gaps, each one here shows its own message.
  const overWithdrawable =
    selectedType === "withdrawal" && withdrawableNow != null && isValidPositiveNumber(amount) && Number(amount) > withdrawableNow + 0.004
  const missing = {
    amount: !isValidPositiveNumber(amount) || overWithdrawable,
    date: !txnDate,
    bank: needsBank && !bankId,
    toBank: isBankTransfer && !toBankId,
    loan: isLoanPayment && !selectedLoanId,
    investment: isInvestmentEntry && !investmentId,
    receipt: needsReceipt && !receipt,
    payout: needsPayout && !payoutDetails.trim() && !payoutQr,
    interest: isLoanRequest && !(interestType === "rate" ? interestRate : interestAmount),
    term: isLoanRequest && !termMonths,
    dueDay: isLoanRequest && repaymentFrequency === "monthly" && !dueDay
  }
  const anyMissing = Object.values(missing).some(Boolean)
  const err = (key: keyof typeof missing, text: string) => (showErrors && missing[key] ? text : undefined)

  // Highlights everything missing at once and scrolls to the first one.
  function flagMissing() {
    setShowErrors(true)
    setMessage(FILL_MESSAGE)
    setTimeout(() => document.querySelector('[role="alert"]')?.scrollIntoView({ behavior: "smooth", block: "center" }), 0)
  }
  // An admin's entry is approved the moment it's saved (fund-level types,
  // their own Investment Return, or an on-behalf Contribution/Loan Payment)
  // -- so, same as approving from the queue, show which bank balance it
  // moves before Submit and where that balance landed after.
  const recordsApproved = isAdmin && (isAdminFundEntry || isInvestmentReturn || willAutoApproveOnBehalf)
  const entryImpact = (() => {
    if (!recordsApproved || !isValidPositiveNumber(amount)) return null
    const amountNum = Number(amount)
    const accountFor = (id: string) => banks.find((b) => b.id === id)
    if (isBankTransfer) {
      // Two legs, exactly like v_cash_ledger's Internal Transfer rows.
      const legs: TxnImpact[] = []
      const from = accountFor(bankId)
      const to = accountFor(toBankId)
      if (from) legs.push({ kind: "bank", bank: from.account_name || from.bank_name, delta: -amountNum })
      if (to) legs.push({ kind: "bank", bank: to.account_name || to.bank_name, delta: amountNum })
      return legs.length ? { ...groupImpacts(legs), noneReason: undefined } : null
    }
    if (isInvestmentEntry && !investmentId) return null
    const selectedInvestment = investmentsList.find((inv) => inv.investment_id === investmentId)
    const impact = txnImpact(
      {
        transaction_id: "new",
        amount: isExpense || isInvestment ? -amountNum : amountNum,
        affects_cash: isInvestmentEntry ? (selectedInvestment?.affects_cash ? 1 : 0) : 1
      },
      accountFor(bankId)
    )
    // Bank is required to submit, so before one's picked there's nothing
    // useful to preview -- no "no bank set" note.
    if (impact.kind === "none" && impact.reason === "no_bank") return null
    return { ...groupImpacts([impact]), noneReason: impact.kind === "none" ? impact.reason : undefined }
  })()

  const [bankBalances, setBankBalances] = useState<Record<string, number> | null>(null)
  useEffect(() => {
    if (!isAdmin) return
    fetchBankBalances()
      .then(setBankBalances)
      .catch(() => setBankBalances(null))
  }, [isAdmin])

  // Appended to the saved toast -- each moved bank's balance re-fetched
  // after the write, so the admin doesn't need to go check the Banks page.
  async function balanceSuffix(): Promise<string> {
    if (!entryImpact || entryImpact.banks.length === 0) return ""
    try {
      const fresh = await fetchBankBalances()
      const money = (n: number) =>
        `${n < 0 ? "-" : ""}₱${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      return ` · ${entryImpact.banks.map((b) => `${b.bank} now ${money(fresh[b.bank] ?? 0)}`).join(" · ")}`
    } catch {
      return ""
    }
  }

  const showSaveAsDefault =
    (isContribution && (contributionDefault == null || contributionBankDefault == null)) ||
    (isLoanPayment && (loanPaymentDefault == null || loanPaymentBankDefault == null))

  const previewTotalRepayable =
    isValidPositiveNumber(amount) &&
    (interestType === "rate" ? isValidPositiveNumber(interestRate, true) : isValidPositiveNumber(interestAmount, true))
      ? totalRepayable(Number(amount), interestType, Number(interestRate || 0), Number(interestAmount || 0))
      : 0

  function setReceiptFile(file: File | null) {
    setReceipt(file)
    setReceiptPreview(file ? URL.createObjectURL(file) : null)
  }

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

  async function handleTypeChange(newType: string) {
    setSelectedType(newType)
    setFormStep(1)
    setMessage("")
    setReceiptFile(null)
    setBankId("")
    setToBankId("")
    setAmount("")
    setInterestType("rate")
    setInterestRate("")
    setInterestAmount("")
    setTermMonths("")
    setRepaymentFrequency("monthly")
    setDueDay("")
    setPayoutDetails("")
    setPayoutQrFile(null)
    setShowErrors(false)
    setSelectedLoanId("")
    setInvestmentId("")
    setSaveAsDefault(false)
    setAmountEdited(false)
    const seq = ++loadSeqRef.current

    if (newType === "loan_payment" && memberId) {
      const id = onBehalfOfId || memberId
      const [{ loans, totals }, { loanPay, loanPayBank }] = await Promise.all([
        loadLoansFor(id, seq),
        loadPreferencesFor(id, seq)
      ])
      if (isStale(seq)) return
      applyLoanPaymentStart(loans, totals, loanPay)
      if (loanPayBank) setBankId(loanPayBank)
    }

    if (newType === "contribution" && memberId) {
      const { contrib, contribBank } = await loadPreferencesFor(onBehalfOfId || memberId, seq)
      if (isStale(seq)) return
      if (contrib != null && !amountEditedRef.current) setAmount(String(contrib))
      if (contribBank) setBankId(contribBank)
    }
  }

  async function handleOnBehalfChange(id: string) {
    setOnBehalfOfId(id)
    setSelectedLoanId("")
    setSaveAsDefault(false)
    const seq = ++loadSeqRef.current

    if (selectedType === "loan_payment") {
      const target = id || memberId || ""
      const [{ loans, totals }, { loanPay, loanPayBank }] = await Promise.all([
        loadLoansFor(target, seq),
        loadPreferencesFor(target, seq)
      ])
      if (isStale(seq)) return
      // Keeps a typed amount; still picks the member's only loan.
      applyLoanPaymentStart(loans, totals, loanPay)
      if (!bankId && loanPayBank) setBankId(loanPayBank)
    }

    if (selectedType === "contribution") {
      const { contrib, contribBank } = await loadPreferencesFor(id || memberId || "", seq)
      if (isStale(seq)) return
      if (!amount && contrib != null) setAmount(String(contrib))
      if (!bankId && contribBank) setBankId(contribBank)
    }
  }

  function detailsStepError(): string {
    if (!isValidPositiveNumber(amount)) return "Enter a valid amount greater than zero."
    if (isLoanRequest) {
      if (interestType === "rate" && !isValidPositiveNumber(interestRate, true)) {
        return "Enter a valid interest rate (0 or higher)."
      }
      if (interestType === "amount" && !isValidPositiveNumber(interestAmount, true)) {
        return "Enter a valid interest amount (0 or higher)."
      }
      if (!isValidPositiveNumber(termMonths)) return "Enter a valid term, in months greater than zero."
      if (repaymentFrequency === "monthly" && !dueDay) return MISSING_DUE_DAY_MESSAGE
      if (!payoutDetails.trim() && !payoutQr) return MISSING_PAYOUT_MESSAGE
    }
    return ""
  }

  function handleContinueToReview() {
    if (anyMissing) {
      flagMissing()
      return
    }
    const error = detailsStepError()
    if (error) {
      setMessage(error)
      return
    }
    setMessage("")
    setFormStep(2)
  }

  async function handleSubmit() {
    setMessage("")
    if (anyMissing) {
      flagMissing()
      return
    }

    if (!isValidPositiveNumber(amount)) {
      setMessage("Enter a valid amount greater than zero.")
      return
    }
    if (!txnDate) {
      setMessage("Select a date.")
      return
    }
    if (needsBank && !bankId) {
      setMessage("Select a bank.")
      return
    }
    if (needsReceipt && !receipt) {
      setMessage("Attach a receipt.")
      return
    }
    if (isLoanRequest && interestType === "rate" && !isValidPositiveNumber(interestRate, true)) {
      setMessage("Enter a valid interest rate (0 or higher).")
      return
    }
    if (isLoanRequest && interestType === "amount" && !isValidPositiveNumber(interestAmount, true)) {
      setMessage("Enter a valid interest amount (0 or higher).")
      return
    }
    if (isLoanRequest && !isValidPositiveNumber(termMonths)) {
      setMessage("Enter a valid term, in months greater than zero.")
      return
    }
    if (isLoanRequest && repaymentFrequency === "monthly" && !dueDay) {
      setMessage(MISSING_DUE_DAY_MESSAGE)
      return
    }
    if (needsPayout && !payoutDetails.trim() && !payoutQr) {
      setMessage(MISSING_PAYOUT_MESSAGE)
      return
    }
    if (isLoanPayment && !selectedLoanId) {
      setMessage("Select which loan you're paying.")
      return
    }
    if (isInvestmentEntry && !investmentId) {
      setMessage(isInvestment ? "Select which investment this funds." : "Select which investment this is returning from.")
      return
    }
    if (isBankTransfer && !toBankId) {
      setMessage("Select the destination bank.")
      return
    }

    setSubmitting(true)

    let receiptUrl: string | null = null
    if (receipt) {
      const fileName = `${effectiveMemberId}-${Date.now()}-${receipt.name}`
      const { error: uploadError } = await supabase.storage.from("Receipts").upload(fileName, receipt, {
        contentType: receipt.type
      })
      if (uploadError) {
        setMessage(uploadError.message)
        setSubmitting(false)
        return
      }
      receiptUrl = fileName
    }

    // Named "<member_id>-..." like receipts, so the Receipts bucket's
    // storage policy still lets the member view their own file.
    let qrPath: string | null = null
    if (needsPayout && payoutQr) {
      qrPath = `${effectiveMemberId}-payout-${Date.now()}-${payoutQr.name}`
      const { error: uploadError } = await supabase.storage
        .from("Receipts")
        .upload(qrPath, payoutQr, { contentType: payoutQr.type })
      if (uploadError) {
        if (receiptUrl) await supabase.storage.from("Receipts").remove([receiptUrl])
        setMessage(uploadError.message)
        setSubmitting(false)
        return
      }
    }

    if (isLoanRequest) {
      const { error } = await supabase.rpc("submit_loan_request", {
        p_member_id: effectiveMemberId,
        p_principal: Number(amount),
        p_interest_type: interestType,
        p_interest_rate: interestType === "rate" ? Number(interestRate) : 0,
        p_interest_amount: interestType === "amount" ? Number(interestAmount) : null,
        p_term_months: Number(termMonths),
        p_repayment_frequency: repaymentFrequency,
        p_start_date: txnDate,
        p_notes: description,
        p_description: description,
        p_submitted_by: submittedByForOnBehalf,
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
      onSaved("Loan request submitted")
      return
    }

    // Unlike the other four types, Investment Return has two different
    // shapes depending on who submits it. An admin's is a fund-level
    // entry (member_id null, approved immediately, no on-behalf-of
    // concept -- it isn't attributed to any one member).
    // A regular member's own return is a pending, self-attributed row
    // like a Contribution, going into the approval queue.
    if (isInvestmentReturn) {
      const selectedInvestment = investmentsList.find((inv) => inv.investment_id === investmentId)
      const status = isAdmin ? "approved" : "pending"

      const { error } = await supabase.from("transactions").insert({
        member_id: isAdmin ? null : memberId,
        bank_account_id: bankId || null,
        investment_id: investmentId,
        classification: "Investment Return",
        amount: Number(amount),
        txn_date: txnDate,
        description,
        receipt_url: receiptUrl,
        status,
        submitted_by: isAdmin ? memberId : null,
        affects_cash: selectedInvestment?.affects_cash ? 1 : 0
      })

      setSubmitting(false)
      if (error) {
        if (receiptUrl) await supabase.storage.from("Receipts").remove([receiptUrl])
        setMessage(error.message)
        return
      }
      onSaved(`Investment return ${status === "pending" ? "submitted" : "recorded"}${await balanceSuffix()}`)
      return
    }

    // Cash-neutral: affects_cash 0 keeps it out of the cash ledger; the
    // per-bank balances use bank_account_id / to_bank_account_id instead.
    if (isBankTransfer) {
      const { error } = await supabase.from("transactions").insert({
        member_id: null,
        bank_account_id: bankId,
        to_bank_account_id: toBankId,
        classification: "Internal Transfer",
        affects_cash: 0,
        amount: Number(amount),
        txn_date: txnDate,
        description,
        receipt_url: receiptUrl,
        status: "approved",
        submitted_by: memberId
      })

      setSubmitting(false)
      if (error) {
        if (receiptUrl) await supabase.storage.from("Receipts").remove([receiptUrl])
        setMessage(error.message)
        return
      }
      onSaved(`Bank transfer recorded${await balanceSuffix()}`)
      return
    }

    // Bank Interest, Expense, and new Investment outflows -- fund-level
    // entries same shape as Investment Return's own admin path above,
    // just always approved immediately (no member-submitted pending
    // version of these exists). Expense and new Investment capital are
    // cash going out, so the ledger stores them negative (matches
    // v_investment_summary,
    // which reads "invested" as -amount on Investment rows). Bank
    // Interest rows default to interest_distributed = false and sit
    // there until an admin manually distributes them from /admin.
    if (isBankInterest || isExpense || isInvestment) {
      const classification = isBankInterest ? "Bank Interest" : isExpense ? "Expense" : "Investment"
      const selectedInvestment = isInvestment ? investmentsList.find((inv) => inv.investment_id === investmentId) : null

      const { error } = await supabase.from("transactions").insert({
        member_id: null,
        bank_account_id: bankId || null,
        investment_id: isInvestment ? investmentId : null,
        classification,
        amount: isExpense || isInvestment ? -Number(amount) : Number(amount),
        txn_date: txnDate,
        description,
        receipt_url: receiptUrl,
        status: "approved",
        submitted_by: memberId,
        ...(isInvestment ? { affects_cash: selectedInvestment?.affects_cash ? 1 : 0 } : {})
      })

      if (error) {
        setSubmitting(false)
        if (receiptUrl) await supabase.storage.from("Receipts").remove([receiptUrl])
        setMessage(error.message)
        return
      }

      // New capital into an investment changes who's staking it, so
      // re-snapshot the pool's shares for this investment's hold
      // tracking. The transaction itself already succeeded, so a
      // failure here shouldn't block the confirmation or invite a
      // duplicate resubmit, just surface it.
      let holdWarning = ""
      if (isInvestment) {
        try {
          await snapshotInvestmentHold(investmentId, dateOnly(new Date()))
        } catch (err) {
          holdWarning = ` (hold recompute failed: ${err instanceof Error ? err.message : "unknown error"} -- an admin should retry)`
        }
      }

      setSubmitting(false)
      onSaved(`${classification} recorded${holdWarning}${await balanceSuffix()}`)
      return
    }

    const classification =
      selectedType === "loan_payment" ? "Loan Repayment" : selectedType === "withdrawal" ? "Member Withdrawal" : "Member Contribution"
    const status = willAutoApproveOnBehalf ? "approved" : "pending"

    const { error } = await supabase.from("transactions").insert({
      member_id: effectiveMemberId,
      bank_account_id: bankId || null,
      loan_id: isLoanPayment ? selectedLoanId : null,
      classification,
      amount: selectedType === "withdrawal" ? -Number(amount) : Number(amount),
      txn_date: txnDate,
      description,
      receipt_url: receiptUrl,
      status,
      submitted_by: submittedByForOnBehalf,
      ...(isWithdrawal ? { payout_details: payoutDetails.trim() || null, payout_qr_path: qrPath } : {})
    })

    if (error) {
      setSubmitting(false)
      if (receiptUrl) await supabase.storage.from("Receipts").remove([receiptUrl])
      if (qrPath) await supabase.storage.from("Receipts").remove([qrPath])
      setMessage(error.message)
      return
    }

    let defaultSaveWarning = ""
    if (saveAsDefault && (isContribution || isLoanPayment)) {
      if (effectiveMemberId === memberId) {
        const [{ error: amountError }, { error: bankError }] = await Promise.all([
          supabase.rpc(isContribution ? "set_default_contribution_amount" : "set_default_loan_payment_amount", {
            p_amount: Number(amount)
          }),
          supabase.rpc(isContribution ? "set_default_contribution_bank" : "set_default_loan_payment_bank", {
            p_bank_id: bankId || null
          })
        ])
        if (amountError || bankError) defaultSaveWarning = " (couldn't save as default -- try again next time)"
      } else {
        const { error: defaultError } = await supabase
          .from("members")
          .update(
            isContribution
              ? { default_contribution_amount: Number(amount), default_contribution_bank_id: bankId || null }
              : { default_loan_payment_amount: Number(amount), default_loan_payment_bank_id: bankId || null }
          )
          .eq("member_id", effectiveMemberId)
        if (defaultError) defaultSaveWarning = " (couldn't save as default -- try again next time)"
      }
    }

    setSubmitting(false)

    const typeLabel = selectedType === "loan_payment" ? "Loan repayment" : selectedType === "withdrawal" ? "Withdrawal" : "Contribution"
    onSaved(`${typeLabel} ${status === "pending" ? "submitted" : "recorded"}${defaultSaveWarning}${await balanceSuffix()}`)
  }

  const fmt = (n: number) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  function bankLabel(id: string) {
    const bank = banks.find((b) => b.id === id)
    return bank ? bank.account_name || bank.bank_name : "Bank"
  }

  const selectedTypeOption = withFlow(ENTRY_TYPES).find((o) => o.key === selectedType)!

  // Shared by Loan Request (step 1) and Withdrawal -- both are paid out by
  // an admin after approval, using what the member enters here.
  const payoutField = (
    <>
      <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">Where should we send it?</p>
      <div
        ref={payoutFieldRef}
        className={`card p-4 space-y-3 transition-colors ${err("payout", "x") ? "!border-rust" : ""}`}
      >
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
      {err("payout", "x") && (
        <FieldError message="Add your bank or e-wallet details, or a QR code" className="px-1 mt-1.5" />
      )}
    </>
  )

  // First row of the Details card, matching budget-tracker's own Category
  // row -- same "Label: value" shape, same colored flow-tone badge instead
  // of a bare icon (the one row here with real per-value styling to show,
  // same reasoning FlowBadge already got when TypeDropdown was still a
  // standalone dropdown), and opens a picker sheet on tap instead of the
  // old inline-expanding list.
  const typeField = (
    <button
      type="button"
      onClick={() => setShowTypePicker(true)}
      className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
    >
      <TypeBadge arrow={selectedTypeOption.arrow} tone={selectedTypeOption.tone} />
      <span className="flex-1 min-w-0 text-sm">
        <span className="text-ink-soft">Type: </span>
        <span className="font-semibold text-ink">{selectedTypeOption.label}</span>
      </span>
      <span className="text-ink-soft text-xs shrink-0">▾</span>
    </button>
  )

  // Only the original four member-facing types support on-behalf-of --
  // Investment Return (as an admin) and the four adminOnly fund-level
  // types are all entries attributed to no one member (see handleSubmit),
  // not something done "for" a specific member the way a Contribution can
  // be.
  const onBehalfOfField = isAdmin && supportsOnBehalfOf && (
    <FieldRow icon={<PersonIcon />}>
      <select className={rowSelectClass} value={onBehalfOfId} onChange={(e) => handleOnBehalfChange(e.target.value)}>
        <option value="">Myself</option>
        {allMembers
          .filter((m) => m.member_id !== memberId)
          .map((m) => (
            <option key={m.member_id} value={m.member_id}>
              {m.name}
            </option>
          ))}
      </select>
    </FieldRow>
  )

  const investmentField = isInvestmentEntry && (
    // Same tappable-row pattern as the Loan Payment field below -- both are
    // just "pick one of a short list," and InvestmentPickerSheet already
    // has its own graceful "No open investments" empty state, same as
    // LoanPickerSheet does.
    <button
      type="button"
      onClick={() => setShowInvestmentPicker(true)}
      className={`w-full flex items-center gap-3 px-4 py-3.5 text-left ${err("investment", "x") ? invalidRowClass : ""}`}
    >
      <InvestmentRowIcon />
      <span className="flex-1 min-w-0 text-sm">
        {selectedInvestment ? (
          <span className="text-ink">{selectedInvestment.name}</span>
        ) : (
          <span className="text-ink-soft">Which investment</span>
        )}
        {err("investment", "x") && <FieldError message="Choose which investment" className="mt-1" />}
      </span>
      <span className="text-ink-soft text-xs shrink-0">▾</span>
    </button>
  )

  const toBankField = isBankTransfer && (
    <FieldRow icon={<BankIcon />} error={err("toBank", "Choose the bank it's going to")}>
      <select
        className={rowSelectClass}
        value={toBankId}
        onChange={(e) => {
          setToBankId(e.target.value)
          if (message === "Select the destination bank.") setMessage("")
        }}
      >
        <option value="">To which bank</option>
        {banks.map((bank) => (
          <option key={bank.id} value={bank.id}>
            {bank.account_name || bank.bank_name}
          </option>
        ))}
      </select>
    </FieldRow>
  )

  const onBehalfOfNote = isAdmin && supportsOnBehalfOf && onBehalfOfId && (
    <p className="px-1 pt-2 text-sm text-gold">
      {willAutoApproveOnBehalf
        ? `This will be recorded as approved immediately for ${allMembers.find((m) => m.member_id === onBehalfOfId)?.name}.`
        : `This still goes through the normal approval process for ${allMembers.find((m) => m.member_id === onBehalfOfId)?.name} -- it isn't approved immediately.`}
    </p>
  )

  return (
    <>
    <Sheet
      title="New Transaction"
      onClose={onClose}
      footer={
        <>
          {message && !(message === FILL_MESSAGE && !anyMissing) && <p className="text-sm text-rust mb-3">{message}</p>}
          {entryImpact && (
            <BankImpactPreview {...entryImpact} balances={bankBalances} title="Bank balance after saving" className="mb-3" />
          )}
          <div className="flex items-center gap-3">
            {isStepped && formStep === 2 && (
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
              onClick={isStepped && formStep === 1 ? handleContinueToReview : handleSubmit}
              disabled={submitting || dataLoading}
            >
              {submitting ? "Submitting…" : isStepped && formStep === 1 ? "Continue" : "Submit"}
            </button>
          </div>
        </>
      }
    >
      {dataLoading ? (
        <SkeletonPanel />
      ) : loadError ? (
        <p className="py-12 text-center text-sm text-rust">Couldn&apos;t load: {loadError}</p>
      ) : (
        <>
          <AmountHero
            value={amount}
            onChange={(v) => {
              setAmount(v)
              setAmountEdited(true)
            }}
            error={err("amount", overWithdrawable ? `More than your ₱${fmt(withdrawableNow ?? 0)} available` : "Enter an amount")}
          />
          {isWithdrawal && withdrawableNow != null && !(showErrors && overWithdrawable) && (
            <p className={`-mt-2 text-center text-xs font-mono ${overWithdrawable ? "text-rust" : "text-ink-soft"}`}>
              ₱{fmt(withdrawableNow)} available to withdraw
            </p>
          )}

          <div className="space-y-4 mt-4">
            {!isStepped && (
              <>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">Details</p>
                  <div className="card divide-y divide-hairline overflow-hidden">
                    {typeField}

                    {onBehalfOfField}

                    <DateField value={txnDate} onChange={setTxnDate} placeholder="Date" bare error={err("date", "Pick a date")} />

                    {investmentField}

                    {isLoanPayment && (
                      // Same pattern as investmentField -- always render the
                      // tappable row regardless of whether there's anything
                      // to pick; LoanPickerSheet already shows its own
                      // graceful "No active loans" empty state, so a second,
                      // redder version of that same message here was
                      // redundant.
                      <button
                        type="button"
                        onClick={() => setShowLoanPicker(true)}
                        className={`w-full flex items-center gap-3 px-4 py-3.5 text-left ${err("loan", "x") ? invalidRowClass : ""}`}
                      >
                        <LoanRowIcon />
                        <span className="flex-1 min-w-0 text-sm">
                          {selectedLoan ? (
                            <span className="text-ink">
                              {loanPickLabel(Number(selectedLoan.principal), selectedLoan.start_date, fmt)}
                            </span>
                          ) : (
                            <span className="text-ink-soft">Which loan</span>
                          )}
                          {err("loan", "x") && <FieldError message="Choose which loan" className="mt-1" />}
                        </span>
                        <span className="text-ink-soft text-xs shrink-0">▾</span>
                      </button>
                    )}

                    {needsBank && (
                      <FieldRow
                        icon={<BankIcon />}
                        error={err("bank", isBankTransfer ? "Choose the bank it's leaving" : "Choose a bank")}
                      >
                        <select
                          className={rowSelectClass}
                          value={bankId}
                          onChange={(e) => {
                            setBankId(e.target.value)
                            if (message === "Select a bank.") setMessage("")
                          }}
                        >
                          <option value="">{isBankTransfer ? "From which bank" : "Select a bank"}</option>
                          {banks.map((bank) => (
                            <option key={bank.id} value={bank.id}>
                              {bank.account_name || bank.bank_name}
                            </option>
                          ))}
                        </select>
                      </FieldRow>
                    )}

                    {toBankField}

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

                  {onBehalfOfNote}

                  {isLoanPayment &&
                    selectedLoanId &&
                    (() => {
                      if (!selectedLoan) return null
                      const remaining =
                        totalRepayable(
                          Number(selectedLoan.principal),
                          selectedLoan.interest_type,
                          Number(selectedLoan.interest_rate || 0),
                          Number(selectedLoan.interest_amount || 0)
                        ) - (loanRepaidTotals[selectedLoan.loan_id] || 0)
                      return <p className="px-1 pt-2 text-sm text-ink-soft">₱{fmt(Math.max(0, remaining))} left to pay</p>
                    })()}

                  {showSaveAsDefault && isValidPositiveNumber(amount) && (
                    <label
                      className={`card mt-3 flex items-center gap-3 px-4 py-3.5 cursor-pointer transition-colors ${
                        saveAsDefault ? "!border-sage" : ""
                      }`}
                    >
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
                          Save ₱{fmt(Number(amount))}
                          {bankId ? ` and ${bankLabel(bankId)}` : ""} as{" "}
                          {onBehalfOfId ? `${allMembers.find((m) => m.member_id === onBehalfOfId)?.name}'s` : "my"}{" "}
                          default {isContribution ? "contribution" : "loan payment"}{" "}
                          {bankId ? "amount and bank" : "amount"}
                        </span>
                      </span>
                    </label>
                  )}
                </div>

                {needsReceipt && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">Receipt</p>
                    <ReceiptField
                      receipt={receipt}
                      receiptPreview={receiptPreview}
                      dragActive={dragActive}
                      setDragActive={setDragActive}
                      onFileChange={setReceiptFile}
                      error={err("receipt", "Attach a receipt")}
                    />
                  </div>
                )}

                {isWithdrawal && <div>{payoutField}</div>}
              </>
            )}

            {isStepped && (
              <>
                <StepTrack step={formStep} labels={["Details", "Review"]} />

                {formStep === 1 && (
                  <>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">Details</p>
                      <div className="card divide-y divide-hairline overflow-hidden">
                        {typeField}

                        {onBehalfOfField}

                        <DateField value={txnDate} onChange={setTxnDate} placeholder="Date" bare error={err("date", "Pick a date")} />

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

                      {onBehalfOfNote}
                    </div>

                    <div className="mt-4">
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
                    </div>

                    <div className="mt-4">{payoutField}</div>
                  </>
                )}

                {formStep === 2 && (
                  <FieldGroup>
                    <ReviewRow label="Type" value={ENTRY_TYPES.find((t) => t.key === selectedType)?.label ?? ""} />
                    <ReviewRow label="Amount to borrow" value={`₱${fmt(isValidPositiveNumber(amount) ? Number(amount) : 0)}`} />
                    <ReviewRow
                      label="Date"
                      value={new Date(`${txnDate}T00:00:00`).toLocaleDateString(undefined, {
                        day: "numeric",
                        month: "short",
                        year: "numeric"
                      })}
                    />
                    {onBehalfOfId && (
                      <ReviewRow label="On behalf of" value={allMembers.find((m) => m.member_id === onBehalfOfId)?.name ?? ""} />
                    )}
                    <ReviewRow
                      label="Interest"
                      value={interestType === "rate" ? `${interestRate || 0}%` : `₱${fmt(Number(interestAmount) || 0)} fixed`}
                    />
                    <ReviewRow label="Term" value={`${termMonths || 0} ${termMonths === "1" ? "month" : "months"}`} />
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
              </>
            )}
          </div>
        </>
      )}
    </Sheet>

    {showLoanPicker && (
      <LoanPickerSheet
        loans={activeLoans}
        repaidTotals={loanRepaidTotals}
        onClose={() => setShowLoanPicker(false)}
        onSelect={(loan) => {
          setSelectedLoanId(loan.loan_id)
          setShowLoanPicker(false)
          if (!amountEdited) {
            const full = activeLoans.find((l) => l.loan_id === loan.loan_id)
            const start = full ? startingAmount(full, loanRepaidTotals[loan.loan_id] || 0, loanPaymentDefault) : 0
            if (start > 0) setAmount(String(start))
          }
        }}
      />
    )}

    {showInvestmentPicker && (
      <InvestmentPickerSheet
        investments={investmentsList}
        onClose={() => setShowInvestmentPicker(false)}
        onSelect={(investment) => {
          setInvestmentId(investment.investment_id)
          setShowInvestmentPicker(false)
        }}
      />
    )}

    {showTypePicker && (
      <TypePickerSheet
        options={withFlow(
          ENTRY_TYPES.filter((t) => {
            if (t.adminOnly && !isAdmin) return false
            // Loan Payment is only hidden for a member picking for
            // themselves -- an admin's own activeLoans here is *their own*
            // loans, not whichever member they might pick on-behalf-of a
            // moment later (that field only appears after the type is
            // already chosen), so hiding it for admins could block a
            // payment for a member who does have one.
            if (t.key === "loan_payment" && !isAdmin && activeLoans.length === 0) return false
            // Investments are fund-level, not owned by any one member --
            // if there's nothing open fund-wide, there's genuinely nothing
            // for anyone, admin included, to pick.
            if (t.key === "investment_return" && investmentsList.length === 0) return false
            return true
          })
        )}
        value={selectedType}
        onClose={() => setShowTypePicker(false)}
        onSelect={(key) => {
          handleTypeChange(key)
          setShowTypePicker(false)
        }}
      />
    )}
    </>
  )
}
