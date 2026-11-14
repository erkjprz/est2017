"use client"

import type { LendingLimits, RequestCheck } from "@/lib/lendingLimits"

// A pending Loan Release against the lending limits, in the review sheet:
// what's available, where this borrower lands, and the highest member hold
// once approved. A row over its limit turns rust; nothing is blocked.
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
  return (
    <div className="mt-4">
      <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">Fund check</p>
      <div className="card divide-y divide-hairline overflow-hidden">
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
    </div>
  )
}
