"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Sheet } from "@/app/components/Sheet"
import { ReviewRow } from "@/app/components/TransactionFormUI"
import { ReceiptThumbs } from "@/app/components/admin/ReceiptThumb"
import { receiptPaths } from "@/lib/receiptUrl"
import { AdminActionRow } from "@/app/components/breakdown/AdminMenu"
import { TRANSACTION_TYPE_LABELS as typeLabels } from "@/lib/transactionLabels"
import { bankAccountLabel } from "@/lib/transactionsSnapshot"
import { listTransactionConversations } from "@/lib/conversations"

// The pieces of the Transactions page that describe one row: how it reads
// in the list, its detail sheet, and who may edit it.

// A loaded transactions row with its joined member/loan/investment/bank
// fields -- the page has always handled these untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Txn = any

export const typeColor: Record<string, string> = {
  "Member Contribution": "text-sage",
  "Member Withdrawal": "text-rust",
  "Expense": "text-rust",
  "Loan Release": "text-gold",
  "Loan Repayment": "text-gold",
  "Gain Allocation": "text-slate",
  "Bank Interest": "text-sage",
  "Investment Return": "text-sage",
  "Investment": "text-gold",
  "Tax": "text-rust",
  "Bank Write-off": "text-rust"
}

// A transaction's real-world date is txn_date. created_at is a row-insert
// audit timestamp and only happens to match txn_date for migrated rows
// because the migration script set it that way -- it's not guaranteed to
// stay in sync (e.g. manual edits, backfills). Always prefer txn_date,
// falling back to created_at only for rows that genuinely have no txn_date.
export function effectiveDate(transaction: Txn): Date {
  return new Date(transaction.txn_date ?? transaction.created_at)
}

export function monthLabel(transaction: Txn): string {
  return effectiveDate(transaction).toLocaleDateString(undefined, { month: "long", year: "numeric" })
}

// Fixed "05 Jan" shape regardless of locale, instead of a raw
// toLocaleDateString() that silently flips between D/M/Y and M/D/Y
// depending on the device's region settings. The month header above each
// group already carries the year, so day + short month is enough here.
export function cardDate(transaction: Txn): string {
  return effectiveDate(transaction).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
}

function fullDate(transaction: Txn): string {
  return effectiveDate(transaction).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
}

// The bank(s) a row moves, keyed exactly as v_cash_ledger keys them --
// COALESCE(t.bank, account_name, bank_name) for the row's own bank, plus the
// destination for an Internal Transfer -- so ?bank= lists the same entries
// that bank's balance is built from.
type BankRef = { bank_name?: string | null; account_name?: string | null } | null | undefined
export function ledgerBankKeys(t: { bank?: string | null; from_bank_account?: BankRef; to_bank_account?: BankRef }): string[] {
  const from = t.bank || t.from_bank_account?.account_name || t.from_bank_account?.bank_name || null
  const to = t.to_bank_account?.account_name || t.to_bank_account?.bank_name || null
  return [from, to].filter((k): k is string => !!k)
}

// ~75% of rows have a description that's just the member's name typed back
// (sometimes via an old alias like "Ekai"/"Ketty"/"Bors" -- member_id is
// already resolved correctly for those, so the raw text adds nothing once
// the member's name is the card title).
function isRedundantDescription(description: string | null, memberName: string | null): boolean {
  if (!description || !memberName) return false
  return description.trim().toLowerCase() === memberName.trim().toLowerCase()
}

// Tax and Bank Interest rows have no member -- their description ("tax",
// "interest", "maya interest") was the only way to tell them apart before
// the type and bank were shown. Member Contribution and Member Withdrawal
// descriptions are, in practice, always just the member's name. Loan and
// transfer rows get their own richer line instead of the raw description.
const CLASSIFICATIONS_WITH_HIDDEN_DESCRIPTION = new Set([
  "Member Contribution",
  "Member Withdrawal",
  "Bank Interest",
  "Tax"
])

export type TxnView = {
  displayName: string
  typeLabel: string
  typeColorClass: string
  // Money into the fund (+1), out of it (-1), or a move between its own
  // banks (0) -- the amount's own sign, which is stored from the fund's
  // side for every classification.
  direction: 1 | -1 | 0
  bank: string | null
  transferLabel: string | null
  // One short extra line: the loan, investment, gain source or a note.
  detail: string | null
  description: string | null
}

export function describeTransaction(t: Txn): TxnView {
  const memberName = t.members?.name || null
  const isLoanTxn = t.classification === "Loan Release" || t.classification === "Loan Repayment"
  const isTransferTxn = t.classification === "Internal Transfer"
  const isGainAllocation = t.classification === "Gain Allocation"
  const loanName = t.loans?.name || null
  const borrowerName = t.loans?.borrowers?.name || null
  const investmentName = t.investments?.name || null

  // Bank interest Gain Allocation rows have no relational bank/year field
  // (legacy data) -- both only exist embedded in the description, which
  // follows one exact template for every such row, so it's safe to parse.
  const gainBankMatch =
    isGainAllocation && !loanName && !investmentName
      ? t.description?.match(/^Share of (\d{4}) (.+) bank interest$/) ?? null
      : null
  // loanName is "{Borrower} · {year-month}" -- the year-month alone reads
  // as which loan it was.
  const loanDate = loanName?.match(/(\d{4}-\d{2})$/)?.[1] ?? null

  const gainDetail = !isGainAllocation
    ? null
    : loanName
      ? `Loan · ${loanDate} · ${borrowerName ?? ""}`.replace(/ · $/, "")
      : gainBankMatch
        ? `Interest · ${gainBankMatch[1]} · ${gainBankMatch[2]}`
        : null

  const showDescription =
    !!t.description &&
    !isRedundantDescription(t.description, memberName) &&
    !CLASSIFICATIONS_WITH_HIDDEN_DESCRIPTION.has(t.classification) &&
    !isLoanTxn &&
    !isTransferTxn &&
    !(isGainAllocation && (gainDetail || investmentName))

  const detail =
    gainDetail ??
    (investmentName ? `Investment · ${investmentName}` : null) ??
    (isLoanTxn && loanDate ? `Loan · ${loanDate}` : null) ??
    (showDescription ? t.description : null)

  const amount = Number(t.amount)
  return {
    // Borrower-only loans have no member_id, so fall back to the
    // borrower's name instead of the generic "Fund".
    displayName: memberName || (isLoanTxn ? borrowerName : null) || "Fund",
    typeLabel: typeLabels[t.classification] || t.classification,
    typeColorClass: isGainAllocation ? (amount < 0 ? "text-rust" : "text-sage") : typeColor[t.classification] ?? "text-ink-soft",
    direction: isTransferTxn || amount === 0 ? 0 : amount > 0 ? 1 : -1,
    bank: isTransferTxn ? null : t.bank || bankAccountLabel(t.from_bank_account) || null,
    transferLabel: isTransferTxn ? t._transferLabel ?? null : null,
    detail,
    description: showDescription ? t.description : null
  }
}

// Member-submitted entries: editable by their owner while still pending,
// or after a rejection -- editing a rejected row resubmits it. Loan Release
// is excluded from self-service editing (it's paired with a loans row a
// member has no rights to touch), but an admin can edit it while pending.
// Admin entries (Bank Interest/Expense/Bank Transfer/Investment) are
// editable by whichever admin recorded them (older entries with no
// submitted_by by any admin). An admin-recorded Investment Return has no
// member; a member's own pending one is excluded so it can't bypass review.
export function canEditTransaction(t: Txn, memberId: string | null | undefined, isAdmin: boolean): boolean {
  return (
    ((t.status === "pending" || t.status === "rejected") &&
      t.member_id === memberId &&
      t.classification !== "Loan Release") ||
    (isAdmin &&
      ((["Bank Interest", "Expense", "Internal Transfer", "Investment"].includes(t.classification) &&
        (t.submitted_by == null || t.submitted_by === memberId)) ||
        (t.classification === "Investment Return" &&
          t.member_id == null &&
          (t.submitted_by == null || t.submitted_by === memberId)) ||
        (t.classification === "Loan Release" && t.status === "pending")))
  )
}

const fmt = (n: number) =>
  Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function formatSigned(amount: number, direction: 1 | -1 | 0): string {
  const sign = direction === 1 ? "+" : direction === -1 ? "−" : ""
  return `${sign}₱${fmt(Math.abs(amount))}`
}

const statusTone: Record<string, string> = {
  pending: "text-gold border-gold",
  rejected: "text-rust border-rust"
}

function StatusTag({ status }: { status: string }) {
  if (status === "approved") return null
  return (
    <span className={`shrink-0 text-[10px] uppercase font-mono border rounded-full px-2 py-0.5 ${statusTone[status] ?? "text-ink-soft border-hairline"}`}>
      {status}
    </span>
  )
}

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5 shrink-0" aria-label="Has receipt">
      <path d="M21 11.5l-8.5 8.5a5 5 0 01-7-7L14 4.5a3.5 3.5 0 015 5L10.5 18a2 2 0 01-3-3L15 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Kinds of entry that bring money into the fund. Only these show their
// amount in green -- the sign itself always follows the stored amount (it's
// what the bank balances are built from), but a positive Tax or a negative
// Bank Interest adjustment shouldn't read as income.
const MONEY_IN = new Set(["Member Contribution", "Loan Repayment", "Bank Interest", "Investment Return", "Opening Balance"])

function amountToneFor(t: Txn, v: TxnView): string {
  if (v.direction === 0) return "text-ink-soft"
  const isGainShare = t.classification === "Gain Allocation"
  return v.direction === 1 && (MONEY_IN.has(t.classification) || isGainShare) ? "text-sage" : "text-ink"
}

// Without onOpen it renders as a plain card (e.g. on a borrower's chat
// thread, where there's no transaction screen to open).
export function TransactionRow({ t, onOpen }: { t: Txn; onOpen?: () => void }) {
  const v = describeTransaction(t)
  const amountTone = amountToneFor(t, v)
  const Root = onOpen ? "button" : "div"
  return (
    <Root
      {...(onOpen ? { type: "button" as const, onClick: onOpen } : {})}
      className="w-full card px-4 py-3 text-left flex flex-col gap-0.5"
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="font-display text-[17px] font-semibold truncate min-w-0">{v.displayName}</span>
        <span className={`font-mono [font-variant-numeric:tabular-nums] text-[17px] font-bold whitespace-nowrap ${amountTone}`}>
          {v.direction === 0 && <span className="text-ink-soft mr-1">⇄</span>}
          {formatSigned(Number(t.amount), v.direction)}
        </span>
      </span>
      <span className="flex items-center justify-between gap-3 text-xs">
        <span className="truncate min-w-0 text-ink-soft">
          <span className={`font-semibold ${v.typeColorClass}`}>{v.typeLabel}</span>
          {" · "}
          {cardDate(t)}
          {v.bank && ` · ${v.bank}`}
          {v.transferLabel && ` · ${v.transferLabel}`}
        </span>
        <span className="flex items-center gap-1.5 shrink-0 text-ink-soft">
          {receiptPaths(t).length > 0 && <PaperclipIcon />}
          <StatusTag status={t.status} />
        </span>
      </span>
      {t.status === "rejected" && t.rejection_reason ? (
        <span className="text-xs text-rust truncate">{t.rejection_reason}</span>
      ) : (
        v.detail && <span className="text-xs text-ink-soft font-mono truncate">{v.detail}</span>
      )}
    </Root>
  )
}

const primaryButton =
  "w-full bg-ink text-paper px-6 py-3.5 rounded-full text-base font-bold shadow-lg motion-safe:transition-transform motion-safe:active:scale-[0.97]"

// Everything about one transaction, plus where to go from it: its
// receipt, the loan/investment/bank it belongs to, and editing it (or, for
// an admin, reviewing it in the Admin queue) when that's allowed.
export function TransactionDetailSheet({
  t,
  memberId,
  isAdmin,
  onClose,
  onEdit,
  onOpenReceipt
}: {
  t: Txn
  memberId: string | null | undefined
  isAdmin: boolean
  onClose: () => void
  onEdit: () => void
  onOpenReceipt: (paths: string[], index: number) => void
}) {
  const router = useRouter()
  const v = describeTransaction(t)
  const receipts = receiptPaths(t)
  const canEdit = canEditTransaction(t, memberId, isAdmin)
  const isTransfer = t.classification === "Internal Transfer"
  const bankKey = !isTransfer ? ledgerBankKeys(t)[0] ?? null : null
  const amountTone = amountToneFor(t, v)
  const reviewInQueue = isAdmin && t.status === "pending" && !canEdit

  const links: { label: string; hint: string; onClick: () => void }[] = []
  if (t.loan_id)
    links.push({ label: "Open loan", hint: t.loans?.name ?? "See this loan's terms and payments", onClick: () => router.push(`/fund-breakdown?tab=loans&loan=${t.loan_id}`) })
  if (t.investment_id)
    links.push({ label: "Open investment", hint: t.investments?.name ?? "See this investment", onClick: () => router.push(`/fund-breakdown?tab=investments&investment=${t.investment_id}`) })
  if (bankKey && t.status === "approved")
    links.push({ label: `Open ${bankKey}`, hint: "See this bank's balance and activity", onClick: () => router.push(`/fund-breakdown?tab=banks&bank=${encodeURIComponent(bankKey)}`) })
  if (reviewInQueue)
    links.push({ label: "Review in Admin queue", hint: "Approve or reject this entry", onClick: () => router.push(`/admin?review=${t.transaction_id}`) })

  // Chats about this row. An existing thread with the person on the other
  // side is opened rather than offering to start a second one; otherwise
  // members ask the admins, and admins message whoever the row belongs to
  // (the member, or a loan's borrower) -- rows with nobody on the other
  // side (bank interest, expenses) get no entry. Held back until the
  // threads have loaded, so it doesn't flash up and then vanish.
  const [threads, setThreads] = useState<Awaited<ReturnType<typeof listTransactionConversations>> | null>(null)
  useEffect(() => {
    let cancelled = false
    listTransactionConversations(t.transaction_id).then((rows) => {
      if (!cancelled) setThreads(rows)
    })
    return () => {
      cancelled = true
    }
  }, [t.transaction_id])
  for (const c of threads ?? [])
    links.push({
      label: "Open conversation",
      hint: `${c.subject}${c.status === "closed" ? " · closed" : ""}`,
      onClick: () => router.push(`/messages/${c.id}`)
    })

  const recipientId: string | null = isAdmin ? t.member_id ?? t.loans?.borrowers?.member_id ?? null : memberId ?? null
  const recipientName: string | null = t.members?.name ?? t.loans?.borrowers?.name ?? null
  if (threads && recipientId && !(isAdmin && recipientId === memberId) && !threads.some((c) => c.member_id === recipientId))
    links.push({
      label: isAdmin ? `Message ${recipientName ?? "member"}` : "Ask about this",
      hint: isAdmin ? "Start a conversation about this entry" : "Send the admins a question about this entry",
      onClick: () => router.push(`/messages?txn=${t.transaction_id}${isAdmin ? `&to=${recipientId}` : ""}`)
    })

  const fromBank = bankAccountLabel(t.from_bank_account) || t.bank || null
  const toBank = bankAccountLabel(t.to_bank_account) || null

  return (
    <Sheet
      title={v.typeLabel}
      onClose={onClose}
      footer={
        canEdit ? (
          <button type="button" className={primaryButton} onClick={onEdit}>
            {t.status === "rejected" ? "Fix & resend" : "Edit"}
          </button>
        ) : undefined
      }
    >
      <div className="text-center pt-1 pb-4">
        <p className={`font-mono [font-variant-numeric:tabular-nums] text-[34px] font-bold leading-tight ${amountTone}`}>
          {formatSigned(Number(t.amount), v.direction)}
        </p>
        <p className="text-sm text-ink-soft mt-1">
          {v.displayName}
          {t.status !== "approved" && (
            <span className="ml-2 align-middle inline-block">
              <StatusTag status={t.status} />
            </span>
          )}
        </p>
      </div>

      {t.status === "rejected" && t.rejection_reason && (
        <div className="rounded-md border border-rust/40 bg-paper px-3.5 py-2.5 mb-4">
          <p className="text-[10px] uppercase tracking-[0.1em] text-rust font-mono">Why it was rejected</p>
          <p className="text-sm text-ink mt-0.5">{t.rejection_reason}</p>
        </div>
      )}

      <div className="card px-4">
        <ReviewRow label="Date" value={fullDate(t)} />
        {isTransfer ? (
          <>
            {fromBank && <ReviewRow label="From" value={fromBank} />}
            {toBank && <ReviewRow label="To" value={toBank} />}
          </>
        ) : (
          v.bank && <ReviewRow label="Bank" value={v.bank} />
        )}
        {t.loans?.name && <ReviewRow label="Loan" value={t.loans.name} />}
        {t.investments?.name && <ReviewRow label="Investment" value={t.investments.name} />}
        {v.detail && !t.loans?.name && !t.investments?.name && v.detail !== v.description && (
          <ReviewRow label="Source" value={v.detail} />
        )}
        {t.submitted_by_member?.name && <ReviewRow label="Recorded by" value={t.submitted_by_member.name} />}
        {v.description && <ReviewRow label="Notes" value={v.description} />}
      </div>

      {receipts.length > 0 && (
        <div className="mt-4">
          <ReceiptThumbs paths={receipts} onOpen={(i) => onOpenReceipt(receipts, i)} />
        </div>
      )}

      {links.length > 0 && (
        <div className="card px-4 mt-4">
          {links.map((l, i) => (
            <AdminActionRow key={`${i}-${l.label}`} label={l.label} hint={l.hint} onClick={l.onClick} last={i === links.length - 1} />
          ))}
        </div>
      )}
    </Sheet>
  )
}
