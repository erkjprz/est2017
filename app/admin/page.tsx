"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import ReceiptModal from "@/app/components/ReceiptModal"
import { useAuth } from "@/app/auth-context"
import { SkeletonCardList } from "@/app/components/Skeleton"
import { SearchFixSheet } from "@/app/components/admin/SearchFixSheet"
import { Sheet } from "@/app/components/Sheet"
import {
  FlowBadge,
  AmountHero,
  FieldRow,
  BankIcon,
  PersonIcon,
  InterestIcon,
  ClockIcon,
  FieldError,
  invalidRowClass,
  rowSelectClass,
  rowInputClass
} from "@/app/components/TransactionFormUI"
import { InterestRatePickerSheet } from "@/app/components/InterestRatePickerSheet"
import { TermPickerSheet } from "@/app/components/TermPickerSheet"
import { ReceiptThumbs } from "@/app/components/admin/ReceiptThumb"
import { receiptPaths, removeReceipts, uploadReceipts } from "@/lib/receiptUrl"
import { approveLoanRelease } from "@/lib/approveLoan"
import { approveBorrowerMember } from "@/lib/approveBorrower"
import { dateOnly } from "@/lib/currentValue"
import { TRANSACTION_TYPE_LABELS as typeLabels } from "@/lib/transactionLabels"
import { readCache, writeCache } from "@/lib/cache"
import {
  fetchBankBalances,
  groupImpacts,
  rememberApproved,
  txnImpact,
  type ImpactTxn,
  type TxnImpact
} from "@/lib/bankImpact"
import { BankImpactPreview } from "@/app/components/BankImpact"
import { Toast } from "@/app/components/Toast"
import { MessagesButton } from "@/app/components/admin/MessagesButton"
import { fetchWithdrawable, type Withdrawable } from "@/lib/withdrawable"

// Same in/out vocabulary as the transaction edit page's FLOW map -- money
// coming in (Contribution, Loan Repayment) has nothing left for an admin
// to decide, money going out (Withdrawal, Loan Release) always needs a
// disbursing bank picked, which is exactly the bulk/review split below.
const FLOW: Record<string, { arrow: string; tone: "in" | "out" | "neutral" }> = {
  "Member Contribution": { arrow: "↑", tone: "in" },
  "Member Withdrawal": { arrow: "↓", tone: "out" },
  "Loan Repayment": { arrow: "↑", tone: "in" },
  "Loan Release": { arrow: "↓", tone: "out" },
  "Investment Return": { arrow: "↑", tone: "in" }
}

// Contribution and Loan Repayment are both money coming in with nothing
// left for an admin to decide -- no bank to pick, no loan to activate --
// so they're safe to wave through in a batch. Withdrawal and Loan Release
// are money going out and always need an admin to choose which fund bank
// it's paid from (Loan Release also activates the loan), so they stay in
// the one-at-a-time review list. Shared between the bulk/review split
// below and approveBulkSelected's own query filter, so a tampered
// selectedBulkIds can't blanket-approve either of those two.
const BULK_CLASSIFICATIONS = new Set(["Member Contribution", "Loan Repayment"])

type Filter = "all" | "txn" | "signup"

// Same global admin approvals queue for any admin viewing it -- no
// per-user scoping needed, so a single fixed cache key covers everyone.
// loadError is deliberately left out: it should always start empty rather
// than replaying a stale error from a previous visit.
const ADMIN_QUEUE_CACHE_KEY = "admin:queue"

type AdminQueueSnapshot = {
  pendingMembers: any[]
  unclaimedMembers: any[]
  banks: any[]
  pendingTransactions: any[]
  borrowerMembers: any[]
}

type ExportRow = {
  txn_date: string | null
  classification: string
  status: string
  amount: number
  bank: string | null
  description: string | null
  members: { name: string } | null
  submitted_by_member: { name: string } | null
  loans: { name: string } | null
  investments: { name: string } | null
  from_bank_account: { bank_name: string; account_name: string | null } | null
  to_bank_account: { bank_name: string; account_name: string | null } | null
  created_at: string
}

// Entries a member sent in again after a rejection, or the same amount
// twice within this window, get flagged on their queue card.
const DUPLICATE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000

type QueueFlag = { label: string; tone: "warn" | "info" }

// The fields flagsFor/contextFor read off a pending transaction row.
type QueueTxn = {
  transaction_id: string
  member_id: string | null
  classification: string
  amount: number
  loan_id: string | null
  receipt_url: string | null
  receipt_urls?: string[] | null
  created_at: string
  resubmitted_at?: string | null
  previous_amount?: number | null
}

type RecentEntry = Pick<QueueTxn, "transaction_id" | "member_id" | "classification" | "amount" | "created_at"> & { status: string }

type LoanToClose = { loan_id: string; loan: string; total_repayable: number; last_repayment_date: string | null }

function timeAgo(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// "Oct 9 · 2h ago" -- the transaction's own date plus how long it's been
// waiting, so several similar pending items can be told apart at a glance.
function queuedLabel(t: { txn_date?: string | null; created_at: string; resubmitted_at?: string | null }): string {
  const date = t.txn_date
    ? new Date(`${t.txn_date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null
  // A resubmitted entry's age is how long it's been back in the queue
  // (what changed shows on its Resubmitted flag).
  const waiting = t.resubmitted_at ? `resent ${timeAgo(t.resubmitted_at)}` : timeAgo(t.created_at)
  return [date, waiting].filter(Boolean).join(" · ")
}

export default function AdminPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()
  const cached = readCache<AdminQueueSnapshot>(ADMIN_QUEUE_CACHE_KEY)

  // Paints instantly from the last time the approvals queue loaded, before
  // the browser ever shows a frame -- loadData() below still runs right
  // after and replaces it with a fresh fetch, so a stale queue never
  // lingers past that first moment.
  const [dataLoading, setDataLoading] = useState(!cached)
  // The cached queue paints first, but ?signup=/?review= links must wait for
  // the fresh fetch -- a just-submitted item isn't in the cache yet.
  const [freshLoaded, setFreshLoaded] = useState(false)
  const checkingAccess = authLoading || dataLoading

  // Replaces the old two-tier tab system -- one flat queue, grouped by
  // what each item actually is rather than switched between screens; this
  // just narrows which groups show. Support has no queue of its own
  // (see showSearchFix below), so it isn't one of these.
  const [filter, setFilter] = useState<Filter>("all")
  const [showSearchFix, setShowSearchFix] = useState(false)

  // Each row across every group below is a compact summary that opens its
  // full form in a sheet instead of expanding in place -- one row's form
  // used to push every row after it down the page and fight the sheet
  // above (Search & Fix) for space when both happened to be open at once.
  const [reviewingTxnId, setReviewingTxnId] = useState<string | null>(null)
  // Approve stays tappable in the review sheet; tapping it with the bank or
  // proof still missing highlights what's needed (this holds which item).
  const [approveTriedId, setApproveTriedId] = useState<string | null>(null)
  // Loan Release terms in the review sheet use the same pickers as a loan
  // request; "custom" swaps a row to a typed input, same as LoanTermsCard.
  const [termPicker, setTermPicker] = useState<"rate" | "term" | null>(null)
  const [customRate, setCustomRate] = useState(false)
  const [customTerm, setCustomTerm] = useState(false)
  const [reviewingSignupId, setReviewingSignupId] = useState<string | null>(null)
  const [reviewingBorrowerId, setReviewingBorrowerId] = useState<string | null>(null)

  const [pendingMembers, setPendingMembers] = useState<any[]>(cached?.pendingMembers ?? [])
  // Pre-app member records nobody has claimed yet (no email) -- a signup
  // from one of those people gets linked to their record instead of
  // starting fresh. Empty once they've all been claimed, which hides the
  // option entirely.
  const [unclaimedMembers, setUnclaimedMembers] = useState<any[]>(cached?.unclaimedMembers ?? [])
  const [memberLinkChoice, setMemberLinkChoice] = useState<Record<string, string>>({})
  const [memberBusyId, setMemberBusyId] = useState<string | null>(null)

  const [pendingTransactions, setPendingTransactions] = useState<any[]>(cached?.pendingTransactions ?? [])
  const [banks, setBanks] = useState<any[]>(cached?.banks ?? [])
  const [withdrawalBankSelections, setWithdrawalBankSelections] = useState<Record<string, string>>({})
  const [loanReleaseBankSelections, setLoanReleaseBankSelections] = useState<Record<string, string>>({})
  const [approvalReceipts, setApprovalReceipts] = useState<Record<string, File[]>>({})
  const [uploadingReceiptId, setUploadingReceiptId] = useState<string | null>(null)
  const [selectedBulkIds, setSelectedBulkIds] = useState<Set<string>>(new Set())
  const [bulkApproving, setBulkApproving] = useState(false)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState("")
  const [editAmounts, setEditAmounts] = useState<Record<string, string>>({})
  const [editInterestRate, setEditInterestRate] = useState<Record<string, string>>({})
  const [editInterestAmount, setEditInterestAmount] = useState<Record<string, string>>({})
  const [editTermMonths, setEditTermMonths] = useState<Record<string, string>>({})
  const [savingEditId, setSavingEditId] = useState<string | null>(null)

  const [borrowerMembers, setBorrowerMembers] = useState<any[]>(cached?.borrowerMembers ?? [])
  const [borrowerBusyId, setBorrowerBusyId] = useState<string | null>(null)

  const [loadError, setLoadError] = useState("")
  const [actionError, setActionError] = useState("")
  const [openReceipt, setOpenReceipt] = useState<{ paths: string[]; index: number } | null>(null)

  // Current bank balances, for the new-balance column on each approval
  // preview -- the preview already shows where every bank lands, so the
  // confirmation afterwards is just a short toast.
  const [bankBalances, setBankBalances] = useState<Record<string, number> | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // Context loaded alongside the queue so each card can say what the
  // admin would otherwise have to look up: the member's available balance
  // (withdrawals), what's still owed (loan payments), recent look-alike
  // entries (possible duplicates), and fully repaid loans left open.
  const [memberWithdrawable, setMemberWithdrawable] = useState<Record<string, Withdrawable>>({})
  const [loanOutstanding, setLoanOutstanding] = useState<Record<string, number>>({})
  const [recentSimilar, setRecentSimilar] = useState<RecentEntry[]>([])
  const [loansToClose, setLoansToClose] = useState<LoanToClose[]>([])

  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState("")

  async function loadData() {
    // Only show the blocking loader on a true cold start -- if we already
    // rendered cached data, refresh quietly behind it instead of flashing
    // back to a spinner on every navigation or post-mutation reload.
    if (!readCache(ADMIN_QUEUE_CACHE_KEY)) setDataLoading(true)

    const [
      pendingMembersRes,
      unclaimedMembersRes,
      banksRes,
      pendingTxnsRes,
      borrowerMembersRes
    ] = await Promise.all([
      // role='borrower' pending signups are handled entirely by the
      // Borrower requests group -- excluded here so a pending borrower isn't
      // double-counted across both groups' totals.
      supabase
        .from("members")
        .select("*")
        .eq("status", "pending")
        .neq("role", "borrower")
        .order("created_at", { ascending: false }),
      supabase.rpc("list_unclaimed_members"),
      supabase.from("bank_accounts").select("id, bank_name, account_name").order("bank_name"),
      supabase
        .from("transactions")
        .select(
          `
          *,
          members!transactions_member_id_fkey ( name, email ),
          submitted_by_member:members!transactions_submitted_by_fkey ( name ),
          bank_accounts!transactions_bank_account_id_fkey ( bank_name, account_name ),
          loans!transactions_loan_id_fkey ( interest_type, interest_rate, interest_amount, term_months, payout_details, payout_qr_path ),
          investments!transactions_investment_id_fkey ( name )
        `
        )
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      supabase
        .from("members")
        .select("member_id, name, email, status, created_at")
        .eq("role", "borrower")
        .order("created_at", { ascending: false })
    ])

    // Separate from the Promise.all above so a failure here only loses the
    // balance preview, never the queue itself.
    fetchBankBalances()
      .then(setBankBalances)
      .catch(() => setBankBalances(null))

    // Same for the per-card context -- nice to have, never blocking.
    loadQueueContext(pendingTxnsRes.error ? [] : pendingTxnsRes.data ?? []).catch(() => {})

    setPendingMembers(pendingMembersRes.data ?? [])
    setUnclaimedMembers(unclaimedMembersRes.data ?? [])
    setBanks(banksRes.data ?? [])

    setLoadError(pendingTxnsRes.error?.message || "")
    setPendingTransactions(pendingTxnsRes.error ? [] : pendingTxnsRes.data ?? [])

    setBorrowerMembers(borrowerMembersRes.data ?? [])

    writeCache<AdminQueueSnapshot>(ADMIN_QUEUE_CACHE_KEY, {
      pendingMembers: pendingMembersRes.data ?? [],
      unclaimedMembers: unclaimedMembersRes.data ?? [],
      banks: banksRes.data ?? [],
      pendingTransactions: pendingTxnsRes.error ? [] : pendingTxnsRes.data ?? [],
      borrowerMembers: borrowerMembersRes.data ?? []
    })
  }

  async function loadQueueContext(pending: QueueTxn[]) {
    const withdrawalMembers = pending
      .filter((t) => t.classification === "Member Withdrawal" && t.member_id)
      .map((t) => t.member_id as string)
    const loanIds = Array.from(
      new Set(pending.filter((t) => t.classification === "Loan Repayment" && t.loan_id).map((t) => t.loan_id as string))
    )
    const memberIds = Array.from(new Set(pending.map((t) => t.member_id).filter((id): id is string => !!id)))
    const since = new Date(Date.now() - 2 * DUPLICATE_WINDOW_MS).toISOString()

    const [withdrawable, outstandingRes, similarRes, toCloseRes] = await Promise.all([
      fetchWithdrawable(withdrawalMembers).catch(() => ({} as Record<string, Withdrawable>)),
      loanIds.length
        ? supabase.from("v_loan_summary").select("loan_id, outstanding").in("loan_id", loanIds)
        : Promise.resolve({ data: [] as { loan_id: string; outstanding: number }[], error: null }),
      memberIds.length
        ? supabase
            .from("transactions")
            .select("transaction_id, member_id, classification, amount, status, created_at")
            .in("member_id", memberIds)
            .in("status", ["pending", "approved"])
            .gte("created_at", since)
        : Promise.resolve({ data: [] as RecentEntry[], error: null }),
      supabase.from("v_loan_summary").select("loan_id, loan, borrower, total_repayable, last_repayment_date").eq("status", "active").lte("outstanding", 0)
    ])

    setMemberWithdrawable(withdrawable)
    const outstanding: Record<string, number> = {}
    ;(outstandingRes.data ?? []).forEach((r) => (outstanding[r.loan_id] = Number(r.outstanding)))
    setLoanOutstanding(outstanding)
    setRecentSimilar(similarRes.data ?? [])
    setLoansToClose(toCloseRes.data ?? [])
  }

  // What the admin should notice before approving -- each one a short chip
  // on the queue card and a line in the review sheet.
  function flagsFor(t: QueueTxn): QueueFlag[] {
    const flags: QueueFlag[] = []
    const amount = Number(t.amount)
    const isIn = FLOW[t.classification]?.tone === "in"
    const isOut = FLOW[t.classification]?.tone === "out"

    if ((isIn && amount <= 0) || (isOut && amount >= 0)) flags.push({ label: "Wrong sign", tone: "warn" })
    if (BULK_CLASSIFICATIONS.has(t.classification) && receiptPaths(t).length === 0) flags.push({ label: "No receipt", tone: "warn" })

    if (t.classification === "Member Withdrawal" && t.member_id && memberWithdrawable[t.member_id]) {
      const w = memberWithdrawable[t.member_id]
      // Everything else this member has waiting to go out, not this one.
      const available = w.withdrawableNow - (w.pendingOut - Math.abs(amount))
      if (Math.abs(amount) > available + 0.004) flags.push({ label: "Over balance", tone: "warn" })
    }

    if (t.classification === "Loan Repayment" && t.loan_id && loanOutstanding[t.loan_id] !== undefined) {
      if (amount > loanOutstanding[t.loan_id] + 0.004) flags.push({ label: "More than owed", tone: "warn" })
    }

    const created = new Date(t.created_at).getTime()
    const lookAlike = recentSimilar.some(
      (o) =>
        o.transaction_id !== t.transaction_id &&
        o.member_id === t.member_id &&
        o.classification === t.classification &&
        Number(o.amount) === amount &&
        Math.abs(new Date(o.created_at).getTime() - created) <= DUPLICATE_WINDOW_MS
    )
    if (lookAlike) flags.push({ label: "Possible duplicate", tone: "warn" })

    if (t.resubmitted_at) {
      flags.push({
        label: t.previous_amount != null ? `Resubmitted · was ₱${fmt(Math.abs(Number(t.previous_amount)))}` : "Resubmitted",
        tone: "info"
      })
    }
    return flags
  }

  // One extra line of context under the card's type line.
  function contextFor(t: QueueTxn): string | null {
    if (t.classification === "Member Withdrawal" && t.member_id && memberWithdrawable[t.member_id]) {
      const w = memberWithdrawable[t.member_id]
      const available = Math.max(0, w.withdrawableNow - (w.pendingOut - Math.abs(Number(t.amount))))
      return `₱${fmt(available)} available to withdraw`
    }
    if (t.classification === "Loan Repayment" && t.loan_id && loanOutstanding[t.loan_id] !== undefined) {
      return `₱${fmt(loanOutstanding[t.loan_id])} left on loan`
    }
    return null
  }

  useEffect(() => {
    if (authLoading) return

    if (!member) {
      router.push("/login")
      return
    }

    if (member.role !== "admin") {
      router.push("/dashboard")
      return
    }

    async function checkAdminAccess() {
      await loadData()
      setDataLoading(false)
      setFreshLoaded(true)
    }

    checkAdminAccess()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loadData is recreated every render; this should only re-run when auth changes
  }, [authLoading, member, router])

  // ?signup= (the Members page's "Review signup") and ?review= (a pending
  // transaction's "Review in Admin queue") open that item's review sheet
  // once the queue has loaded, then drop the param in place.
  useEffect(() => {
    if (!freshLoaded) return
    const params = new URLSearchParams(window.location.search)
    const id = params.get("signup")
    const txnId = params.get("review")
    if (!id && !txnId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- opens the review sheet a ?signup= / ?review= link asked for, once the queue has loaded
    if (id && pendingMembers.some((m) => m.member_id === id)) setReviewingSignupId(id)
    else if (id && borrowerMembers.some((m) => m.member_id === id && m.status === "pending")) setReviewingBorrowerId(id)
    if (txnId && pendingTransactions.some((t) => t.transaction_id === txnId)) setReviewingTxnId(txnId)
    window.history.replaceState(null, "", "/admin")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshLoaded])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // ---- Members ----

  async function approveMember(memberId: string) {
    setMemberBusyId(memberId)
    setActionError("")
    const { error } = await supabase.from("members").update({ status: "approved" }).eq("member_id", memberId)
    setMemberBusyId(null)

    if (error) {
      setActionError(error.message)
      return
    }

    loadData()
  }

  // Moves the signup's email onto the existing record (approving it) and
  // removes the duplicate signup row, so their history carries over.
  async function linkMember(pendingId: string) {
    const targetId = memberLinkChoice[pendingId]
    if (!targetId) return

    setMemberBusyId(pendingId)
    setActionError("")
    const { error } = await supabase.rpc("admin_link_member", {
      p_pending_member_id: pendingId,
      p_target_member_id: targetId
    })
    setMemberBusyId(null)

    if (error) {
      setActionError(error.message)
      return
    }

    setReviewingSignupId(null)
    loadData()
  }

  // ---- Transactions ----

  // Withdrawal and Loan Release move real money out of the fund, and until
  // now there was no evidence trail for it at all -- receipt_url stayed
  // null from submission straight through approval. Requires the admin to
  // attach proof of the actual outgoing transfer before either can be
  // approved, same storage bucket/naming convention member-side receipts
  // already use.
  async function uploadApprovalReceipts(files: File[], memberId: string | null): Promise<string[] | null> {
    const { paths, error } = await uploadReceipts(files, memberId || "admin")
    if (error) {
      setActionError(error)
      return null
    }
    return paths
  }

  // The bank a pending row will count toward once approved -- for a
  // Withdrawal/Loan Release that's the bank the admin has picked, which
  // isn't on the row yet.
  function impactFor(t: ImpactTxn & { classification: string }): TxnImpact {
    const choice =
      t.classification === "Member Withdrawal"
        ? withdrawalBankSelections[t.transaction_id]
        : t.classification === "Loan Release"
        ? loanReleaseBankSelections[t.transaction_id]
        : undefined
    const chosen = choice ? banks.find((b) => b.id === choice) : undefined
    return txnImpact(t, chosen)
  }

  // Confirms with a toast and refreshes balances so the next preview starts
  // from where the banks actually are now.
  function showApprovalResult(ids: string[]) {
    rememberApproved(ids)
    setToast(`Approved ${ids.length} transaction${ids.length === 1 ? "" : "s"}`)
    fetchBankBalances()
      .then(setBankBalances)
      .catch(() => {})
  }

  async function approveTransaction(transactionId: string) {
    const txn = pendingTransactions.find((t) => t.transaction_id === transactionId)
    if (!txn) return

    setActionError("")

    // Tracked across both receipt-uploading branches below so the catch
    // handler can clean up orphaned uploads if the write after them fails.
    let uploadedReceipts: string[] = []

    try {
      if (txn.classification === "Member Withdrawal") {
        const bankAccountId = withdrawalBankSelections[transactionId]
        const receiptFiles = approvalReceipts[transactionId] ?? []
        if (!bankAccountId || receiptFiles.length === 0) return

        setUploadingReceiptId(transactionId)
        const paths = await uploadApprovalReceipts(receiptFiles, txn.member_id)
        setUploadingReceiptId(null)
        if (!paths) return
        uploadedReceipts = paths

        const { error } = await supabase
          .from("transactions")
          .update({ status: "approved", bank_account_id: bankAccountId, receipt_urls: paths })
          .eq("transaction_id", transactionId)
        if (error) throw error
      } else if (txn.classification === "Loan Release") {
        // Approving a Loan Release does the same thing loans/[id]'s
        // "Approve & Activate" does -- both call the same atomic RPC, which
        // verifies a pending disbursement transaction actually exists,
        // activates the loan, records the disbursing bank/receipt, and
        // freezes each eligible member's pool share for this loan's hold,
        // all in one DB transaction.
        const bankAccountId = loanReleaseBankSelections[transactionId]
        const receiptFiles = approvalReceipts[transactionId] ?? []
        if (!bankAccountId || receiptFiles.length === 0 || !txn.loan_id) return

        setUploadingReceiptId(transactionId)
        const paths = await uploadApprovalReceipts(receiptFiles, txn.member_id)
        setUploadingReceiptId(null)
        if (!paths) return
        uploadedReceipts = paths

        await approveLoanRelease({
          loanId: txn.loan_id,
          bankAccountId,
          receiptUrls: paths,
          releaseDate: dateOnly(new Date())
        })
      } else {
        const { error } = await supabase
          .from("transactions")
          .update({ status: "approved" })
          .eq("transaction_id", transactionId)
        if (error) throw error
      }
    } catch (err) {
      // The receipts already uploaded successfully above -- if the write
      // they belong to failed, clean them up rather than leaving them
      // orphaned in the bucket.
      await removeReceipts(uploadedReceipts)
      setActionError(err instanceof Error ? err.message : "Something went wrong.")
      return
    }

    setApprovalReceipts((prev) => {
      const next = { ...prev }
      delete next[transactionId]
      return next
    })
    loadData()
    showApprovalResult([transactionId])
  }

  async function rejectTransaction(transactionId: string, reason: string) {
    const txn = pendingTransactions.find((t) => t.transaction_id === transactionId)
    const isLoanRelease = txn?.classification === "Loan Release" && txn.loan_id

    setActionError("")

    try {
      // transactions.loan_id has a foreign key into loans with no cascade, so
      // the reference has to be cleared before the loan row can be deleted --
      // same fix already used by the member-facing "Cancel entry" flow in
      // EditTransactionSheet.
      const trimmedReason = reason.trim() || null
      const { error: txnError } = await supabase
        .from("transactions")
        .update(
          isLoanRelease
            ? { status: "rejected", loan_id: null, rejection_reason: trimmedReason }
            : { status: "rejected", rejection_reason: trimmedReason }
        )
        .eq("transaction_id", transactionId)
      if (txnError) throw txnError

      // A rejected Loan Release never disbursed anything -- the loan it was
      // requesting has nothing else attached to it yet (no hold, no
      // repayments, no gain), so deleting it removes the request cleanly.
      // Leaving the loans row behind at "requested" would strand it with no
      // pending transaction to ever act on again, while LoanDetailPanel's
      // "Approve & Activate" would still be reachable on it -- clicking that
      // would flip the loan to "active" and snapshot a hold with no actual
      // disbursement transaction behind it.
      if (isLoanRelease) {
        const { error: loanError } = await supabase.from("loans").delete().eq("loan_id", txn.loan_id)
        if (loanError) throw loanError
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Something went wrong.")
      return
    }

    // Rejecting a bulk row (Contribution/Loan Repayment) directly, without
    // going through the bulk bar, left its id checked in selectedBulkIds
    // even after it dropped out of pendingTransactions -- the sticky "N
    // selected" bar stayed stuck showing a row that no longer existed.
    setSelectedBulkIds((prev) => {
      if (!prev.has(transactionId)) return prev
      const next = new Set(prev)
      next.delete(transactionId)
      return next
    })

    setRejectingId(null)
    setRejectReason("")
    setReviewingTxnId(null)
    setToast("Transaction rejected")
    loadData()
  }

  function toggleBulkSelected(transactionId: string) {
    setSelectedBulkIds((prev) => {
      const next = new Set(prev)
      if (next.has(transactionId)) next.delete(transactionId)
      else next.add(transactionId)
      return next
    })
  }

  function toggleSelectAllBulk(visibleIds: string[]) {
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedBulkIds.has(id))
    setSelectedBulkIds((prev) => {
      const next = new Set(prev)
      visibleIds.forEach((id) => (allSelected ? next.delete(id) : next.add(id)))
      return next
    })
  }

  // Shared by the multi-select "Approve N" bar and the single-item card's
  // own "Approve" button below -- a lone pending item skips ticking a
  // checkbox entirely and calls this directly with just its own id.
  async function approveBulkIds(ids: string[]) {
    if (ids.length === 0) return
    setBulkApproving(true)
    setActionError("")

    // The UI only ever offers bulk-select checkboxes for Contribution/Loan
    // Repayment rows, but selectedBulkIds is still just client state --
    // scoping the write itself to BULK_CLASSIFICATIONS means a stale or
    // tampered selection can't blanket-approve a Withdrawal or Loan Release,
    // which would skip the bank/receipt evidence requirement entirely, and
    // for Loan Release, skip the atomic RPC that actually activates the loan.
    const { data, error } = await supabase
      .from("transactions")
      .update({ status: "approved" })
      .in("transaction_id", ids)
      .in("classification", Array.from(BULK_CLASSIFICATIONS))
      .select("transaction_id")

    setBulkApproving(false)

    if (error) {
      setActionError(error.message)
      return
    }

    if (!data || data.length !== ids.length) {
      setActionError(
        "Some selected transactions couldn't be bulk-approved and were skipped -- use the individual review flow for those instead."
      )
    }

    // Only what actually got approved counts toward the confirmation.
    const approvedIds = (data ?? []).map((r) => r.transaction_id as string)

    setSelectedBulkIds(new Set())
    loadData()
    if (approvedIds.length > 0) showApprovalResult(approvedIds)
  }

  async function approveBulkSelected() {
    await approveBulkIds(Array.from(selectedBulkIds))
  }

  // Withdrawal and Loan Release amounts (and, for Loan Release, the loan's
  // own terms) are editable in the review card before approval -- a
  // separate Save step, not bundled into Approve, so an admin can fix a
  // borrower's typo without also having picked a bank yet. Loan Release
  // duplicates the amount across transactions.amount (negative, cash out)
  // and loans.principal (positive) -- both need to move together.
  async function saveTransactionEdit(t: any) {
    const id = t.transaction_id
    const amountStr = editAmounts[id]
    const newAmount = amountStr !== undefined && amountStr !== "" ? Number(amountStr) : Math.abs(Number(t.amount))
    if (!Number.isFinite(newAmount) || newAmount <= 0) return

    setSavingEditId(id)
    setActionError("")

    try {
      const signedAmount = Number(t.amount) < 0 ? -newAmount : newAmount
      const { error: txnError } = await supabase.from("transactions").update({ amount: signedAmount }).eq("transaction_id", id)
      if (txnError) throw txnError

      if (t.classification === "Loan Release" && t.loan_id) {
        const loanUpdate: Record<string, number> = { principal: newAmount }

        if (t.loans?.interest_type === "amount") {
          const v = editInterestAmount[id]
          if (v !== undefined && v !== "") loanUpdate.interest_amount = Number(v)
        } else {
          const v = editInterestRate[id]
          if (v !== undefined && v !== "") loanUpdate.interest_rate = Number(v)
        }

        const termV = editTermMonths[id]
        if (termV !== undefined && termV !== "") loanUpdate.term_months = Number(termV)

        const { error: loanError } = await supabase.from("loans").update(loanUpdate).eq("loan_id", t.loan_id)
        if (loanError) throw loanError
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Something went wrong.")
      setSavingEditId(null)
      return
    }

    setSavingEditId(null)
    setEditAmounts((prev) => { const next = { ...prev }; delete next[id]; return next })
    setEditInterestRate((prev) => { const next = { ...prev }; delete next[id]; return next })
    setEditInterestAmount((prev) => { const next = { ...prev }; delete next[id]; return next })
    setEditTermMonths((prev) => { const next = { ...prev }; delete next[id]; return next })
    loadData()
  }

  // ---- Borrowers ----

  async function approveBorrower(memberId: string) {
    setBorrowerBusyId(memberId)
    setActionError("")

    try {
      await approveBorrowerMember(memberId)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Something went wrong.")
      setBorrowerBusyId(null)
      return
    }

    setBorrowerBusyId(null)
    loadData()
  }

  // ---- Export ----

  function csvCell(value: unknown): string {
    const str = value === null || value === undefined ? "" : String(value)
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
  }

  // Full history including approved/rejected/cancelled rows, unlike the
  // pending-only queue above -- this is meant as a complete backup/audit
  // export replacing the manually maintained Excel sheet, not a working view.
  async function exportTransactionsCsv() {
    setExporting(true)
    setExportError("")

    // Supabase/PostgREST caps how many rows a single request can return
    // (1000 by default) regardless of the .range() asked for, and just
    // silently returns fewer rows rather than erroring -- a single
    // .range(0, 9999) request was quietly getting truncated to the
    // oldest 1000 rows only, dropping everything more recent. Paginate
    // in pages of 1000 instead, accumulating every page, and only stop
    // once a page comes back short (including possibly-empty) -- that's
    // the only reliable "no more rows" signal regardless of the actual
    // server-side cap.
    const PAGE_SIZE = 1000
    const allRows: ExportRow[] = []
    let from = 0

    while (true) {
      const { data, error } = await supabase
        .from("transactions")
        .select(
          `
          txn_date,
          classification,
          status,
          amount,
          bank,
          description,
          members!transactions_member_id_fkey ( name ),
          submitted_by_member:members!transactions_submitted_by_fkey ( name ),
          loans!transactions_loan_id_fkey ( name ),
          investments!transactions_investment_id_fkey ( name ),
          from_bank_account:bank_accounts!transactions_bank_account_id_fkey ( bank_name, account_name ),
          to_bank_account:bank_accounts!transactions_to_bank_account_id_fkey ( bank_name, account_name ),
          created_at
        `
        )
        .order("txn_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true })
        .range(from, from + PAGE_SIZE - 1)

      if (error) {
        setExporting(false)
        setExportError(error.message)
        return
      }

      const batch = (data ?? []) as unknown as ExportRow[]
      allRows.push(...batch)

      if (batch.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }

    setExporting(false)

    const headers = [
      "Date", "Type", "Status", "Member", "Amount", "Bank",
      "Transfer To", "Loan", "Investment", "Submitted By", "Description", "Recorded At"
    ]

    const rows = allRows.map((t) => [
      t.txn_date ?? "",
      typeLabels[t.classification] || t.classification,
      t.status,
      t.members?.name ?? "",
      t.amount,
      // Legacy migrated rows carry the bank as plain text in `bank`; rows
      // created through the app link a real bank account via
      // bank_account_id instead -- same fallback used on /transactions.
      t.bank || t.from_bank_account?.account_name || t.from_bank_account?.bank_name || "",
      t.to_bank_account?.account_name || t.to_bank_account?.bank_name || "",
      t.loans?.name ?? "",
      t.investments?.name ?? "",
      t.submitted_by_member?.name ?? "",
      t.description ?? "",
      t.created_at ?? ""
    ])

    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `est-2017-transactions-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const bulkTransactions = pendingTransactions.filter((t) => BULK_CLASSIFICATIONS.has(t.classification))
  const reviewTransactions = pendingTransactions.filter((t) => !BULK_CLASSIFICATIONS.has(t.classification))
  // Any pending row opens the review sheet -- Confirmed money rows too, so
  // every item can be checked (date, notes, receipt, bank effect) the same way.
  const reviewingTxn = pendingTransactions.find((t) => t.transaction_id === reviewingTxnId) ?? null
  // Confirmed money rows have no sheet of their own to nest a reject prompt
  // inside (they're plain rows in the page, not opened via a sheet the way
  // everything else here is) -- rejectingId doubles as which row's own
  // reject sheet is open, bulkTransactions and reviewTransactions never
  // overlapping so this and Review Transaction's own reject state can never
  // both resolve to a real row at once.
  // Since Confirmed money rows also open the review sheet, rejecting from
  // inside that sheet uses the sheet's own prompt -- skip this one then,
  // or both prompts opened at once.
  const rejectingBulkTxn =
    rejectingId !== reviewingTxnId ? bulkTransactions.find((t) => t.transaction_id === rejectingId) ?? null : null

  // Money coming in and going out are totalled separately -- adding a
  // contribution and a loan release together described neither.
  const pendingInTotal = pendingTransactions.reduce((sum, t) => sum + (Number(t.amount) > 0 ? Number(t.amount) : 0), 0)
  const pendingOutTotal = pendingTransactions.reduce((sum, t) => sum + (Number(t.amount) < 0 ? -Number(t.amount) : 0), 0)
  const pendingBorrowers = borrowerMembers.filter((m) => m.status === "pending")
  const reviewingSignup = pendingMembers.find((m) => m.member_id === reviewingSignupId) ?? null
  const reviewingBorrower = pendingBorrowers.find((m) => m.member_id === reviewingBorrowerId) ?? null

  const signupsCount = pendingMembers.length + pendingBorrowers.length
  const totalCount = pendingTransactions.length + signupsCount + loansToClose.length

  // Only categories that have something waiting -- and no chip row at all
  // when there'd be nothing to switch between (one category, or none).
  const chips: { id: Filter; label: string; count: number }[] = [
    { id: "all" as Filter, label: "All", count: totalCount },
    { id: "txn" as Filter, label: "Transactions", count: pendingTransactions.length + loansToClose.length },
    { id: "signup" as Filter, label: "Signups", count: signupsCount }
  ].filter((c) => c.id === "all" || c.count > 0)
  const showChips = chips.length > 2
  // A chip that just emptied (e.g. its last item approved) drops back to All
  // rather than leaving the queue filtered to nothing.
  const activeFilter: Filter = chips.some((c) => c.id === filter) && showChips ? filter : "all"

  const showTxns = activeFilter === "all" || activeFilter === "txn"
  const showSignups = activeFilter === "all" || activeFilter === "signup"

  if (checkingAccess) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(6rem+var(--dock-h)+env(safe-area-inset-bottom))]">
            <SkeletonCardList rows={3} />
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden relative">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(6rem+var(--dock-h)+env(safe-area-inset-bottom))]">
          {/* Page actions share the eyebrow's line, so the title below gets
              the full width instead of wrapping beside three buttons. */}
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono">Administration</div>

            <div className="shrink-0 flex items-center gap-2">
            {/* Members page (members and borrowers) -- always reachable from
                here, whatever's in the queue below. */}
            <button
              onClick={() => router.push("/admin/members")}
              className="shrink-0 inline-flex items-center justify-center w-9 h-9 text-ink-soft border border-hairline rounded-full hover:bg-paper-2 hover:text-ink transition-colors"
              title="Members and borrowers"
              aria-label="Members and borrowers"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <circle cx="9" cy="8" r="3.2" />
                <path d="M3.5 19c.6-3.1 2.8-5 5.5-5s4.9 1.9 5.5 5" />
                <path d="M15.5 5.2a3 3 0 0 1 0 5.6M17.5 14.3c1.7.6 2.8 2.2 3 4.7" />
              </svg>
            </button>

            <MessagesButton />

            {/* Page-level action, not scoped to any group -- always exports
                the full transaction history regardless of what's filtered
                below. */}
            <button
              onClick={exportTransactionsCsv}
              disabled={exporting}
              className="shrink-0 inline-flex items-center justify-center w-9 h-9 text-ink-soft border border-hairline rounded-full hover:bg-paper-2 hover:text-ink transition-colors disabled:opacity-60"
              title="Export full transaction history (every status, not just what's shown below) as a CSV backup"
              aria-label="Export CSV"
            >
              {exporting ? (
                <span className="text-[10px] font-mono">...</span>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  <path d="M12 3v13M7 11l5 5 5-5M5 20h14" />
                </svg>
              )}
            </button>
            </div>
          </div>
          <h1 className="font-display text-3xl font-semibold">
            {totalCount > 0 ? (
              <>
                <span className="text-gold">{totalCount}</span> waiting on you
              </>
            ) : (
              "All caught up"
            )}
          </h1>
          {exportError && (
            <p className="mt-1.5 text-xs text-rust text-right">Couldn&apos;t export: {exportError}</p>
          )}

          {loadError && (
            <p className="mt-4 text-sm text-rust">Couldn&apos;t load some data: {loadError}</p>
          )}

          {actionError && <p className="mt-4 text-sm text-rust">{actionError}</p>}


          {/* Filter chips -- narrow which groups show below, replacing the
              old two-tier tab system. Single-select, matching the pill
              vocabulary used elsewhere (TypePickerSheet, filter rows). */}
          {showChips && (
          <div className="mt-5 flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {chips.map((c) => (
              <button
                key={c.id}
                onClick={() => setFilter(c.id)}
                className={`shrink-0 flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                  activeFilter === c.id ? "bg-gold-soft text-ink" : "border border-hairline text-ink-soft"
                }`}
              >
                {c.label}
                <span className={`font-mono text-xs ${activeFilter === c.id ? "text-ink" : "text-ink-soft"}`}>{c.count}</span>
              </button>
            ))}
          </div>
          )}

          <div className="mt-6 space-y-8">
            {/* Only on "All" -- switching to the Transactions or Signups
                chip with nothing pending already gets its own "Nothing
                pending right now" from that chip's own fallback section
                below, so showing this too duplicated the same message. */}
            {activeFilter === "all" && totalCount === 0 && (
              <div className="text-center py-16">
                <p className="text-2xl mb-2">🌱</p>
                <p className="text-sm text-ink-soft">
                  New signups and transactions will show up here.
                </p>
              </div>
            )}

            {/* ---- Confirmed money (bulk) ---- */}
            {showTxns && bulkTransactions.length > 0 && (
              <section>
                <div className="flex items-center justify-between gap-3">
                  <label
                    className={`flex items-center gap-2.5 text-sm font-semibold ${
                      bulkTransactions.length > 1 ? "cursor-pointer" : ""
                    }`}
                  >
                    {/* A single pending item has nothing to batch with, so
                        the select-all checkbox (and each row's own
                        checkbox below) only earns its place once there's
                        more than one -- otherwise it's a tick that gates
                        nothing. */}
                    {bulkTransactions.length > 1 && (
                      <input
                        type="checkbox"
                        className="w-[18px] h-[18px] accent-ink shrink-0"
                        checked={bulkTransactions.every((t) => selectedBulkIds.has(t.transaction_id))}
                        onChange={() => toggleSelectAllBulk(bulkTransactions.map((t) => t.transaction_id))}
                      />
                    )}
                    Confirmed money
                  </label>
                  <span className="shrink-0 text-[11px] font-mono uppercase tracking-wide text-ink-soft border border-hairline rounded-full px-2.5 py-1">
                    {bulkTransactions.length} pending
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-ink-soft">
                  Already in the bank — nothing left to decide, just to confirm.
                </p>

                <div className="mt-3 space-y-2">
                  {bulkTransactions.map((t) => (
                    <div key={t.transaction_id} className="card overflow-hidden">
                      <div className="flex items-center gap-3 px-4 py-3">
                        {bulkTransactions.length > 1 && (
                          <input
                            type="checkbox"
                            className="w-[18px] h-[18px] accent-ink shrink-0"
                            checked={selectedBulkIds.has(t.transaction_id)}
                            onChange={() => toggleBulkSelected(t.transaction_id)}
                          />
                        )}
                        {/* Tapping the row opens the same review sheet as
                            "Needs a decision" -- date, notes, receipt and
                            bank effect -- with Approve right there. */}
                        <button
                          type="button"
                          onClick={() => setReviewingTxnId(t.transaction_id)}
                          className="min-w-0 flex-1 flex items-center gap-3 text-left"
                        >
                          <FlowBadge {...(FLOW[t.classification] ?? { arrow: "•", tone: "in" })} small />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 min-w-0">
                              <span className="font-display font-medium truncate text-sm">{t.members?.name || "Fund"}</span>
                              <ImpactTag impact={impactFor(t)} />
                            </span>
                            <span className="block text-xs text-ink-soft truncate">
                              {typeLabels[t.classification] || t.classification}
                              {t.bank_accounts && ` · ${t.bank_accounts.account_name || t.bank_accounts.bank_name}`}
                            </span>
                            <span className="block text-[11px] text-ink-soft font-mono truncate">{queuedLabel(t)}</span>
                            <QueueCardExtras context={contextFor(t)} note={t.description?.trim()} flags={flagsFor(t)} />
                          </span>
                        </button>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-mono">{Number(t.amount) < 0 ? "−" : ""}₱{fmt(Math.abs(t.amount))}</p>
                          <div className="flex items-center justify-end gap-2 mt-0.5">
                            {receiptPaths(t).length > 0 && (
                              <button
                                type="button"
                                onClick={() => setOpenReceipt({ paths: receiptPaths(t), index: 0 })}
                                className="text-[11px] text-gold hover:underline"
                              >
                                🧾 {receiptPaths(t).length > 1 ? `${receiptPaths(t).length} receipts` : "Receipt"}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setRejectingId(t.transaction_id)
                                setRejectReason("")
                              }}
                              className="text-[11px] text-ink-soft hover:text-rust hover:underline"
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Nothing left to select against, so the approve
                          action lives right on the card instead of behind
                          the tick-then-bulk-bar flow below. */}
                      {bulkTransactions.length === 1 && (
                        <div className="px-4 pb-3.5">
                          {(() => {
                            const impact = impactFor(t)
                            const grouped = groupImpacts([impact])
                            return (
                              <BankImpactPreview
                                {...grouped}
                                noneReason={impact.kind === "none" ? impact.reason : undefined}
                                balances={bankBalances}
                                className="mb-3"
                              />
                            )
                          })()}
                          <button
                            type="button"
                            onClick={() => approveBulkIds([t.transaction_id])}
                            disabled={bulkApproving}
                            className="w-full bg-ink text-paper px-4 py-3 rounded-full text-sm font-bold shadow-lg disabled:opacity-50 disabled:shadow-none"
                          >
                            {bulkApproving ? "Approving…" : `Approve ${Number(t.amount) < 0 ? "−" : ""}₱${fmt(Math.abs(t.amount))}`}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {bulkTransactions.length > 1 && selectedBulkIds.size > 0 && (() => {
                  const selected = bulkTransactions.filter((t) => selectedBulkIds.has(t.transaction_id))
                  const selectedTotal = selected.reduce((sum, t) => sum + Number(t.amount), 0)
                  return (
                    <div
                      // Theme card rather than an inverted block -- in dark
                      // mode bg-ink turned it into a bright white slab.
                      className="sticky z-10 mt-3 bg-paper-2 border border-hairline rounded-2xl px-4 py-3.5 shadow-[0_-8px_30px_rgba(0,0,0,0.25)]"
                      // Above the bottom dock -- at bottom-4 it stuck *under* the
                      // dock once the queue was long enough to scroll.
                      style={{ bottom: "calc(var(--dock-h) + 0.75rem)" }}
                    >
                      <BankImpactPreview
                        {...groupImpacts(selected.map(impactFor))}
                        balances={bankBalances}
                        compact
                        className="mb-3 pb-3 border-b border-hairline"
                      />
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block text-xs text-ink-soft">{selectedBulkIds.size} selected</span>
                          <span
                            className={`block font-mono [font-variant-numeric:tabular-nums] text-[15px] ${
                              selectedTotal < 0 ? "text-rust" : "text-sage"
                            }`}
                          >
                            {selectedTotal < 0 ? "−" : "+"}₱{fmt(Math.abs(selectedTotal))}
                          </span>
                        </span>
                        <div className="flex gap-2 shrink-0">
                          <button
                            className="border border-hairline text-ink px-4 py-2.5 rounded-full text-sm whitespace-nowrap"
                            onClick={() => setSelectedBulkIds(new Set())}
                          >
                            Clear
                          </button>
                          <button
                            className="bg-ink text-paper px-5 py-2.5 rounded-full text-sm font-bold whitespace-nowrap disabled:opacity-50"
                            onClick={approveBulkSelected}
                            disabled={bulkApproving}
                          >
                            {bulkApproving ? "Approving..." : `Approve ${selectedBulkIds.size}`}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })()}

              </section>
            )}

            {/* ---- Needs a decision ---- */}
            {showTxns && reviewTransactions.length > 0 && (
              <section>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold">Needs a decision</span>
                  <span className="shrink-0 text-[11px] font-mono uppercase tracking-wide text-gold border border-gold rounded-full px-2.5 py-1">
                    {reviewTransactions.length} pending
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-ink-soft">
                  Money going out needs a bank and proof of transfer. Investment Returns are checked one at a time.
                </p>

                <div className="mt-3 space-y-2">
                  {reviewTransactions.map((t) => {
                    const needsWithdrawalBank = t.classification === "Member Withdrawal"
                    const needsLoanBank = t.classification === "Loan Release"

                    return (
                      <button
                        key={t.transaction_id}
                        type="button"
                        onClick={() => setReviewingTxnId(t.transaction_id)}
                        className="w-full card overflow-hidden flex items-center gap-3 px-4 py-3 text-left"
                      >
                        <FlowBadge {...(FLOW[t.classification] ?? { arrow: "•", tone: "out" })} small />
                        <div className="min-w-0 flex-1">
                          <p className="font-display font-medium truncate text-sm">{t.members?.name || "Fund"}</p>
                          <p className="text-xs text-ink-soft truncate">
                            {typeLabels[t.classification] || t.classification}
                            {needsLoanBank && " · requested"}
                            {needsWithdrawalBank && " · pick the disbursing bank"}
                            {t.classification === "Investment Return" && t.investments?.name && ` · ${t.investments.name}`}
                            {t.submitted_by_member && ` · by ${t.submitted_by_member.name}`}
                          </p>
                          <p className="text-[11px] text-ink-soft font-mono truncate">{queuedLabel(t)}</p>
                          <QueueCardExtras context={contextFor(t)} note={t.description?.trim()} flags={flagsFor(t)} />
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-mono">₱{fmt(Math.abs(t.amount))}</p>
                          <p className="text-[11px] font-mono text-gold">Review →</p>
                        </div>
                      </button>
                    )
                  })}
                </div>


              </section>
            )}

            {showTxns && pendingTransactions.length > 0 && (
              <p className="-mt-4 text-xs text-ink-soft font-mono">
                Pending:{" "}
                {[pendingInTotal > 0 ? `₱${fmt(pendingInTotal)} in` : null, pendingOutTotal > 0 ? `₱${fmt(pendingOutTotal)} out` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}

            {/* ---- Fully repaid loans still open ---- */}
            {showTxns && loansToClose.length > 0 && (
              <section>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold">Ready to close</span>
                  <span className="shrink-0 text-[11px] font-mono uppercase tracking-wide text-ink-soft border border-hairline rounded-full px-2.5 py-1">
                    {loansToClose.length}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-ink-soft">
                  Paid in full but still active — closing shares out the gain.
                </p>
                <div className="mt-3 space-y-2">
                  {loansToClose.map((l) => (
                    <button
                      key={l.loan_id}
                      type="button"
                      onClick={() => router.push(`/fund-breakdown?tab=loans&loan=${l.loan_id}`)}
                      className="w-full card flex items-center gap-3 px-4 py-3 text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-display font-medium truncate text-sm">{l.loan}</p>
                        <p className="text-xs text-ink-soft truncate">
                          ₱{fmt(l.total_repayable)} repaid
                          {l.last_repayment_date &&
                            ` · last payment ${new Date(`${l.last_repayment_date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
                        </p>
                      </div>
                      <span className="shrink-0 text-[11px] font-mono text-gold">Close →</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* ---- New signups ---- */}
            {showSignups && pendingMembers.length > 0 && (
              <section>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold">New signups</span>
                  <span className="shrink-0 text-[11px] font-mono uppercase tracking-wide text-ink-soft border border-hairline rounded-full px-2.5 py-1">
                    {pendingMembers.length}
                  </span>
                </div>

                <div className="mt-3 space-y-2">
                  {pendingMembers.map((m) => (
                    <button
                      key={m.member_id}
                      type="button"
                      onClick={() => setReviewingSignupId(m.member_id)}
                      className="w-full card flex items-center gap-3 px-4 py-3 text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-display font-medium truncate text-sm">{m.name}</p>
                        <p className="text-xs text-ink-soft truncate">
                          {m.email} · {timeAgo(m.created_at)}
                        </p>
                      </div>
                      <span className="shrink-0 text-[11px] font-mono text-gold">Review →</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* ---- Borrower requests ---- */}
            {showSignups && pendingBorrowers.length > 0 && (
              <section>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold">Borrower requests</span>
                  <span className="shrink-0 text-[11px] font-mono uppercase tracking-wide text-ink-soft border border-hairline rounded-full px-2.5 py-1">
                    {pendingBorrowers.length}
                  </span>
                </div>

                <div className="mt-3 space-y-2">
                  {pendingBorrowers.map((m) => (
                    <button
                      key={m.member_id}
                      type="button"
                      onClick={() => setReviewingBorrowerId(m.member_id)}
                      className="w-full card flex items-center gap-3 px-4 py-3 text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-display font-medium truncate text-sm">{m.name}</p>
                        <p className="text-xs text-ink-soft truncate">
                          {m.email || "No email"} · {timeAgo(m.created_at)}
                        </p>
                      </div>
                      <span className="shrink-0 text-[11px] font-mono text-gold">Review →</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

          </div>
        </div>

        {/* Admin's own FAB -- Navbar's "New Transaction" FAB is hidden on
            this page (see Navbar's showFab), so this is a separate button
            for Admin's own primary action: finding and fixing any
            transaction on record, replacing the old Support tab. */}
        {/* Hidden while rows are selected -- the bulk Approve bar takes the
            same bottom-right spot, and both on screen at once overlapped. */}
        {/* Pinned to the same max-w-3xl column as the dock (like Navbar's
            FAB) rather than the viewport edge, so on wide screens (iPad)
            it sits above the dock's right end instead of the screen corner. */}
        {selectedBulkIds.size === 0 && (
        <div
          className="fixed inset-x-0 z-40 pointer-events-none"
          style={{ bottom: "calc(var(--dock-h) + 0.75rem)" }}
        >
          <div className="max-w-3xl mx-auto px-4 flex justify-end">
            <button
              onClick={() => setShowSearchFix(true)}
              aria-label="Search & Fix"
              className="pointer-events-auto w-14 h-14 rounded-full bg-ink text-paper flex items-center justify-center shadow-lg"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
                <circle cx="10.5" cy="10.5" r="6.5" />
                <path d="M20 20l-4.8-4.8" />
              </svg>
            </button>
          </div>
        </div>
        )}
      </main>

      {reviewingTxn && (() => {
        const t = reviewingTxn
        const needsWithdrawalBank = t.classification === "Member Withdrawal"
        const needsLoanBank = t.classification === "Loan Release"
        const payoutSource = needsLoanBank ? t.loans : needsWithdrawalBank ? t : null
        const payoutDetails: string | null = payoutSource?.payout_details ?? null
        const payoutQrPath: string | null = payoutSource?.payout_qr_path ?? null

        // Only money the admin sends out (Withdrawal/Loan Release) needs the
        // admin's own proof of transfer -- an Investment Return's receipt is
        // the member's to attach, and approving it uploads nothing anyway.
        const needsAdminProof = needsWithdrawalBank || needsLoanBank
        // Contributions/Loan Payments open here too now, read-only: same
        // approve write as their own queue card (approveBulkIds), and no
        // amount editing that their queue card never offered.
        const isConfirmedMoney = BULK_CLASSIFICATIONS.has(t.classification)
        const id = t.transaction_id
        const changed = (v: string | undefined, original: unknown) => v !== undefined && v !== String(original ?? "")
        // Save only shows once something actually differs from what's on
        // record, and Approve waits until it's saved or discarded -- it
        // always approves the saved amount, so approving mid-edit would
        // silently ignore the edit.
        const isDirty =
          !isConfirmedMoney &&
          (changed(editAmounts[id], Math.abs(t.amount)) ||
            (needsLoanBank &&
              (t.loans?.interest_type === "amount"
                ? changed(editInterestAmount[id], t.loans?.interest_amount)
                : changed(editInterestRate[id], t.loans?.interest_rate))) ||
            (needsLoanBank && changed(editTermMonths[id], t.loans?.term_months)))
        const discardEdits = () => {
          const drop = (prev: Record<string, string>) => {
            const next = { ...prev }
            delete next[id]
            return next
          }
          setEditAmounts(drop)
          setEditInterestRate(drop)
          setEditInterestAmount(drop)
          setEditTermMonths(drop)
          setCustomRate(false)
          setCustomTerm(false)
        }
        const subtitle = [
          queuedLabel(t),
          needsLoanBank ? "Requested" : null,
          t.classification === "Investment Return" ? t.investments?.name : null,
          t.submitted_by_member ? `Submitted by ${t.submitted_by_member.name}` : null
        ]
          .filter(Boolean)
          .join(" · ")

        const missingBank =
          (needsWithdrawalBank && !withdrawalBankSelections[t.transaction_id]) ||
          (needsLoanBank && !loanReleaseBankSelections[t.transaction_id])
        const proofFiles = approvalReceipts[t.transaction_id] ?? []
        const missingProof = needsAdminProof && proofFiles.length === 0
        const showMissing = approveTriedId === t.transaction_id
        const canApprove = !isDirty && !(isConfirmedMoney && bulkApproving) && uploadingReceiptId !== t.transaction_id

        const footer =
          rejectingId === t.transaction_id ? (
            <RejectReasonPrompt
              reason={rejectReason}
              onChangeReason={setRejectReason}
              onCancel={() => {
                setRejectingId(null)
                setRejectReason("")
              }}
              onConfirm={() => rejectTransaction(t.transaction_id, rejectReason)}
            />
          ) : (
            <>
              {actionError && <p className="text-sm text-rust mb-3">{actionError}</p>}
              {(() => {
                const impact = impactFor(t)
                // A Withdrawal/Loan Release has no bank until one is picked --
                // nothing meaningful to preview yet.
                if (impact.kind === "none" && impact.reason === "no_bank" && (needsWithdrawalBank || needsLoanBank)) return null
                return (
                  <BankImpactPreview
                    {...groupImpacts([impact])}
                    noneReason={impact.kind === "none" ? impact.reason : undefined}
                    balances={bankBalances}
                    className="mb-3"
                  />
                )
              })()}
              {isDirty && (
                <p className="text-[12px] text-gold mb-3">Save or discard your changes before approving.</p>
              )}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="shrink-0 border border-rust text-rust px-5 py-3.5 rounded-full text-base font-semibold"
                  onClick={() => {
                    setRejectingId(t.transaction_id)
                    setRejectReason("")
                  }}
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="flex-1 bg-ink text-paper px-6 py-3.5 rounded-full text-base font-bold shadow-lg motion-safe:transition-transform motion-safe:active:scale-[0.97] disabled:opacity-50 disabled:shadow-none"
                  onClick={() => {
                    if (missingBank || missingProof) {
                      setApproveTriedId(id)
                      return
                    }
                    if (isConfirmedMoney) approveBulkIds([id])
                    else approveTransaction(id)
                  }}
                  disabled={!canApprove}
                >
                  {uploadingReceiptId === t.transaction_id
                    ? "Uploading…"
                    : isConfirmedMoney && bulkApproving
                    ? "Approving…"
                    : needsLoanBank
                    ? "Approve & activate"
                    : "Approve"}
                </button>
              </div>
              {needsLoanBank && (
                <p className="text-[11px] text-ink-soft text-center mt-2">
                  The loan starts today — approve once the last transfer has gone out.
                </p>
              )}
            </>
          )

        return (
          <Sheet
            title="Review transaction"
            onClose={() => {
              setReviewingTxnId(null)
              setApproveTriedId(null)
              setTermPicker(null)
              setCustomRate(false)
              setCustomTerm(false)
            }}
            footer={footer}
          >
            <div className="card overflow-hidden">
              <FieldRow icon={<FlowBadge {...(FLOW[t.classification] ?? { arrow: "•", tone: "out" })} small />}>
                <span className="flex-1 min-w-0 text-sm">
                  <span className="font-semibold text-ink">{t.members?.name || "Fund"}</span>
                  <span className="text-ink-soft"> · {typeLabels[t.classification] || t.classification}</span>
                </span>
              </FieldRow>
            </div>
            <p className="px-1 pt-2 text-xs text-ink-soft">{subtitle}</p>
            {(() => {
              const flags = flagsFor(t)
              const context = contextFor(t)
              if (!flags.length && !context) return null
              return (
                <div className="px-1 pt-2 space-y-1.5">
                  {context && <p className="text-xs font-mono text-ink">{context}</p>}
                  {flags.length > 0 && <FlagChips flags={flags} />}
                </div>
              )
            })()}

            {isConfirmedMoney ? (
              <div className="text-center py-6">
                <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1">Amount</p>
                <p className="font-mono [font-variant-numeric:tabular-nums] text-4xl font-bold text-ink">
                  ₱{fmt(Math.abs(t.amount))}
                </p>
              </div>
            ) : (
              <AmountHero
                value={editAmounts[t.transaction_id] ?? String(Math.abs(t.amount))}
                onChange={(v) => setEditAmounts((prev) => ({ ...prev, [t.transaction_id]: v }))}
                label="Amount"
              />
            )}

            {needsLoanBank && (() => {
              const isAmountInterest = t.loans?.interest_type === "amount"
              const rateValue = editInterestRate[id] ?? String(t.loans?.interest_rate ?? "")
              const amountValue = editInterestAmount[id] ?? String(t.loans?.interest_amount ?? "")
              const termValue = editTermMonths[id] ?? String(t.loans?.term_months ?? "")
              return (
                <div className="-mt-2 mb-4">
                  <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">Loan terms</p>
                  <div className="card divide-y divide-hairline overflow-hidden">
                    <FieldRow icon={<InterestIcon />}>
                      {isAmountInterest || customRate ? (
                        <input
                          className={`${rowInputClass} font-mono`}
                          type="number"
                          inputMode="decimal"
                          placeholder={isAmountInterest ? "Interest amount (₱)" : "Interest rate (%)"}
                          value={isAmountInterest ? amountValue : rateValue}
                          onChange={(e) => {
                            const value = e.target.value
                            if (isAmountInterest) setEditInterestAmount((prev) => ({ ...prev, [id]: value }))
                            else setEditInterestRate((prev) => ({ ...prev, [id]: value }))
                          }}
                          autoFocus={customRate}
                        />
                      ) : (
                        <button type="button" onClick={() => setTermPicker("rate")} className="flex-1 min-w-0 text-left text-sm text-ink">
                          {rateValue ? `${rateValue}% interest` : "Interest rate"}
                        </button>
                      )}
                      {isAmountInterest ? (
                        <span className="text-ink-soft text-xs shrink-0">₱ flat</span>
                      ) : (
                        <button type="button" onClick={() => setTermPicker("rate")} aria-label="Choose an interest rate" className="text-ink-soft text-xs shrink-0 px-1">
                          ▾
                        </button>
                      )}
                    </FieldRow>
                    <FieldRow icon={<ClockIcon />}>
                      {customTerm ? (
                        <input
                          className={`${rowInputClass} font-mono`}
                          type="number"
                          inputMode="numeric"
                          placeholder="Term in months"
                          value={termValue}
                          onChange={(e) => {
                            const value = e.target.value
                            setEditTermMonths((prev) => ({ ...prev, [id]: value }))
                          }}
                          autoFocus
                        />
                      ) : (
                        <button type="button" onClick={() => setTermPicker("term")} className="flex-1 min-w-0 text-left text-sm text-ink">
                          {termValue ? `${termValue} ${termValue === "1" ? "month" : "months"}` : "Term"}
                        </button>
                      )}
                      <button type="button" onClick={() => setTermPicker("term")} aria-label="Choose a term" className="text-ink-soft text-xs shrink-0 px-1">
                        ▾
                      </button>
                    </FieldRow>
                  </div>
                  {termPicker === "rate" && (
                    <InterestRatePickerSheet
                      value={rateValue}
                      onSelect={(rate) => {
                        setEditInterestRate((prev) => ({ ...prev, [id]: String(rate) }))
                        setTermPicker(null)
                      }}
                      onCustom={() => {
                        setCustomRate(true)
                        setTermPicker(null)
                      }}
                      onClose={() => setTermPicker(null)}
                    />
                  )}
                  {termPicker === "term" && (
                    <TermPickerSheet
                      value={termValue}
                      onSelect={(months) => {
                        setEditTermMonths((prev) => ({ ...prev, [id]: String(months) }))
                        setTermPicker(null)
                      }}
                      onCustom={() => {
                        setCustomTerm(true)
                        setTermPicker(null)
                      }}
                      onClose={() => setTermPicker(null)}
                    />
                  )}
                </div>
              )
            })()}

            {/* Only once something actually differs from what's on record. */}
            {isDirty && (
              <div className="flex items-center gap-2 mb-4">
                <button
                  type="button"
                  className="bg-ink text-paper px-4 py-2 rounded-full text-sm font-semibold disabled:opacity-50"
                  onClick={() => saveTransactionEdit(t)}
                  disabled={savingEditId === t.transaction_id}
                >
                  {savingEditId === t.transaction_id ? "Saving…" : "Save changes"}
                </button>
                <button
                  type="button"
                  className="border border-hairline text-ink-soft px-4 py-2 rounded-full text-sm font-semibold"
                  onClick={discardEdits}
                  disabled={savingEditId === t.transaction_id}
                >
                  Discard
                </button>
              </div>
            )}

            {/* Where the member or borrower asked for the money to go -- set on
                their loan request, or on the withdrawal itself. */}
            {(payoutDetails || payoutQrPath) && (
              <div className="mb-4">
                <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">Send to</p>
                <div className="card px-4 py-3.5 space-y-3">
                  {payoutDetails && (
                    <p className="text-sm text-ink whitespace-pre-line break-words">{payoutDetails}</p>
                  )}
                  {payoutQrPath && (
                    <button
                      type="button"
                      onClick={() => setOpenReceipt({ paths: [payoutQrPath], index: 0 })}
                      className="inline-flex items-center gap-1.5 text-xs font-mono text-gold border border-gold rounded-full px-3 py-1.5 hover:bg-gold/10 transition-colors"
                    >
                      View QR code
                    </button>
                  )}
                </div>
              </div>
            )}

            {needsAdminProof && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">Details</p>
              <div className="card divide-y divide-hairline overflow-hidden">
                {needsWithdrawalBank && (
                  <FieldRow icon={<BankIcon />} error={showMissing && missingBank ? "Choose the bank you're sending from" : undefined}>
                    <select
                      className={rowSelectClass}
                      value={withdrawalBankSelections[t.transaction_id] || ""}
                      onChange={(e) =>
                        setWithdrawalBankSelections((prev) => ({ ...prev, [t.transaction_id]: e.target.value }))
                      }
                    >
                      <option value="">Select a bank</option>
                      {banks.map((bank) => (
                        <option key={bank.id} value={bank.id}>
                          {bank.account_name || bank.bank_name}
                        </option>
                      ))}
                    </select>
                  </FieldRow>
                )}

                {needsLoanBank && (
                  <FieldRow icon={<BankIcon />} error={showMissing && missingBank ? "Choose the bank you're sending from" : undefined}>
                    <select
                      className={rowSelectClass}
                      value={loanReleaseBankSelections[t.transaction_id] || ""}
                      onChange={(e) =>
                        setLoanReleaseBankSelections((prev) => ({ ...prev, [t.transaction_id]: e.target.value }))
                      }
                    >
                      <option value="">Select a bank</option>
                      {banks.map((bank) => (
                        <option key={bank.id} value={bank.id}>
                          {bank.account_name || bank.bank_name}
                        </option>
                      ))}
                    </select>
                  </FieldRow>
                )}

                {proofFiles.map((file, i) => (
                  <div key={`${file.name}-${file.lastModified}-${i}`} className="flex items-center gap-3 px-4 py-3">
                    <span className="text-base shrink-0">📎</span>
                    <span className="flex-1 min-w-0 text-sm text-ink truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setApprovalReceipts((prev) => ({
                          ...prev,
                          [t.transaction_id]: (prev[t.transaction_id] ?? []).filter((_, j) => j !== i)
                        }))
                      }
                      className="text-[12px] text-rust border border-rust rounded-full px-2.5 py-1 shrink-0"
                    >
                      Remove
                    </button>
                  </div>
                ))}

                <label
                  className={`flex items-center gap-3 px-4 py-3.5 cursor-pointer ${
                    showMissing && missingProof ? invalidRowClass : ""
                  }`}
                >
                  <span className="text-base shrink-0">{proofFiles.length > 0 ? "＋" : "📎"}</span>
                  <span className="flex-1 min-w-0 text-sm text-ink-soft">
                    <span className="block truncate">{proofFiles.length > 0 ? "Add another file" : "Proof of transfer"}</span>
                    {proofFiles.length === 0 && (
                      <span className="block text-[11px] text-ink-soft/70">Photos or PDFs — you can add more than one</span>
                    )}
                    {showMissing && missingProof && <FieldError message="Attach proof of the transfer" className="mt-1" />}
                  </span>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const picked = Array.from(e.target.files ?? [])
                      if (picked.length > 0) {
                        setApprovalReceipts((prev) => ({
                          ...prev,
                          [t.transaction_id]: [...(prev[t.transaction_id] ?? []), ...picked]
                        }))
                      }
                      // Reset so picking the same file again still fires onChange.
                      e.target.value = ""
                    }}
                  />
                </label>
              </div>

            </div>
            )}

            {(t.description || (!needsLoanBank && !needsWithdrawalBank) || receiptPaths(t).length > 0) && (
              <div className="mt-4 pt-4 border-t border-hairline space-y-2">
                {t.description && <p className="text-sm text-ink-soft">{t.description}</p>}
                {/* Withdrawal/Loan Release never have a bank on record yet at
                    this point -- that's exactly what the picker above is
                    for -- so this line would always read "Bank: None" right
                    next to a picker already showing what was just chosen,
                    contradicting it for no reason. Only worth showing for
                    types where the bank is already settled, not being
                    picked in this same sheet. */}
                {!needsLoanBank && !needsWithdrawalBank && (
                  <p className="text-sm text-ink-soft">
                    Bank: {t.bank_accounts?.account_name || t.bank_accounts?.bank_name || "None"}
                  </p>
                )}
                {receiptPaths(t).length > 0 && (
                  <ReceiptThumbs
                    paths={receiptPaths(t)}
                    label={isConfirmedMoney || t.classification === "Investment Return" ? "Member's receipt" : "Receipt"}
                    onOpen={(index) => setOpenReceipt({ paths: receiptPaths(t), index })}
                  />
                )}
              </div>
            )}
          </Sheet>
        )
      })()}

      {reviewingSignup && (
        <Sheet
          title="New signup"
          onClose={() => setReviewingSignupId(null)}
          footer={
            memberLinkChoice[reviewingSignup.member_id] ? (
              <button
                type="button"
                className="w-full bg-ink text-paper px-6 py-3.5 rounded-full text-base font-bold shadow-lg motion-safe:transition-transform motion-safe:active:scale-[0.97] disabled:opacity-50 disabled:shadow-none"
                onClick={() => linkMember(reviewingSignup.member_id)}
                disabled={memberBusyId === reviewingSignup.member_id}
              >
                {memberBusyId === reviewingSignup.member_id ? "Linking…" : "Link & approve"}
              </button>
            ) : (
              <button
                type="button"
                className="w-full bg-ink text-paper px-6 py-3.5 rounded-full text-base font-bold shadow-lg motion-safe:transition-transform motion-safe:active:scale-[0.97] disabled:opacity-50 disabled:shadow-none"
                onClick={() => approveMember(reviewingSignup.member_id)}
                disabled={memberBusyId === reviewingSignup.member_id}
              >
                {memberBusyId === reviewingSignup.member_id
                  ? "Approving…"
                  : unclaimedMembers.length > 0
                    ? "Approve as new member"
                    : "Approve"}
              </button>
            )
          }
        >
          <div className="card overflow-hidden">
            <FieldRow icon={<PersonIcon />}>
              <span className="flex-1 min-w-0 text-sm">
                <span className="font-semibold text-ink">{reviewingSignup.name}</span>
              </span>
            </FieldRow>
          </div>
          <p className="px-1 pt-2 text-xs text-ink-soft">
            {reviewingSignup.email} · {timeAgo(reviewingSignup.created_at)}
          </p>

          {unclaimedMembers.length > 0 && (
            <div className="mt-5">
              <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">
                Already a member?
              </p>
              <div className="card overflow-hidden">
                <FieldRow icon={<PersonIcon />}>
                  <select
                    className={rowSelectClass}
                    value={memberLinkChoice[reviewingSignup.member_id] || ""}
                    onChange={(e) =>
                      setMemberLinkChoice((prev) => ({ ...prev, [reviewingSignup.member_id]: e.target.value }))
                    }
                  >
                    <option value="">No, they&apos;re new</option>
                    {unclaimedMembers.map((um: any) => (
                      <option key={um.member_id} value={um.member_id}>
                        Yes, link to {um.name}
                      </option>
                    ))}
                  </select>
                </FieldRow>
              </div>
              <p className="px-1 pt-2 text-xs text-ink-soft">
                Linking moves this login onto their existing record, so their contributions, loans and
                investments carry over.
              </p>
            </div>
          )}
        </Sheet>
      )}

      {reviewingBorrower && (() => {
        const m = reviewingBorrower

        return (
          <Sheet
            title="Borrower request"
            onClose={() => setReviewingBorrowerId(null)}
            footer={
              <button
                type="button"
                className="w-full bg-ink text-paper px-6 py-3.5 rounded-full text-base font-bold shadow-lg motion-safe:transition-transform motion-safe:active:scale-[0.97] disabled:opacity-50 disabled:shadow-none"
                onClick={() => approveBorrower(m.member_id)}
                disabled={borrowerBusyId === m.member_id}
              >
                {borrowerBusyId === m.member_id ? "Approving…" : "Approve"}
              </button>
            }
          >
            <div className="card overflow-hidden">
              <FieldRow icon={<PersonIcon />}>
                <span className="flex-1 min-w-0 text-sm">
                  <span className="font-semibold text-ink">{m.name}</span>
                </span>
              </FieldRow>
            </div>
            <p className="px-1 pt-2 text-xs text-ink-soft">
              {m.email || "No email"} · requests borrower access · {timeAgo(m.created_at)}
            </p>
          </Sheet>
        )
      })()}

      {rejectingBulkTxn && (
        <Sheet
          title="Reject transaction"
          onClose={() => {
            setRejectingId(null)
            setRejectReason("")
          }}
        >
          <div className="card overflow-hidden mb-4">
            <FieldRow icon={<FlowBadge {...(FLOW[rejectingBulkTxn.classification] ?? { arrow: "•", tone: "in" })} small />}>
              <span className="flex-1 min-w-0 text-sm">
                <span className="font-semibold text-ink">{rejectingBulkTxn.members?.name || "Fund"}</span>
                <span className="text-ink-soft"> · {typeLabels[rejectingBulkTxn.classification] || rejectingBulkTxn.classification}</span>
              </span>
              <span className="shrink-0 text-sm font-mono">{Number(rejectingBulkTxn.amount) < 0 ? "−" : ""}₱{fmt(Math.abs(rejectingBulkTxn.amount))}</span>
            </FieldRow>
          </div>

          <RejectReasonPrompt
            reason={rejectReason}
            onChangeReason={setRejectReason}
            onCancel={() => {
              setRejectingId(null)
              setRejectReason("")
            }}
            onConfirm={() => rejectTransaction(rejectingBulkTxn.transaction_id, rejectReason)}
          />
        </Sheet>
      )}

      {showSearchFix && <SearchFixSheet onClose={() => setShowSearchFix(false)} />}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      {openReceipt && (
        <ReceiptModal paths={openReceipt.paths} startIndex={openReceipt.index} onClose={() => setOpenReceipt(null)} />
      )}
    </>
  )
}

// Inline reason box shown under a row once its Reject button is clicked.
// The reason is saved on the transaction and pushed to the submitter as
// part of their "not approved" notification, so it's optional but
// encouraged -- rejecting with nothing typed still goes through.
function RejectReasonPrompt({
  reason,
  onChangeReason,
  onCancel,
  onConfirm
}: {
  reason: string
  onChangeReason: (value: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <>
      <p className="mb-1.5 text-xs uppercase tracking-wide text-ink-soft font-mono">
        Reason (shown to the submitter)
      </p>
      <textarea
        autoFocus
        rows={2}
        value={reason}
        onChange={(e) => onChangeReason(e.target.value)}
        placeholder="e.g. Receipt doesn't match the amount"
        className="w-full border border-hairline rounded-md px-3.5 py-3 text-sm bg-paper-2 mb-3"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 border border-hairline text-ink-soft px-5 py-3.5 rounded-full text-base font-semibold"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="flex-1 bg-rust text-paper px-6 py-3.5 rounded-full text-base font-bold motion-safe:transition-transform motion-safe:active:scale-[0.97]"
        >
          Confirm reject
        </button>
      </div>
    </>
  )
}

// Short tag on a queue row whose approval won't move any bank balance --
// replaces a trailing phrase that got cut off on narrow screens.
function ImpactTag({ impact }: { impact: TxnImpact }) {
  if (impact.kind !== "none") return null
  return (
    <span className="shrink-0 text-[9px] uppercase tracking-wide font-mono text-gold border border-gold/40 rounded px-1.5 py-0.5">
      {impact.reason === "no_bank" ? "No bank" : "No cash"}
    </span>
  )
}

function FlagChips({ flags }: { flags: QueueFlag[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <span
          key={f.label}
          className={`text-[9px] uppercase tracking-wide font-mono rounded px-1.5 py-0.5 border ${
            f.tone === "warn" ? "text-rust border-rust/50 bg-rust/5" : "text-gold border-gold/40"
          }`}
        >
          {f.label}
        </span>
      ))}
    </span>
  )
}

// The lines under a queue card's date: balance or loan context, the
// member's own note, and anything worth a second look before approving.
function QueueCardExtras({ context, note, flags }: { context: string | null; note?: string | null; flags: QueueFlag[] }) {
  if (!context && !note && flags.length === 0) return null
  return (
    <>
      {context && <span className="block text-[11px] text-ink font-mono truncate">{context}</span>}
      {note && <span className="block text-[11px] text-ink-soft italic truncate">&ldquo;{note}&rdquo;</span>}
      {flags.length > 0 && (
        <span className="block mt-1">
          <FlagChips flags={flags} />
        </span>
      )}
    </>
  )
}
