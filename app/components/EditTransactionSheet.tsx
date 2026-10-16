"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/app/auth-context"
import { Sheet } from "@/app/components/Sheet"
import { SkeletonPanel } from "@/app/components/Skeleton"
import {
  AmountHero,
  FlowBadge,
  StepTrack,
  ReviewRow,
  ReceiptsField,
  FieldError,
  invalidRowClass,
  FieldGroup,
  BankIcon,
  NoteIcon,
  InterestIcon,
  ClockIcon,
  RepeatIcon,
  CalendarIcon,
  FieldRow,
  rowSelectClass,
  rowInputClass
} from "@/app/components/TransactionFormUI"
import { totalRepayable, type InterestType } from "@/lib/loanMath"
import { receiptPaths, removeReceipts, uploadReceipts } from "@/lib/receiptUrl"
import { LoanPickerSheet, LoanRowIcon } from "@/app/components/LoanPickerSheet"
import { InvestmentPickerSheet, InvestmentRowIcon } from "@/app/components/InvestmentPickerSheet"
import { InterestRatePickerSheet } from "@/app/components/InterestRatePickerSheet"
import { TermPickerSheet } from "@/app/components/TermPickerSheet"
import { DueDayPickerSheet } from "@/app/components/DueDayPickerSheet"
import { ordinalDay, loanPickLabel } from "@/lib/loanFormat"
import { notifyTransactionsChanged } from "@/lib/transactionEvents"
import { getCachedTransactionRow } from "@/lib/transactionRowCache"
import { getCachedTransactionFormData } from "@/lib/transactionFormPrefetch"

// Member-submitted types: editable by the member who owns the row, only
// while it's still pending. Investment Return is also member-submittable
// now (see NewTransactionSheet), but only when this particular row actually
// has a member_id -- an admin's own Investment Return has none, so that
// shape is handled by the isAdminSimpleType check below instead. See
// isMemberOwnedInvestmentReturn/isAdminOwnedInvestmentReturn in load().
const MEMBER_EDITABLE = ["Member Contribution", "Member Withdrawal", "Loan Repayment"]

// Admin-entered types: always inserted already-approved with no owning
// member, so "pending" never applies -- editable by an admin at any time
// (short of already being cancelled). Investment is always admin-only, so
// it's safe to list statically -- Investment Return isn't, for the reason
// above.
const ADMIN_EDITABLE = ["Bank Interest", "Expense", "Internal Transfer", "Investment"]

// Loan Release is handled separately (see load()): it's paired with a
// "loans" row, so it's only editable by an admin, and only while that loan
// is still "requested" -- once approved/active, changes belong on the
// loan's own page instead.

const TYPE_LABEL: Record<string, string> = {
  "Member Contribution": "Contribution",
  "Member Withdrawal": "Withdrawal",
  "Loan Repayment": "Loan Payment",
  "Loan Release": "Loan Release",
  "Bank Interest": "Bank Interest",
  "Expense": "Expense",
  "Internal Transfer": "Bank Transfer",
  "Investment": "Investment",
  "Investment Return": "Investment Return"
}

const FLOW: Record<string, { arrow: string; tone: "in" | "out" | "neutral" }> = {
  "Member Contribution": { arrow: "↑", tone: "in" },
  "Member Withdrawal": { arrow: "↓", tone: "out" },
  "Loan Repayment": { arrow: "↑", tone: "in" },
  "Loan Release": { arrow: "↓", tone: "out" },
  "Bank Interest": { arrow: "↑", tone: "in" },
  "Expense": { arrow: "↓", tone: "out" },
  "Internal Transfer": { arrow: "⇄", tone: "neutral" },
  "Investment": { arrow: "↓", tone: "out" },
  "Investment Return": { arrow: "↑", tone: "in" }
}

const STATUS_TONE: Record<string, string> = {
  pending: "text-gold border-gold/40",
  approved: "text-sage border-sage/40",
  rejected: "text-rust border-rust/40"
}

// allowZero: interest rate may legitimately be 0.
const FILL_MESSAGE = "Fill in the highlighted fields."

function isValidPositiveNumber(value: string, allowZero = false): boolean {
  if (!value.trim()) return false
  const n = Number(value)
  if (Number.isNaN(n)) return false
  return allowZero ? n >= 0 : n > 0
}

export function EditTransactionSheet({ transactionId, onClose }: { transactionId: string; onClose: () => void }) {
  const { loading: authLoading, member } = useAuth()
  const isAdmin = member?.role === "admin"
  const [dataLoading, setDataLoading] = useState(true)
  const checkingAccess = authLoading || dataLoading
  const [notFound, setNotFound] = useState(false)

  const [banks, setBanks] = useState<any[]>([])
  const [myLoans, setMyLoans] = useState<any[]>([])
  const [loanRepaidTotals, setLoanRepaidTotals] = useState<Record<string, number>>({})
  const [investmentsList, setInvestmentsList] = useState<any[]>([])

  const [classification, setClassification] = useState("")
  const [status, setStatus] = useState("")
  const [rejectionReason, setRejectionReason] = useState<string | null>(null)
  const [bankId, setBankId] = useState("")
  const [toBankId, setToBankId] = useState("")
  const [loanId, setLoanId] = useState("")
  const [investmentId, setInvestmentId] = useState("")
  // Set once at load from the row's actual member_id -- Investment Return
  // can be either a member's own pending submission or an admin's
  // already-approved one (see NewTransactionSheet), so this can't be
  // derived from classification alone the way it can for every other type.
  const [isMemberOwned, setIsMemberOwned] = useState(false)
  const [amount, setAmount] = useState("")
  const [interestType, setInterestType] = useState<InterestType>("rate")
  const [interestRate, setInterestRate] = useState("")
  const [interestAmount, setInterestAmount] = useState("")
  const [termMonths, setTermMonths] = useState("")
  const [repaymentFrequency, setRepaymentFrequency] = useState("monthly")
  const [dueDay, setDueDay] = useState("")
  // Picker sheets replace plain <select>/<input> for these four fields,
  // matching NewTransactionSheet's pattern -- interestRateCustom/termCustom
  // default to false (picker-driven) same as there, regardless of whether
  // an existing edited value happens to match a preset: the tappable row
  // always displays the real value either way, and "Custom..." in the
  // sheet is still one tap away.
  const [showLoanPicker, setShowLoanPicker] = useState(false)
  const [showInvestmentPicker, setShowInvestmentPicker] = useState(false)
  const [showInterestRatePicker, setShowInterestRatePicker] = useState(false)
  const [showTermPicker, setShowTermPicker] = useState(false)
  const [showDueDayPicker, setShowDueDayPicker] = useState(false)
  const [interestRateCustom, setInterestRateCustom] = useState(false)
  const [termCustom, setTermCustom] = useState(false)
  const [description, setDescription] = useState("")
  // What the row had on load vs. what's still kept after the editor
  // removes some -- the difference gets deleted from storage on save.
  const [originalReceipts, setOriginalReceipts] = useState<string[]>([])
  const [keptReceipts, setKeptReceipts] = useState<string[]>([])
  const [interestDistributed, setInterestDistributed] = useState(false)
  // Whether this row's investment has ever had a gain/loss distribution run
  // against it -- Investment/Investment Return have no per-transaction flag
  // the way Bank Interest does, since a distribution pools every approved
  // transaction under the investment rather than crediting off one row.
  const [investmentAlreadyDistributed, setInvestmentAlreadyDistributed] = useState(false)
  const [receipts, setReceipts] = useState<File[]>([])

  const [saving, setSaving] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [message, setMessage] = useState("")
  // Set when Save/Continue is tapped with something missing -- see `missing`.
  const [showErrors, setShowErrors] = useState(false)

  // Loan Release is the one editable type with enough conditional fields
  // to earn its own Details -> Review sub-flow, matching NewTransactionSheet.
  const [formStep, setFormStep] = useState<1 | 2>(1)

  useEffect(() => {
    if (authLoading) return

    // This sheet only ever opens from a page that's already gated on its
    // own auth checks -- if member somehow isn't there or isn't approved
    // by the time this runs, just close rather than forcing a navigation
    // out from under whatever page is showing behind it.
    if (!member || member.status !== "approved") {
      onClose()
      return
    }

    // Borrowers are otherwise routed away from the admin/member transaction
    // pages, but this sheet also serves their own pending Loan Repayment
    // entries (see MEMBER_EDITABLE above) -- the `editable` check further
    // down still keeps them out of anything that isn't theirs.

    async function load() {
      if (!member) return

      // A row rendered from data cached before receipt_urls existed would
      // only know its first receipt -- saving it would drop the rest, so
      // treat it as a cache miss and fetch it fresh.
      const cachedRow = getCachedTransactionRow(transactionId)
      const cachedTxn = cachedRow && Array.isArray(cachedRow.receipt_urls) ? cachedRow : null
      const cachedForm = getCachedTransactionFormData(member.member_id, isAdmin)

      let txn: any = cachedTxn
      let error: any = null

      if (cachedTxn) {
        // The list this sheet was opened from just rendered this exact row
        // on screen a moment ago -- trust it outright, the same way
        // NewTransactionSheet trusts its own prefetch cache, instead of
        // re-fetching the very thing that's already known and flashing a
        // skeleton over data that hasn't gone anywhere.
        //
        // Investment/Investment Return can point at a *closed* investment
        // (see investmentsForPicker below); NewTransactionSheet's own cache
        // is open-only, so it's only trustworthy here for every other
        // classification, where investmentsList isn't even rendered.
        const needsFreshInvestments =
          cachedTxn.classification === "Investment" || cachedTxn.classification === "Investment Return"

        if (cachedForm && !needsFreshInvestments) {
          setBanks(cachedForm.banks)
          setInvestmentsList(cachedForm.investmentsList)
        } else {
          const [bankRes, investmentRes] = await Promise.all([
            cachedForm
              ? Promise.resolve({ data: cachedForm.banks })
              : supabase.from("bank_accounts").select("id, bank_name, account_name").order("bank_name"),
            needsFreshInvestments
              ? supabase.from("investments").select("investment_id, name, affects_cash, status").order("name")
              : Promise.resolve({ data: cachedForm?.investmentsList ?? [] })
          ])
          setBanks(bankRes.data ?? [])
          setInvestmentsList(investmentRes.data ?? [])
        }
      } else {
        // No cached row -- a deep link, a fresh page load, or a browser
        // reload with the sheet still open in the URL. These three don't
        // depend on each other, so run them together instead of one after
        // another.
        const [bankRes, investmentRes, txnRes] = await Promise.all([
          supabase.from("bank_accounts").select("id, bank_name, account_name").order("bank_name"),
          // Includes closed investments too -- an existing transaction
          // already linked to one (fixing an old amount/receipt) shouldn't
          // have its investment silently disappear from the picker. The
          // picker itself filters closed ones out except for whichever one
          // this row already points to (see investmentsForPicker below).
          supabase.from("investments").select("investment_id, name, affects_cash, status").order("name"),
          supabase.from("transactions").select("*").eq("transaction_id", transactionId).single()
        ])
        setBanks(bankRes.data ?? [])
        setInvestmentsList(investmentRes.data ?? [])
        txn = txnRes.data
        error = txnRes.error
      }

      // Investment Return straddles both buckets depending on who actually
      // submitted this particular row (see the comment on MEMBER_EDITABLE
      // above) -- everything else is a static, unambiguous classification.
      const isMemberOwnedInvestmentReturn = txn ? txn.classification === "Investment Return" && txn.member_id != null : false
      const isAdminOwnedInvestmentReturn = txn ? txn.classification === "Investment Return" && txn.member_id == null : false
      const isMemberType = txn ? MEMBER_EDITABLE.includes(txn.classification) || isMemberOwnedInvestmentReturn : false
      const isAdminSimpleType = txn ? ADMIN_EDITABLE.includes(txn.classification) || isAdminOwnedInvestmentReturn : false
      const isLoanReleaseType = txn ? txn.classification === "Loan Release" : false

      let loanRecord: any = null
      if (isLoanReleaseType && txn?.loan_id) {
        const { data: loan } = await supabase.from("loans").select("*").eq("loan_id", txn.loan_id).single()
        loanRecord = loan
      }

      // Admin-recorded entries (Bank Interest/Expense/Internal Transfer) are
      // restricted to whichever admin actually submitted them -- older
      // entries with no submitted_by on file stay editable by any admin
      // instead of locking everyone out. Mirrors canEdit on the
      // Transactions list.
      const isOwnAdminEntry = txn ? txn.submitted_by == null || txn.submitted_by === member.member_id : false

      // A member-owned row stays editable through a rejection too -- saving
      // it then resubmits it (see handleSave), so a member can fix whatever
      // the reason called out instead of starting a new entry from scratch.
      // Loan Release doesn't get this: rejecting one deletes its loan record
      // entirely (see rejectTransaction in /admin), so a rejected Loan
      // Release has nothing left to resubmit and stays admin-only/pending.
      const editable =
        txn &&
        !error &&
        ((isMemberType &&
          txn.member_id === member.member_id &&
          (txn.status === "pending" || txn.status === "rejected")) ||
          (isAdminSimpleType && isAdmin && txn.status !== "cancelled" && isOwnAdminEntry) ||
          (isLoanReleaseType && isAdmin && txn.status === "pending" && loanRecord?.status === "requested"))

      if (!editable) {
        setNotFound(true)
        setDataLoading(false)
        return
      }

      setClassification(txn.classification)
      setStatus(txn.status)
      setRejectionReason(txn.rejection_reason ?? null)
      setBankId(txn.bank_account_id ?? "")
      setToBankId(txn.to_bank_account_id ?? "")
      setInvestmentId(txn.investment_id ?? "")
      setIsMemberOwned(isMemberType)
      setDescription(txn.description ?? "")
      setOriginalReceipts(receiptPaths(txn))
      setKeptReceipts(receiptPaths(txn))
      setInterestDistributed(txn.interest_distributed === true)
      setFormStep(1)

      const isInvestmentEntryType = txn.classification === "Investment" || txn.classification === "Investment Return"
      if (isInvestmentEntryType && txn.investment_id) {
        const { data: existingAllocation } = await supabase
          .from("investment_allocations")
          .select("id")
          .eq("investment_id", txn.investment_id)
          .limit(1)
          .maybeSingle()

        setInvestmentAlreadyDistributed(!!existingAllocation)
      }

      if (isLoanReleaseType && loanRecord) {
        setLoanId(loanRecord.loan_id)
        setAmount(String(Number(loanRecord.principal)))
        setInterestType(loanRecord.interest_type === "amount" ? "amount" : "rate")
        setInterestRate(String(Number(loanRecord.interest_rate ?? 0)))
        setInterestAmount(loanRecord.interest_amount != null ? String(Number(loanRecord.interest_amount)) : "")
        setTermMonths(loanRecord.term_months != null ? String(loanRecord.term_months) : "")
        setRepaymentFrequency(loanRecord.repayment_frequency ?? "monthly")
        setDueDay(loanRecord.due_day != null ? String(loanRecord.due_day) : "")
      } else {
        setLoanId(txn.loan_id ?? "")
        setAmount(String(Math.abs(Number(txn.amount))))
      }

      if (txn.classification === "Loan Repayment") {
        // Borrower-only loans (e.g. Joy, who isn't a fund member) link via
        // borrowers.borrower_id rather than member_id -- mirrors the OR
        // filter borrower/repay uses so a borrower editing their own
        // pending repayment still sees their loan in the picker.
        const { data: borrowerRow } = await supabase
          .from("borrowers")
          .select("borrower_id")
          .eq("member_id", member.member_id)
          .maybeSingle()

        const loanFilter = borrowerRow?.borrower_id
          ? `member_id.eq.${member.member_id},borrower_id.eq.${borrowerRow.borrower_id}`
          : `member_id.eq.${member.member_id}`

        const { data: loans } = await supabase
          .from("loans")
          .select("loan_id, principal, interest_type, interest_rate, interest_amount, term_months, status, start_date")
          .or(loanFilter)
          .in("status", ["active", "requested"])
          .order("start_date", { ascending: false })

        const loansData = loans ?? []
        setMyLoans(loansData)

        // "X left to pay" needs each loan's total repaid so far --
        // excludes this transaction's own row so editing its amount (or
        // reassigning it to a different loan) doesn't count this entry
        // against itself.
        const loanIds = loansData.map((l) => l.loan_id)
        if (loanIds.length > 0) {
          const { data: repayments } = await supabase
            .from("transactions")
            .select("loan_id, amount")
            .in("loan_id", loanIds)
            .eq("classification", "Loan Repayment")
            .in("status", ["pending", "approved"])
            .neq("transaction_id", transactionId)

          const totals: Record<string, number> = {}
          ;(repayments ?? []).forEach((r) => {
            totals[r.loan_id] = (totals[r.loan_id] ?? 0) + Number(r.amount)
          })
          setLoanRepaidTotals(totals)
        }
      }

      setDataLoading(false)
    }

    load()
    // onClose is intentionally excluded -- it's a fresh closure on every
    // render of whatever mounted this sheet, and including it would re-run
    // this whole load every time that parent re-renders for any reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, member, transactionId])

  const isBankTransfer = classification === "Internal Transfer"
  const isLoanPayment = classification === "Loan Repayment"
  const isLoanRelease = classification === "Loan Release"
  const isInvestmentEntry = classification === "Investment" || classification === "Investment Return"
  const needsBank =
    classification === "Member Contribution" ||
    classification === "Loan Repayment" ||
    classification === "Bank Interest" ||
    classification === "Expense" ||
    isBankTransfer ||
    isInvestmentEntry
  // Every editable type requires a receipt except Member Withdrawal and
  // Loan Release, where nothing has actually moved yet -- admin-entered
  // types like Bank Interest/Expense/Internal Transfer are included since
  // those still need a bank statement/receipt attached same as anything
  // else that moved real money.
  const needsReceipt = classification !== "Member Withdrawal" && !isLoanRelease

  // Same filter the dropdown this replaced already used: active loans, plus
  // whichever one this row already points to even if it's since closed --
  // an existing edit shouldn't lose its own loan from the picker.
  const activeLoansForPicker = myLoans.filter((l) => l.status === "active" || l.loan_id === loanId)
  const selectedLoan = myLoans.find((l) => l.loan_id === loanId) ?? null
  // Investments list includes closed ones (see the comment where it's
  // fetched) -- filtered the same way here: open, plus whichever one this
  // row already points to.
  const investmentsForPicker = investmentsList.filter((inv) => inv.status === "open" || inv.investment_id === investmentId)
  const selectedInvestmentRow = investmentsList.find((inv) => inv.investment_id === investmentId) ?? null

  const previewTotalRepayable =
    isLoanRelease &&
    isValidPositiveNumber(amount) &&
    (interestType === "rate"
      ? isValidPositiveNumber(interestRate, true)
      : isValidPositiveNumber(interestAmount, true))
      ? totalRepayable(Number(amount), interestType, Number(interestRate || 0), Number(interestAmount || 0))
      : 0

  const previewPerInstallment =
    previewTotalRepayable && isValidPositiveNumber(termMonths) && repaymentFrequency === "monthly"
      ? previewTotalRepayable / Number(termMonths)
      : previewTotalRepayable

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // Gate for Loan Release's Details step "Continue" -- the same checks
  // handleSave itself makes for this type, just run earlier so the Review
  // step never shows something that can't actually be saved.
  function detailsStepError(): string {
    if (!isValidPositiveNumber(amount)) return "Enter a valid amount greater than zero."

    if (isLoanRelease) {
      if (interestType === "rate" && !isValidPositiveNumber(interestRate, true)) {
        return "Enter a valid interest rate (0 or higher)."
      }
      if (interestType === "amount" && !isValidPositiveNumber(interestAmount, true)) {
        return "Enter a valid interest amount (0 or higher)."
      }
      if (!isValidPositiveNumber(termMonths)) return "Enter a valid term, in months greater than zero."
    }

    return ""
  }

  // Every required field still empty. Nothing is marked up front; once
  // Save/Continue is tapped with gaps, each shows its own message and
  // clears as soon as it's filled (same as NewTransactionSheet).
  const missing = {
    amount: !isValidPositiveNumber(amount),
    loan: !isLoanRelease && isLoanPayment && !loanId,
    investment: !isLoanRelease && isInvestmentEntry && !investmentId,
    bank: !isLoanRelease && needsBank && !bankId,
    toBank: !isLoanRelease && isBankTransfer && !toBankId,
    receipt: !isLoanRelease && needsReceipt && receipts.length === 0 && keptReceipts.length === 0,
    interest: isLoanRelease && !(interestType === "rate" ? interestRate : interestAmount),
    term: isLoanRelease && !termMonths
  }
  const anyMissing = Object.values(missing).some(Boolean)
  const err = (key: keyof typeof missing, text: string) => (showErrors && missing[key] ? text : undefined)

  function flagMissing() {
    setShowErrors(true)
    setMessage(FILL_MESSAGE)
    setTimeout(() => document.querySelector('[role="alert"]')?.scrollIntoView({ behavior: "smooth", block: "center" }), 0)
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

  async function handleSave() {
    setMessage("")
    if (anyMissing) {
      flagMissing()
      return
    }

    if (!isValidPositiveNumber(amount)) {
      setMessage("Enter a valid amount greater than zero.")
      return
    }

    if (isLoanRelease) {
      if (interestType === "rate" && !isValidPositiveNumber(interestRate, true)) {
        setMessage("Enter a valid interest rate (0 or higher).")
        return
      }

      if (interestType === "amount" && !isValidPositiveNumber(interestAmount, true)) {
        setMessage("Enter a valid interest amount (0 or higher).")
        return
      }

      if (!isValidPositiveNumber(termMonths)) {
        setMessage("Enter a valid term, in months greater than zero.")
        return
      }
    } else {
      if (needsBank && !bankId) {
        setMessage(isBankTransfer ? "Select a source bank." : "Select a bank.")
        return
      }

      if (isBankTransfer && !toBankId) {
        setMessage("Select a destination bank.")
        return
      }

      if (isBankTransfer && bankId === toBankId) {
        setMessage("Source and destination banks must be different.")
        return
      }

      if (needsReceipt && receipts.length === 0 && keptReceipts.length === 0) {
        setMessage("Attach a receipt.")
        return
      }

      if (isLoanPayment && !loanId) {
        setMessage("Select which loan you're paying.")
        return
      }

      if (isInvestmentEntry && !investmentId) {
        setMessage("Select which investment this is for.")
        return
      }
    }

    setSaving(true)

    // Loan Release's amount mirrors the linked loan's principal, and its
    // rate/term/repayment mode live on the loan row, not the transaction --
    // both need updating together to stay in sync. The `editable` check on
    // load only confirmed the loan was still "requested" at that moment --
    // re-checking it here too guards against a stale sheet: if someone else
    // approved this loan while it sat open, these writes would otherwise
    // silently desync the loan's real terms from what was actually
    // disbursed against.
    if (isLoanRelease) {
      const { data: loanRows, error: loanError } = await supabase
        .from("loans")
        .update({
          principal: Number(amount),
          interest_type: interestType,
          interest_rate: interestType === "rate" ? Number(interestRate) : 0,
          interest_amount: interestType === "amount" ? Number(interestAmount) : null,
          term_months: Number(termMonths),
          repayment_frequency: repaymentFrequency,
          due_day: repaymentFrequency === "monthly" && dueDay ? Number(dueDay) : null,
          notes: description
        })
        .eq("loan_id", loanId)
        .eq("status", "requested")
        .select("loan_id")

      if (loanError) {
        setMessage(loanError.message)
        setSaving(false)
        return
      }

      if (!loanRows || loanRows.length === 0) {
        setSaving(false)
        setMessage("This loan has already been approved or changed since you opened it, so it can't be edited here anymore.")
        return
      }

      const { data: txnRows, error } = await supabase
        .from("transactions")
        .update({ amount: -Number(amount), description })
        .eq("transaction_id", transactionId)
        .eq("status", "pending")
        .select("transaction_id")

      setSaving(false)

      if (error) {
        setMessage(error.message)
        return
      }

      if (!txnRows || txnRows.length === 0) {
        setMessage("This entry has changed since you opened it and can no longer be edited this way.")
        return
      }

      notifyTransactionsChanged()
      onClose()
      return
    }

    const { paths: uploadedReceipts, error: receiptUploadError } = await uploadReceipts(receipts, member?.member_id ?? "")
    if (receiptUploadError) {
      setMessage(receiptUploadError)
      setSaving(false)
      return
    }
    const nextReceipts = [...keptReceipts, ...uploadedReceipts]

    // Withdrawals, expenses, and Investment outflows are cash going out, so
    // the ledger stores them negative -- matches the sign convention
    // handleSubmit uses on NewTransactionSheet.
    const signedAmount =
      classification === "Member Withdrawal" || classification === "Expense" || classification === "Investment"
        ? -Number(amount)
        : Number(amount)

    // affects_cash mirrors the selected investment's own flag, same as
    // NewTransactionSheet -- v_cash_ledger reads the transaction's own
    // flag, not the investment's.
    const selectedInvestment = isInvestmentEntry ? investmentsList.find((inv) => inv.investment_id === investmentId) : null

    // The `editable` check on load only confirmed this row's status at that
    // moment -- re-checking it here too guards against a stale sheet: a
    // member-owned row must still be pending or rejected (an admin approving
    // it elsewhere shouldn't have this save silently overwrite that), and an
    // admin-entered row must still not be cancelled.
    const isMemberOwnedType = MEMBER_EDITABLE.includes(classification) || isMemberOwned

    let updateQuery = supabase
      .from("transactions")
      .update({
        amount: signedAmount,
        bank_account_id: needsBank ? bankId : null,
        to_bank_account_id: isBankTransfer ? toBankId : null,
        loan_id: isLoanPayment ? loanId : null,
        investment_id: isInvestmentEntry ? investmentId : null,
        description,
        receipt_urls: nextReceipts,
        ...(isInvestmentEntry ? { affects_cash: selectedInvestment?.affects_cash ? 1 : 0 } : {}),
        // Saving a rejected row resubmits it -- flip it back to pending and
        // clear the stale reason so it re-enters the review queue clean.
        // A no-op write when it was already pending.
        ...(isMemberOwnedType ? { status: "pending", rejection_reason: null } : {})
      })
      .eq("transaction_id", transactionId)

    updateQuery = isMemberOwnedType
      ? updateQuery.in("status", ["pending", "rejected"])
      : updateQuery.neq("status", "cancelled")

    const { data: txnRows, error } = await updateQuery.select("transaction_id")

    setSaving(false)

    if (error) {
      // The new receipts already uploaded successfully above -- if the
      // update they belong to failed, clean them up rather than leaving
      // them orphaned in the bucket. The original files are untouched
      // since the update never committed.
      await removeReceipts(uploadedReceipts)
      setMessage(error.message)
      return
    }

    if (!txnRows || txnRows.length === 0) {
      await removeReceipts(uploadedReceipts)
      setMessage("This entry has changed since you opened it and can no longer be edited this way.")
      return
    }

    // The update above already committed the new receipt list, so any
    // original file the editor removed is now unreferenced -- clean it up
    // rather than leaving it orphaned in the bucket. Best-effort: a failure
    // here doesn't affect the save that already succeeded.
    await removeReceipts(originalReceipts.filter((p) => !nextReceipts.includes(p)))

    notifyTransactionsChanged()
    onClose()
  }

  async function handleCancelEntry() {
    const confirmMsg = isLoanRelease
      ? "Cancel this loan request? The pending disbursement and the loan record will both be removed -- this can't be undone from the app."
      : "Cancel this entry? It'll be marked cancelled and removed from the transaction list -- this can't be undone from the app."

    if (!confirm(confirmMsg)) {
      return
    }

    setCancelling(true)

    // Loan Release: the loan row is being deleted, so the reference to it
    // has to go first -- otherwise the foreign key stops the delete.
    const updates: Record<string, any> = { status: "cancelled" }
    if (isLoanRelease) updates.loan_id = null

    // The `editable` check on load only confirmed this row's status at that
    // moment -- re-checking it here too guards against a stale sheet: a
    // member-owned or Loan Release row must still be pending, and an
    // admin-entered row must still not already be cancelled, or this would
    // silently reverse something that's since moved on (e.g. an admin
    // approving it elsewhere while this sheet sat open).
    let cancelQuery = supabase.from("transactions").update(updates).eq("transaction_id", transactionId)
    cancelQuery =
      MEMBER_EDITABLE.includes(classification) || isMemberOwned || isLoanRelease
        ? cancelQuery.eq("status", "pending")
        : cancelQuery.neq("status", "cancelled")

    const { data: txnRows, error } = await cancelQuery.select("transaction_id")

    if (!error && (!txnRows || txnRows.length === 0)) {
      setCancelling(false)
      setMessage("This entry has changed since you opened it and can no longer be cancelled this way.")
      return
    }

    if (!error && isLoanRelease && loanId) {
      // Guarded the same way -- the loan should always still be "requested"
      // here since approval flips loan and transaction status together, but
      // this is the difference between a clean message and a confusing
      // foreign-key error if that's somehow no longer true.
      const { data: loanRows, error: loanError } = await supabase
        .from("loans")
        .delete()
        .eq("loan_id", loanId)
        .eq("status", "requested")
        .select("loan_id")

      if (loanError) {
        setCancelling(false)
        setMessage(loanError.message)
        return
      }

      if (!loanRows || loanRows.length === 0) {
        setCancelling(false)
        setMessage("The loan record couldn't be removed -- it may have already been approved. Check its status before retrying.")
        return
      }
    }

    setCancelling(false)

    if (error) {
      setMessage(error.message)
      return
    }

    notifyTransactionsChanged()
    onClose()
  }

  if (checkingAccess) {
    return (
      <Sheet title="Edit Entry" onClose={onClose}>
        <SkeletonPanel />
      </Sheet>
    )
  }

  if (notFound) {
    return (
      <Sheet title="Edit Entry" onClose={onClose}>
        <p className="text-sm text-ink-soft">
          This entry isn&apos;t editable -- it may have already been reviewed, cancelled, or belongs to someone else.
        </p>
      </Sheet>
    )
  }

  return (
    <>
    <Sheet
      title="Edit Entry"
      onClose={onClose}
      footer={
        <>
          {message && !(message === FILL_MESSAGE && !anyMissing) && <p className="text-sm text-rust mb-3">{message}</p>}
          <div className="flex items-center gap-3">
            {/* Same guard as before -- a rejected row is already out of the
                review queue, so there's nothing left to cancel; Save either
                resubmits it or the member just closes the sheet. */}
            {status !== "rejected" && (
              <button
                type="button"
                onClick={handleCancelEntry}
                disabled={cancelling || saving}
                className="shrink-0 border border-rust text-rust px-5 py-3.5 rounded-full text-base font-semibold disabled:opacity-50"
              >
                {cancelling ? "Cancelling…" : "Cancel"}
              </button>
            )}
            {isLoanRelease && formStep === 2 && (
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
              onClick={isLoanRelease && formStep === 1 ? handleContinueToReview : handleSave}
              disabled={saving || cancelling}
            >
              {saving
                ? "Saving…"
                : isLoanRelease && formStep === 1
                ? "Continue"
                : status === "rejected"
                ? "Resubmit"
                : "Save Changes"}
            </button>
          </div>
        </>
      }
    >
      <AmountHero value={amount} onChange={setAmount} label={isLoanRelease ? "Amount to borrow" : "Amount"} error={err("amount", "Enter an amount")} />

      {/* Same card-of-FieldRows shape as the Details/Loan Terms cards
          below, matching NewTransactionSheet's typeField -- just
          non-interactive (no ▾, no onClick) since type can't be changed
          here, with the status badge and lock standing in for it. */}
      <div className="card overflow-hidden mt-4">
        <FieldRow icon={<FlowBadge {...(FLOW[classification] ?? { arrow: "•", tone: "in" })} small />}>
          <span className="flex-1 min-w-0 text-sm">
            <span className="text-ink-soft">Type: </span>
            <span className="font-semibold text-ink">{TYPE_LABEL[classification]}</span>
          </span>
          <span className="shrink-0 flex items-center gap-2">
            <span
              className={`text-[10px] font-bold uppercase tracking-wide border rounded-full px-2 py-0.5 font-mono ${
                STATUS_TONE[status] ?? "text-ink-soft border-hairline"
              }`}
            >
              {status}
            </span>
            <span className="text-xs text-ink-soft" title="Type can't be changed">
              🔒
            </span>
          </span>
        </FieldRow>
      </div>

      {status === "rejected" && (
        <p className="text-[11px] text-rust bg-rust/10 border border-rust rounded-md px-3 py-2 mt-4">
          <span className="font-bold uppercase tracking-wide font-mono">Rejected</span>
          {/* The rest of the sentence is built as one string inside the
              expression, not as adjacent JSX text -- JSX collapses a
              literal space sitting right after a {expression} on a line
              break, which silently ate the gap before "Fix" here. */}
          {rejectionReason
            ? `: ${/[.!?]$/.test(rejectionReason.trim()) ? rejectionReason.trim() : `${rejectionReason.trim()}.`} Fix what's wrong and save to send it back for review.`
            : " -- no reason was given. Fix what's wrong and save to send it back for review."}
        </p>
      )}

      {classification === "Bank Interest" && interestDistributed && (
        <p className="text-[11px] text-gold bg-gold/10 border border-gold rounded-md px-3 py-2 mt-4">
          This interest has already been split across members. Changing the amount or cancelling this entry
          won&apos;t update what members were already credited in bank_interest_allocations.
        </p>
      )}

      {isInvestmentEntry && investmentAlreadyDistributed && (
        <p className="text-[11px] text-gold bg-gold/10 border border-gold rounded-md px-3 py-2 mt-4">
          This investment has already had a gain/loss distribution run against it. Changing this entry&apos;s
          amount or cancelling it won&apos;t update what members were already credited from Distribute Gain/Loss.
        </p>
      )}

      <div className="space-y-4 mt-4">
        {!isLoanRelease && (
          <>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">Details</p>
              <div className="card divide-y divide-hairline overflow-hidden">
                {isLoanPayment && (
                  // Always renders the tappable row regardless of whether
                  // there's anything to pick -- LoanPickerSheet already
                  // shows its own graceful "No active loans" empty state,
                  // so a second, redder version of that same message here
                  // was redundant.
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
                        <span className="text-ink-soft">Select a loan</span>
                      )}
                      {err("loan", "x") && <FieldError message="Choose which loan" className="mt-1" />}
                    </span>
                    <span className="text-ink-soft text-xs shrink-0">▾</span>
                  </button>
                )}

                {isInvestmentEntry && (
                  // Same tappable-row pattern as the loan field above --
                  // both are just "pick one of a short list," and
                  // InvestmentPickerSheet already has its own graceful
                  // "No open investments" empty state.
                  <button
                    type="button"
                    onClick={() => setShowInvestmentPicker(true)}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 text-left ${err("investment", "x") ? invalidRowClass : ""}`}
                  >
                    <InvestmentRowIcon />
                    <span className="flex-1 min-w-0 text-sm">
                      {selectedInvestmentRow ? (
                        <span className="text-ink">{selectedInvestmentRow.name}</span>
                      ) : (
                        <span className="text-ink-soft">Select an investment</span>
                      )}
                      {err("investment", "x") && <FieldError message="Choose which investment" className="mt-1" />}
                    </span>
                    <span className="text-ink-soft text-xs shrink-0">▾</span>
                  </button>
                )}

                {needsBank && (
                  <FieldRow icon={<BankIcon />} error={err("bank", isBankTransfer ? "Choose the bank it's leaving" : "Choose a bank")}>
                    <select className={rowSelectClass} value={bankId} onChange={(e) => setBankId(e.target.value)}>
                      <option value="">{isBankTransfer ? "From which bank" : "Select a bank"}</option>
                      {banks.map((bank) => (
                        <option key={bank.id} value={bank.id}>
                          {bank.account_name || bank.bank_name}
                        </option>
                      ))}
                    </select>
                  </FieldRow>
                )}

                {isBankTransfer && (
                  <FieldRow icon={<BankIcon />} error={err("toBank", "Choose the bank it's going to")}>
                    <select className={rowSelectClass} value={toBankId} onChange={(e) => setToBankId(e.target.value)}>
                      <option value="">To which bank</option>
                      {banks.map((bank) => (
                        <option key={bank.id} value={bank.id}>
                          {bank.account_name || bank.bank_name}
                        </option>
                      ))}
                    </select>
                  </FieldRow>
                )}

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

              {isLoanPayment && selectedLoan && (
                <p className="px-1 pt-2 text-sm text-ink-soft">
                  ₱{fmt(Math.max(0, totalRepayable(Number(selectedLoan.principal), selectedLoan.interest_type, Number(selectedLoan.interest_rate || 0), Number(selectedLoan.interest_amount || 0)) - (loanRepaidTotals[selectedLoan.loan_id] || 0)))}{" "}
                  left to pay
                </p>
              )}
            </div>

            {needsReceipt && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">Receipts</p>
                <ReceiptsField
                  files={receipts}
                  onAddFiles={(added) => setReceipts((prev) => [...prev, ...added])}
                  onRemoveFile={(i) => setReceipts((prev) => prev.filter((_, j) => j !== i))}
                  existingPaths={keptReceipts}
                  onRemoveExisting={(path) => setKeptReceipts((prev) => prev.filter((p) => p !== path))}
                  error={err("receipt", "Attach a receipt")}
                />
              </div>
            )}
          </>
        )}

        {isLoanRelease && (
          <>
            <StepTrack step={formStep} labels={["Details", "Review"]} />

            {formStep === 1 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">Loan Terms</p>
                <div className="card divide-y divide-hairline overflow-hidden">
                  {/* Toggle + value share one row instead of stacking (toggle, then a
                      second full-width input below it) -- matches NewTransactionSheet's
                      Loan Terms card, the two only ever needing to look the same. */}
                  <FieldRow icon={<InterestIcon />} error={err("interest", interestType === "rate" ? "Choose an interest rate" : "Enter the interest amount")}>
                    {interestType === "rate" && !interestRateCustom ? (
                      // Picker is the default way in, matching
                      // NewTransactionSheet -- "Custom..." in the sheet
                      // switches to the raw input for anything outside
                      // the preset list.
                      <button
                        type="button"
                        onClick={() => setShowInterestRatePicker(true)}
                        className="flex-1 min-w-0 text-left text-sm"
                      >
                        {interestRate ? (
                          <span className="text-ink">{interestRate}%</span>
                        ) : (
                          <span className="text-ink-soft">Interest rate, e.g. 5</span>
                        )}
                      </button>
                    ) : (
                      <input
                        className={rowInputClass}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        placeholder={interestType === "rate" ? "Interest rate, e.g. 5" : "Interest amount, e.g. 5000"}
                        value={interestType === "rate" ? interestRate : interestAmount}
                        onChange={(e) =>
                          interestType === "rate" ? setInterestRate(e.target.value) : setInterestAmount(e.target.value)
                        }
                        autoFocus={interestType === "rate" && interestRateCustom}
                      />
                    )}
                    <div className="flex border border-hairline rounded-sm overflow-hidden shrink-0">
                      <button
                        type="button"
                        onClick={() => setInterestType("rate")}
                        aria-label="Interest as a rate"
                        className={`w-8 py-1.5 text-xs font-semibold transition-colors ${
                          interestType === "rate" ? "bg-ink text-paper" : "text-ink-soft"
                        }`}
                      >
                        %
                      </button>
                      <button
                        type="button"
                        onClick={() => setInterestType("amount")}
                        aria-label="Interest as a fixed amount"
                        className={`w-8 py-1.5 text-xs font-semibold border-l border-hairline transition-colors ${
                          interestType === "amount" ? "bg-ink text-paper" : "text-ink-soft"
                        }`}
                      >
                        ₱
                      </button>
                    </div>
                    {interestType === "rate" && (
                      <button
                        type="button"
                        onClick={() => setShowInterestRatePicker(true)}
                        aria-label="Choose a common interest rate"
                        className="text-ink-soft text-xs shrink-0 px-1"
                      >
                        ▾
                      </button>
                    )}
                  </FieldRow>

                  <FieldRow icon={<ClockIcon />} error={err("term", "Choose a term")}>
                    {!termCustom ? (
                      <button
                        type="button"
                        onClick={() => setShowTermPicker(true)}
                        className="flex-1 min-w-0 text-left text-sm"
                      >
                        {termMonths ? (
                          <span className="text-ink">
                            {termMonths} {termMonths === "1" ? "month" : "months"}
                          </span>
                        ) : (
                          <span className="text-ink-soft">Term, e.g. 6</span>
                        )}
                      </button>
                    ) : (
                      <>
                        <input
                          className={rowInputClass}
                          type="number"
                          inputMode="numeric"
                          min="1"
                          step="1"
                          placeholder="Term, e.g. 6"
                          value={termMonths}
                          onChange={(e) => setTermMonths(e.target.value)}
                          autoFocus
                        />
                        <span className="text-xs text-ink-soft shrink-0">months</span>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowTermPicker(true)}
                      aria-label="Choose a common payment term"
                      className="text-ink-soft text-xs shrink-0 px-1"
                    >
                      ▾
                    </button>
                  </FieldRow>

                  <FieldRow icon={<RepeatIcon />}>
                    <div className="flex-1 flex border border-hairline rounded-sm overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setRepaymentFrequency("monthly")}
                        className={`flex-1 text-xs font-semibold py-2 transition-colors ${
                          repaymentFrequency === "monthly" ? "bg-ink text-paper" : "text-ink-soft"
                        }`}
                      >
                        Monthly
                      </button>
                      <button
                        type="button"
                        onClick={() => setRepaymentFrequency("lump_sum")}
                        className={`flex-1 text-xs font-semibold py-2 border-l border-hairline transition-colors ${
                          repaymentFrequency === "lump_sum" ? "bg-ink text-paper" : "text-ink-soft"
                        }`}
                      >
                        Lump sum
                      </button>
                    </div>
                  </FieldRow>

                  {repaymentFrequency === "monthly" && (
                    <FieldRow icon={<CalendarIcon />}>
                      <button
                        type="button"
                        onClick={() => setShowDueDayPicker(true)}
                        className="flex-1 min-w-0 text-left text-sm"
                      >
                        {dueDay ? (
                          <span className="text-ink">Due on the {ordinalDay(Number(dueDay))} of each month</span>
                        ) : (
                          <span className="text-ink-soft">Due day each month, e.g. 15th</span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowDueDayPicker(true)}
                        aria-label="Choose the monthly due day"
                        className="text-ink-soft text-xs shrink-0 px-1"
                      >
                        ▾
                      </button>
                    </FieldRow>
                  )}

                  {previewTotalRepayable > 0 && isValidPositiveNumber(termMonths) && (
                    <>
                      <div className="flex items-center justify-between px-4 py-3 bg-gold/10">
                        <span className="text-sm font-semibold text-ink">Total repayable</span>
                        <span className="text-sm font-bold font-mono [font-variant-numeric:tabular-nums] text-gold">
                          ₱{fmt(previewTotalRepayable)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between px-4 py-3 bg-gold/10">
                        <span className="text-sm text-ink-soft">
                          {repaymentFrequency === "monthly" ? `Per month × ${termMonths}` : `Due at ${termMonths} months`}
                        </span>
                        <span className="text-sm font-semibold font-mono [font-variant-numeric:tabular-nums] text-ink">
                          ₱{fmt(previewPerInstallment)}
                        </span>
                      </div>
                    </>
                  )}

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
              </div>
            )}

            {formStep === 2 && (
              <FieldGroup>
                <ReviewRow label="Type" value={TYPE_LABEL[classification] ?? ""} />
                <ReviewRow
                  label="Amount to borrow"
                  value={`₱${fmt(isValidPositiveNumber(amount) ? Number(amount) : 0)}`}
                />
                <ReviewRow
                  label="Interest"
                  value={
                    interestType === "rate"
                      ? `${interestRate || 0}%`
                      : `₱${fmt(Number(interestAmount) || 0)} fixed`
                  }
                />
                <ReviewRow label="Term" value={`${termMonths || 0} months`} />
                <ReviewRow
                  label="Repayment"
                  value={repaymentFrequency === "monthly" ? "Monthly installments" : "Lump sum at end of term"}
                />
                {repaymentFrequency === "monthly" && dueDay && (
                  <ReviewRow label="Due date" value={`${ordinalDay(Number(dueDay))} of each month`} />
                )}
                {previewTotalRepayable > 0 && (
                  <ReviewRow label="Est. total repayable" value={`₱${fmt(previewTotalRepayable)}`} />
                )}
                {description && <ReviewRow label="Description" value={description} />}
              </FieldGroup>
            )}
          </>
        )}
      </div>
    </Sheet>

    {showLoanPicker && (
      <LoanPickerSheet
        loans={activeLoansForPicker}
        repaidTotals={loanRepaidTotals}
        onClose={() => setShowLoanPicker(false)}
        onSelect={(loan) => {
          setLoanId(loan.loan_id)
          setShowLoanPicker(false)
        }}
      />
    )}

    {showInvestmentPicker && (
      <InvestmentPickerSheet
        investments={investmentsForPicker}
        onClose={() => setShowInvestmentPicker(false)}
        onSelect={(investment) => {
          setInvestmentId(investment.investment_id)
          setShowInvestmentPicker(false)
        }}
      />
    )}

    {showInterestRatePicker && (
      <InterestRatePickerSheet
        value={interestRate}
        onClose={() => setShowInterestRatePicker(false)}
        onSelect={(rate) => {
          setInterestRate(String(rate))
          setInterestRateCustom(false)
          setShowInterestRatePicker(false)
        }}
        onCustom={() => {
          setInterestRateCustom(true)
          setShowInterestRatePicker(false)
        }}
      />
    )}

    {showDueDayPicker && (
      <DueDayPickerSheet
        value={dueDay}
        onClose={() => setShowDueDayPicker(false)}
        onSelect={(day) => {
          setDueDay(String(day))
          setShowDueDayPicker(false)
        }}
      />
    )}

    {showTermPicker && (
      <TermPickerSheet
        value={termMonths}
        onClose={() => setShowTermPicker(false)}
        onSelect={(months) => {
          setTermMonths(String(months))
          setTermCustom(false)
          setShowTermPicker(false)
        }}
        onCustom={() => {
          setTermCustom(true)
          setShowTermPicker(false)
        }}
      />
    )}
    </>
  )
}
