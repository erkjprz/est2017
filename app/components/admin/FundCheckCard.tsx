"use client"

import { useState } from "react"
import type { LendingLimits, RequestCheck } from "@/lib/lendingLimits"

// A pending Loan Release against the lending limits, in the review sheet.
// One row by default -- "Within limits" or "Over limit" -- so the form stays
// short; tap it for the numbers: what's available, where this borrower
// lands, and the highest member hold once approved. It starts open when
// something is over a limit, so a warning is never hidden. Rows over their
// limit turn rust; nothing is blocked.
export function FundCheckCard({ check, limits }: { check: RequestCheck; limits: LendingLimits }) {
  const pct = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
  const peso = (n: number) => `₱${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const rows: { label: string; value: string; sub: string; over: boolean }[] = [
    {
      label: "Available to lend",
      value: peso(check.availableBefore),
      sub: check.overTotalBy > 0 ? `${peso(check.overTotalBy)} over the ${pct(limits.max_total_loans_pct)} limit` : `${pct(limits.max_total_loans_pct)} of the fund, less what's out`,
      over: check.overTotalBy > 0
    },
    {
      label: `${check.borrowerName} after this`,
      value: peso(check.borrowerAfter),
      sub: `${pct(check.borrowerAfterPct)} of the fund · limit ${pct(limits.max_per_borrower_pct)}`,
      over: check.overBorrowerBy > 0
    }
  ]
  if (check.highestHold) {
    rows.push({
      label: "Highest member hold",
      value: pct(check.highestHold.pct),
      sub: `${check.highestHold.name} · limit ${pct(limits.max_member_hold_pct)}`,
      over: check.overHold.length > 0
    })
  }

  const anyOver = rows.some((r) => r.over)
  const [open, setOpen] = useState(anyOver)

  return (
    <div className="card mt-3 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 shrink-0 text-ink-soft" aria-hidden="true">
          <path d="M4 20h16" />
          <path d="M6 16V11M10 16V7M14 16v-5M18 16V4" />
        </svg>
        <span className="flex-1 min-w-0 text-sm text-ink">Fund check</span>
        <span className={`shrink-0 text-[12px] font-semibold ${anyOver ? "text-rust" : "text-sage"}`}>
          {anyOver ? "Over limit" : "Within limits"}
        </span>
        <span className={`shrink-0 text-ink-soft text-xs transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="divide-y divide-hairline border-t border-hairline">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <span className="block text-sm text-ink truncate">{r.label}</span>
                <span className={`block text-[11px] ${r.over ? "text-rust" : "text-ink-soft"}`}>{r.sub}</span>
              </span>
              <span className={`shrink-0 font-mono text-sm [font-variant-numeric:tabular-nums] ${r.over ? "text-rust font-semibold" : "text-ink"}`}>
                {r.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
