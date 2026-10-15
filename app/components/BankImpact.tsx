"use client"

import type { BankDelta, TxnImpact } from "@/lib/bankImpact"

const fmt = (n: number) =>
  Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const signed = (n: number) => `${n < 0 ? "-" : "+"}₱${fmt(Math.abs(n))}`
const money = (n: number) => `${n < 0 ? "-" : ""}₱${fmt(Math.abs(n))}`

const NONE_REASON: Record<"no_bank" | "no_cash", string> = {
  no_bank: "Won't change any bank balance: no bank is set on this transaction.",
  no_cash: "Won't change any bank balance: it's marked as not affecting cash."
}

// Before approving: which bank(s) this moves, as one row per bank --
// bank, change, and the balance it lands on (the figure to check against
// the bank's own app; the starting balance is left out to keep each bank
// to a single line). balances is null while the current balances are
// still loading.
export function BankImpactPreview({
  banks,
  unaffected,
  noneReason,
  balances,
  compact = false,
  title = "Bank balance after approving",
  className = ""
}: {
  banks: BankDelta[]
  unaffected: number
  // Set for a single transaction that won't move any bank -- explains why.
  noneReason?: Extract<TxnImpact, { kind: "none" }>["reason"]
  balances: Record<string, number> | null
  // Bare table for the bulk-approve bar, which supplies its own card.
  compact?: boolean
  title?: string
  className?: string
}) {
  if (banks.length === 0 && unaffected === 0) return null

  const rows = banks.map(({ bank, delta }) => {
    const after = Number(((balances?.[bank] ?? 0) + delta).toFixed(2))
    return { bank, delta, after, goesNegative: balances !== null && after < 0 }
  })
  const negativeBanks = rows.filter((r) => r.goesNegative).map((r) => r.bank)

  const table = (
    <>
      {rows.length > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 gap-y-1.5 items-baseline">
          {compact ? (
            <>
              <span className="text-[10px] uppercase tracking-[0.1em] text-ink-soft font-mono">Bank</span>
              <span className="text-[10px] uppercase tracking-[0.1em] text-ink-soft font-mono text-right">Change</span>
              <span className="text-[10px] uppercase tracking-[0.1em] text-ink-soft font-mono text-right">New balance</span>
            </>
          ) : (
            <span className="col-span-3 text-[10px] uppercase tracking-[0.1em] text-ink-soft font-mono">{title}</span>
          )}
          {rows.map(({ bank, delta, after, goesNegative }) => (
            <div key={bank} className="contents">
              <span className="text-[13px] text-ink truncate">{bank}</span>
              <span
                className={`text-[12px] font-mono [font-variant-numeric:tabular-nums] text-right whitespace-nowrap ${
                  delta < 0 ? "text-rust" : "text-sage"
                }`}
              >
                {signed(delta)}
              </span>
              <span
                className={`text-[12px] font-mono [font-variant-numeric:tabular-nums] text-right whitespace-nowrap ${
                  goesNegative ? "text-rust font-semibold" : "text-ink"
                }`}
              >
                {balances === null ? "…" : money(after)}
              </span>
            </div>
          ))}
        </div>
      )}
      {negativeBanks.length > 0 && (
        <p className="mt-1.5 text-[11px] text-rust">This would take {negativeBanks.join(" and ")} below zero.</p>
      )}
      {noneReason && banks.length === 0 && <p className="text-[12px] text-gold">{NONE_REASON[noneReason]}</p>}
      {!noneReason && unaffected > 0 && (
        <p className={`text-[12px] text-gold ${rows.length > 0 ? "mt-1.5" : ""}`}>
          {`${unaffected} of these won't change any bank balance (no bank set, or not affecting cash).`}
        </p>
      )}
    </>
  )

  if (compact) return <div className={className}>{table}</div>

  return <div className={`rounded-md border border-hairline bg-paper px-3.5 py-2.5 ${className}`}>{table}</div>
}

export type ApprovalResult = {
  count: number
  banks: { bank: string; delta: number; after: number | null }[]
  unaffected: number
}

// After approving: what actually happened, with balances re-fetched after
// the write -- a real confirmation, not the prediction shown beforehand.
export function ApprovalResultCard({
  result,
  onViewBank,
  onDismiss
}: {
  result: ApprovalResult
  onViewBank: (bank: string) => void
  onDismiss: () => void
}) {
  return (
    <div className="card px-5 pt-4 pb-3" role="status">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-ink font-semibold">
          <span className="text-sage">✓</span> Approved {result.count} transaction{result.count === 1 ? "" : "s"}
        </p>
        <button onClick={onDismiss} aria-label="Dismiss" className="text-ink-soft text-lg leading-none -mt-0.5">
          ×
        </button>
      </div>
      <div className="mt-1.5">
        {result.banks.map(({ bank, delta, after }) => (
          <button
            key={bank}
            onClick={() => onViewBank(bank)}
            className="w-full py-2 flex items-center justify-between gap-3 text-left border-t border-dashed border-hairline"
          >
            <span className="min-w-0">
              <span className="block text-sm text-ink font-medium truncate">{bank}</span>
              <span className="block text-[11px] text-ink-soft font-mono">
                {after === null ? "Balance unavailable" : `now ${money(after)}`}
              </span>
            </span>
            <span className="flex items-center gap-2 shrink-0">
              <span
                className={`font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold ${
                  delta < 0 ? "text-rust" : "text-sage"
                }`}
              >
                {signed(delta)}
              </span>
              <span className="text-[12px] text-gold">View →</span>
            </span>
          </button>
        ))}
        {result.unaffected > 0 && (
          <p className="py-2 border-t border-dashed border-hairline text-[12px] text-gold">
            {`${result.unaffected} didn't change any bank balance (no bank set, or not affecting cash).`}
          </p>
        )}
      </div>
    </div>
  )
}
