"use client"

// Admin escape hatch for fixing a mistake on an existing transaction --
// wrong amount, bank, date, receipt, or status -- regardless of who owns
// it or whether it's still pending. Deliberately narrower than the normal
// edit flow: only the core recorded fields are editable here, never the
// classification or its member/loan/investment links, and it never runs
// the side effects the real approve/reject buttons do (activating a loan,
// snapshotting a hold, etc.) -- this is for correcting what's on record,
// not a substitute for the normal approval workflow.
//
// "Gain Allocation" rows are generated from loan_gain_allocations /
// investment_allocations / bank_interest_allocations, not entered
// directly, so editing one here wouldn't touch its source table and would
// just create a new inconsistency -- they show up in search but can't be
// opened for editing.

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { receiptPaths, removeReceipts, uploadReceipts } from "@/lib/receiptUrl"
import {
  FlowBadge,
  FieldRow,
  ReceiptsField,
  DateField,
  BankIcon,
  NoteIcon,
  StatusIcon,
  FieldError,
  rowSelectClass,
  rowInputClass
} from "@/app/components/TransactionFormUI"
import { TRANSACTION_TYPE_LABELS as typeLabels } from "@/lib/transactionLabels"
import { Sheet } from "@/app/components/Sheet"

// Same in/out vocabulary as the transaction edit sheet's own FLOW map --
// this panel deals in raw classification strings the same way, just with
// its own local copy since importing admin/page.tsx's would reach across
// an unrelated module for four lines.
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

const STATUS_OPTIONS = ["pending", "approved", "rejected", "cancelled"]

// Same thousands-comma display as TransactionFormUI's AmountHero, but sign-
// aware -- this is the one amount field in the app that shows the raw
// stored value "as stored, including sign" (outflows are negative), so it
// can't reuse AmountHero directly: that component's own strip function
// throws away any "-" as just another non-digit character, which would
// silently flip a negative amount positive the moment someone touched it.
function formatSignedAmountDisplay(raw: string): string {
  if (!raw) return ""
  const negative = raw.startsWith("-")
  const unsigned = negative ? raw.slice(1) : raw
  const dotIndex = unsigned.indexOf(".")
  const intPart = dotIndex === -1 ? unsigned : unsigned.slice(0, dotIndex)
  const decPart = dotIndex === -1 ? "" : unsigned.slice(dotIndex)
  return (negative ? "-" : "") + intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + decPart
}

function stripSignedAmountFormatting(raw: string): string {
  const negative = raw.trim().startsWith("-")
  const cleaned = raw.replace(/[^\d.]/g, "")
  const firstDot = cleaned.indexOf(".")
  const digits = firstDot === -1 ? cleaned : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "")
  return negative ? `-${digits}` : digits
}

// Legacy migrated rows carry the bank as plain text in `bank` rather than a
// real link via `bank_account_id` -- and the list display prefers that
// legacy text whenever it's present (see bankBadge on the Transactions
// page), so editing bank_account_id alone here would silently do nothing
// visible. Best-effort match the legacy text to a real bank account so the
// dropdown starts pre-filled with the obvious fix instead of "No bank
// linked".
function matchLegacyBankText(banks: BankAccount[], legacyText: string | null): BankAccount | null {
  if (!legacyText) return null
  const needle = legacyText.trim().toLowerCase()
  return (
    banks.find(
      (b) => b.bank_name.toLowerCase() === needle || (b.account_name ?? "").toLowerCase() === needle
    ) ?? null
  )
}

const statusColor: Record<string, string> = {
  pending: "text-gold",
  approved: "text-sage",
  rejected: "text-rust",
  cancelled: "text-ink-soft"
}

type BankAccount = { id: string; bank_name: string; account_name: string | null }

export function SupportPanel() {
  const [loading, setLoading] = useState(true)
  const [transactions, setTransactions] = useState<any[]>([])
  const [banks, setBanks] = useState<BankAccount[]>([])
  const [loadError, setLoadError] = useState("")
  const [query, setQuery] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)

  // Loaded once, when this tab is actually opened (this component only
  // mounts then) -- not up front with the rest of Admin's data, since this
  // pulls every transaction regardless of status (unlike the Txns tab's
  // pending-only query) and isn't needed until someone opens Support.
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load() {
    setLoading(true)
    setLoadError("")

    const [txnsResult, banksResult] = await Promise.all([
      supabase
        .from("transactions")
        .select(
          `
          *,
          members!transactions_member_id_fkey ( name ),
          loans!transactions_loan_id_fkey ( name, status ),
          investments!transactions_investment_id_fkey ( name ),
          bank_accounts!transactions_bank_account_id_fkey ( bank_name, account_name )
        `
        )
        .order("txn_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .range(0, 4999),
      supabase.from("bank_accounts").select("id, bank_name, account_name").order("bank_name")
    ])

    if (txnsResult.error) {
      setLoadError(txnsResult.error.message)
      setLoading(false)
      return
    }

    setTransactions(txnsResult.data ?? [])
    setBanks((banksResult.data as BankAccount[]) ?? [])
    setLoading(false)
  }

  const results = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (words.length === 0) return []

    return transactions
      .filter((t) => {
        const haystack = [
          t.members?.name,
          t.description,
          t.bank,
          t.bank_accounts?.bank_name,
          t.bank_accounts?.account_name,
          t.classification,
          typeLabels[t.classification],
          t.loans?.name,
          t.investments?.name,
          t.status,
          String(t.amount),
          t.txn_date
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()

        return words.every((w) => haystack.includes(w))
      })
      .slice(0, 30)
  }, [transactions, query])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const editingTxn = transactions.find((t) => t.transaction_id === editingId) ?? null

  // Collapsed once there's an actual query, not just on focus -- focusing
  // alone (before typing anything) has no results to show yet, so hiding
  // the intro right then left a blank gap between the input and the
  // keyboard instead of the results it was meant to make room for. Once
  // you start typing, the intro isn't useful anymore and results fill
  // that space instead.
  const searchActive = query.trim().length > 0

  // min-h keeps the sheet itself from resizing when the intro collapses
  // or results come and go -- Sheet's own panel has no explicit height,
  // just a max-height cap, so it otherwise shrinks to fit whatever's
  // here (four lines of intro one moment, an empty results list the
  // next) and visibly pops taller/shorter as you type. Pinning this
  // section to roughly the sheet's usual full extent means that growth
  // already happened before you ever focus the field.
  return (
    <section className="mt-6 min-h-[65dvh]">
      {!searchActive && (
        <p className="text-[13px] text-ink-soft mb-4">
          Find any transaction, regardless of who it belongs to or its status, to fix a mistake -- wrong amount,
          bank, date, receipt, or status. This only corrects what&apos;s on record; it doesn&apos;t run approval
          side effects like activating a loan, so use the Approvals tab for routine approvals.
        </p>
      )}

      {loading && <p className="text-sm text-ink-soft">Loading…</p>}
      {loadError && <p className="text-sm text-rust">Couldn&apos;t load transactions: {loadError}</p>}

      {!loading && !loadError && (
        <>
          <input
            className="border border-hairline bg-paper-2 text-ink text-sm rounded-md px-3 py-2.5 w-full"
            placeholder="Search by member, bank, description, amount, date…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {query.trim() && (
            <p className="text-xs text-ink-soft mt-2">
              {results.length} match{results.length === 1 ? "" : "es"}
              {results.length === 30 ? " (showing first 30)" : ""}
            </p>
          )}

          <div className="mt-3 flex flex-col gap-3">
            {results.map((t) => (
              <SupportRow key={t.transaction_id} t={t} fmt={fmt} onOpen={() => setEditingId(t.transaction_id)} />
            ))}
          </div>
        </>
      )}

      {/* Fixing a row opens as its own sheet, stacked on top of this one
          (Sheet's body-lock effect captures/restores whatever was already
          locked, so this nests cleanly), rather than expanding the form in
          place underneath the row -- pushing every row below it down and
          fighting for space inside this sheet's own scroll area. */}
      {editingTxn && (
        <SupportEditForm
          t={editingTxn}
          banks={banks}
          onSaved={(updated) => {
            setTransactions((rows) =>
              rows.map((r) => (r.transaction_id === updated.transaction_id ? { ...r, ...updated } : r))
            )
            setEditingId(null)
          }}
          onCancel={() => setEditingId(null)}
        />
      )}
    </section>
  )
}

function SupportRow({
  t,
  fmt,
  onOpen
}: {
  t: any
  fmt: (n: number) => string
  onOpen: () => void
}) {
  const isGainAllocation = t.classification === "Gain Allocation"
  const displayName = t.members?.name || t.loans?.name || t.investments?.name || "Fund"

  const row = (
    <div className="min-w-0 flex items-center justify-between gap-3 flex-1">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap mb-1">
          <span className="text-[9px] uppercase tracking-widest font-mono border border-hairline text-ink-soft rounded-full px-2 py-0.5">
            {typeLabels[t.classification] || t.classification}
          </span>
          <span className={`text-[9px] uppercase font-mono ${statusColor[t.status] ?? "text-ink-soft"}`}>
            {t.status}
          </span>
        </div>
        <p className="text-sm text-ink truncate">{displayName}</p>
        <p className="text-[11px] text-ink-soft font-mono">{t.txn_date ?? t.created_at?.slice(0, 10)}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-ink whitespace-nowrap">
          ₱{fmt(Math.abs(Number(t.amount)))}
        </p>
        {!isGainAllocation && <p className="text-[11px] text-gold mt-0.5">Fix →</p>}
      </div>
    </div>
  )

  return (
    <div className="card">
      {isGainAllocation ? (
        <div className="flex items-center gap-3 px-4 py-3">{row}</div>
      ) : (
        <button type="button" onClick={onOpen} className="w-full flex items-center gap-3 px-4 py-3 text-left">
          {row}
        </button>
      )}

      {isGainAllocation && (
        <p className="px-4 pb-3 text-[11px] text-ink-soft">
          Generated from a loan/investment/bank interest distribution -- fix the source allocation instead of
          this row.
        </p>
      )}
    </div>
  )
}

function SupportEditForm({
  t,
  banks,
  onSaved,
  onCancel
}: {
  t: any
  banks: BankAccount[]
  onSaved: (updated: any) => void
  onCancel: () => void
}) {
  const [amount, setAmount] = useState(String(t.amount))
  const [description, setDescription] = useState(t.description ?? "")
  const legacyBankMatch = useMemo(() => matchLegacyBankText(banks, t.bank), [banks, t.bank])
  const [bankAccountId, setBankAccountId] = useState(t.bank_account_id ?? legacyBankMatch?.id ?? "")
  const [txnDate, setTxnDate] = useState(t.txn_date ?? "")
  const [status, setStatus] = useState(t.status)
  const [rejectionReason, setRejectionReason] = useState(t.rejection_reason ?? "")
  const [receipts, setReceipts] = useState<File[]>([])
  // The row's current files, minus any the admin removes here -- the
  // removed ones get deleted from storage once the save commits.
  const originalReceipts = receiptPaths(t)
  const [keptReceipts, setKeptReceipts] = useState<string[]>(originalReceipts)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")


  async function save() {
    const amountNum = Number(amount)
    if (amount.trim() === "" || Number.isNaN(amountNum)) {
      setMessage("Enter a valid amount.")
      return
    }

    // Withdrawal and Loan Release move real money out, and their receipt is
    // proof of the actual transfer amount -- changing the amount without
    // attaching a new receipt would leave one on file that no longer
    // matches what's recorded. Only applies once the row is actually
    // approved -- a still-pending Withdrawal or still-requested Loan
    // Release never had a receipt in the first place (nothing's moved yet),
    // so demanding one to fix a typo before that point would be asking for
    // proof of a transfer that hasn't happened.
    const isMoneyOut =
      t.status === "approved" && (t.classification === "Member Withdrawal" || t.classification === "Loan Release")
    if (isMoneyOut && amountNum !== Number(t.amount) && receipts.length === 0) {
      setMessage("Amount changed for a withdrawal/loan disbursement -- attach an updated receipt before saving.")
      return
    }

    // This tool deliberately never activates a loan or snapshots a hold --
    // setting a still-"requested" loan's Loan Release to "approved" here
    // would leave the loan stuck at "requested" (with a reachable but
    // now-unusable "Approve & Activate", since that flow requires a
    // *pending* Loan Release transaction and this one would already be
    // "approved") with no path back through the UI. Approving a
    // disbursement always has to go through the real approval flow so the
    // loan and hold snapshot move together with it.
    if (t.classification === "Loan Release" && status === "approved" && t.loans?.status === "requested") {
      setMessage(
        "Can't approve a loan disbursement here -- it wouldn't activate the loan or snapshot the hold. Use the Approvals tab or the loan's own \"Approve & Activate\" instead."
      )
      return
    }

    // Moving a still-unapproved Loan Release to rejected/cancelled here
    // needs the same fix the normal admin reject button and the member's
    // own "Cancel entry" flow already apply: null the transaction's
    // loan_id (transactions.loan_id has a non-cascading foreign key into
    // loans) and delete the now-unreferenced loan -- otherwise it's
    // stranded at "requested" forever with a reachable "Approve &
    // Activate" that would activate it with nothing actually disbursed.
    // Only safe while the loan is still "requested": once it's active or
    // closed it has repayments, a hold snapshot, maybe a gain split, and
    // deleting it would destroy real data, so this tool leaves it alone
    // in that case.
    const isUnapprovedLoanRelease =
      t.classification === "Loan Release" &&
      t.loan_id &&
      t.loans?.status === "requested" &&
      (status === "rejected" || status === "cancelled")

    setSaving(true)
    setMessage("")

    const { paths: uploadedReceipts, error: uploadError } = await uploadReceipts(receipts, t.transaction_id)
    if (uploadError) {
      setSaving(false)
      setMessage(uploadError)
      return
    }
    const nextReceipts = [...keptReceipts, ...uploadedReceipts]

    const updates: Record<string, unknown> = {
      amount: amountNum,
      description: description || null,
      bank_account_id: bankAccountId || null,
      // Once a real bank account is linked, clear the legacy free-text
      // bank -- the list display prefers that text over the link whenever
      // it's present, so leaving it would make this fix invisible.
      bank: bankAccountId ? null : t.bank,
      txn_date: txnDate || null,
      status,
      // Only meaningful while rejected -- clears itself the moment status
      // moves elsewhere, same as the normal Reject button never leaving a
      // stale reason behind on a transaction that's since been approved.
      rejection_reason: status === "rejected" ? rejectionReason.trim() || null : null,
      receipt_urls: nextReceipts
    }
    if (isUnapprovedLoanRelease) updates.loan_id = null

    const { data, error } = await supabase
      .from("transactions")
      .update(updates)
      .eq("transaction_id", t.transaction_id)
      .select(
        `
        *,
        members!transactions_member_id_fkey ( name ),
        loans!transactions_loan_id_fkey ( name, status ),
        investments!transactions_investment_id_fkey ( name ),
        bank_accounts!transactions_bank_account_id_fkey ( bank_name, account_name )
      `
      )
      .single()

    if (error) {
      setSaving(false)
      // The new receipts already uploaded successfully above -- if the
      // update they belong to failed, clean them up rather than leaving
      // them orphaned in the bucket. The original files are untouched
      // since the update never committed.
      await removeReceipts(uploadedReceipts)
      setMessage(error.message)
      return
    }

    // The update above already committed the new receipt list, so any
    // original file removed here is now unreferenced -- clean it up rather
    // than leaving it orphaned in the bucket. Best-effort: a failure here
    // doesn't affect the save that already succeeded.
    await removeReceipts(originalReceipts.filter((p) => !nextReceipts.includes(p)))

    if (isUnapprovedLoanRelease) {
      const { error: loanError } = await supabase.from("loans").delete().eq("loan_id", t.loan_id)
      if (loanError) {
        setSaving(false)
        setMessage(loanError.message)
        return
      }
    } else if (t.classification === "Loan Release" && t.loan_id && amountNum !== Number(t.amount)) {
      // loans.principal drives total_repayable/outstanding/gain everywhere
      // (v_loan_summary, the close-loan gain split, etc.) -- none of that
      // reads transactions.amount directly, so fixing only the transaction
      // here would be cosmetic-only in the ledger and never reach the
      // number that actually matters financially. Loan Release amounts are
      // stored negative; principal is always positive.
      const { error: loanError } = await supabase
        .from("loans")
        .update({ principal: Math.abs(amountNum) })
        .eq("loan_id", t.loan_id)
      if (loanError) {
        setSaving(false)
        setMessage(loanError.message)
        return
      }
    }

    setSaving(false)
    onSaved(data)
  }

  const displayName = t.members?.name || t.loans?.name || t.investments?.name || "Fund"

  return (
    <Sheet
      title="Fix transaction"
      onClose={onCancel}
      footer={
        <>
          {message && <p className="text-sm text-rust mb-3">{message}</p>}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="shrink-0 border border-hairline text-ink-soft px-5 py-3.5 rounded-full text-base font-semibold disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              className="flex-1 bg-ink text-paper px-6 py-3.5 rounded-full text-base font-bold shadow-lg motion-safe:transition-transform motion-safe:active:scale-[0.97] disabled:opacity-50 disabled:shadow-none"
              onClick={save}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save fix"}
            </button>
          </div>
        </>
      }
    >
      <div className="card overflow-hidden">
        <FieldRow icon={<FlowBadge {...(FLOW[t.classification] ?? { arrow: "•", tone: "in" })} small />}>
          <span className="flex-1 min-w-0 text-sm">
            <span className="text-ink">{displayName}</span>
            <span className="text-ink-soft"> · {typeLabels[t.classification] || t.classification}</span>
          </span>
          <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide font-mono ${statusColor[t.status] ?? "text-ink-soft"}`}>
            {t.status}
          </span>
        </FieldRow>
      </div>

      {t.classification === "Bank Interest" && t.interest_distributed && (
        <p className="text-[11px] text-gold bg-gold/10 border border-gold rounded-md px-3 py-2 mt-4">
          This interest has already been split across members. Changing the amount here only corrects this
          transaction -- it won&apos;t update what members were already credited in bank_interest_allocations.
        </p>
      )}

      <div className="text-center pt-2 pb-5">
        <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2">
          Amount (as stored, including sign)
        </p>
        <div className="flex items-center justify-center gap-1.5">
          <span className="font-mono text-3xl font-bold text-ink-soft">₱</span>
          <input
            type="text"
            inputMode="decimal"
            value={formatSignedAmountDisplay(amount)}
            onChange={(e) => setAmount(stripSignedAmountFormatting(e.target.value))}
            className="text-size-intentional font-mono [font-variant-numeric:tabular-nums] text-4xl font-bold text-ink bg-transparent text-center w-full max-w-[220px] focus:outline-none"
          />
        </div>
        {message === "Enter a valid amount." && <FieldError message="Enter an amount" className="text-sm mt-2" />}
      </div>

      <div>
        <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">Details</p>
        <div className="card divide-y divide-hairline overflow-hidden">
          <DateField value={txnDate ?? ""} onChange={setTxnDate} placeholder="Date" bare />

          <FieldRow icon={<BankIcon />}>
            <select className={rowSelectClass} value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
              <option value="">No bank linked</option>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.account_name || b.bank_name}
                </option>
              ))}
            </select>
            <span className="text-ink-soft text-xs shrink-0 pointer-events-none">▾</span>
          </FieldRow>

          <FieldRow icon={<StatusIcon />}>
            <select className={rowSelectClass} value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <span className="text-ink-soft text-xs shrink-0 pointer-events-none">▾</span>
          </FieldRow>

          <FieldRow icon={<NoteIcon />}>
            <input
              className={rowInputClass}
              placeholder="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </FieldRow>
        </div>

        {t.bank_account_id == null && t.bank && (
          <p className="px-1 pt-2 text-sm text-ink-soft">
            {legacyBankMatch
              ? `Currently showing "${t.bank}" as legacy text on the list -- pre-filled with the matching account above; saving will switch it to a real link.`
              : `Currently showing "${t.bank}" as legacy text on the list, with no matching bank account -- pick one above to link it properly, or leave as-is to keep the text.`}
          </p>
        )}
      </div>

      {status === "rejected" && (
        <div className="mt-4">
          <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">
            Rejection reason (shown to the submitter)
          </p>
          <textarea
            className="border border-hairline bg-paper-2 text-ink text-sm rounded-md px-3.5 py-3 w-full"
            rows={2}
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            placeholder="e.g. Receipt doesn't match the amount"
          />
        </div>
      )}

      <div className="mt-4">
        <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">Receipt</p>
        <ReceiptsField
          files={receipts}
          onAddFiles={(added) => setReceipts((prev) => [...prev, ...added])}
          onRemoveFile={(i) => setReceipts((prev) => prev.filter((_, j) => j !== i))}
          existingPaths={keptReceipts}
          onRemoveExisting={(path) => setKeptReceipts((prev) => prev.filter((p) => p !== path))}
        />
      </div>
    </Sheet>
  )
}
