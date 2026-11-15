"use client"

import type { ReactNode } from "react"
import { FlowBadge } from "@/app/components/TransactionFormUI"

// Made-up items the admin tour (AdminTour.tsx) puts on the real page while
// it runs and the real list is empty -- nothing waiting for approval, no
// interest to distribute, no loan needing action -- so the spotlight lands
// on what the item will look like. Same markup as the real cards they stand
// in for, badged "Example", and inert: the tour's overlay blocks taps
// anyway, and none of them is wired to anything.

function ExampleBadge() {
  return (
    <span className="shrink-0 text-[10px] font-mono uppercase tracking-[0.14em] text-paper bg-gold rounded-full px-2 py-0.5">
      Example
    </span>
  )
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="text-[9px] uppercase tracking-wide font-mono rounded px-1.5 py-0.5 border text-rust border-rust/50 bg-rust/5">
      {children}
    </span>
  )
}

// Heading of /admin while the examples below are standing in for the queue.
export function ExampleQueueHeading() {
  return (
    <span className="inline-flex items-center gap-3">
      <span>
        <span className="text-gold">2</span> waiting on you
      </span>
      <ExampleBadge />
    </span>
  )
}

export function ExampleQueueSection() {
  return (
    <section aria-hidden="true">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">Confirmed money</span>
        <ExampleBadge />
      </div>
      <p className="mt-1.5 text-xs text-ink-soft">Already in the bank — nothing left to decide, just to confirm.</p>
      <div className="mt-3 space-y-2">
        <div data-tour="queue-item" className="card overflow-hidden flex items-center gap-3 px-4 py-3">
          <FlowBadge arrow="↑" tone="in" small />
          <span className="min-w-0 flex-1">
            <span className="block font-display font-medium truncate text-sm">Maria Santos</span>
            <span className="block text-xs text-ink-soft truncate">Contribution · BDO</span>
            <span className="block text-[11px] text-ink-soft font-mono truncate">Nov 14 · 2h ago</span>
            <span className="mt-1 flex flex-wrap gap-1">
              <Chip>No receipt</Chip>
              <Chip>Possible duplicate</Chip>
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block text-sm font-mono">₱1,000.00</span>
            <span className="block text-[11px] text-ink-soft mt-0.5">Reject</span>
          </span>
        </div>
      </div>
    </section>
  )
}

export function ExampleSignupSection() {
  return (
    <section aria-hidden="true" data-tour="queue-signup">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">New signups</span>
        <ExampleBadge />
      </div>
      <div className="mt-3 space-y-2">
        <div className="w-full card flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-display font-medium truncate text-sm">Jose Reyes</p>
            <p className="text-xs text-ink-soft truncate">jose@email.com · 2h ago</p>
          </div>
          <span className="shrink-0 text-[11px] font-mono text-gold">Review →</span>
        </div>
      </div>
    </section>
  )
}

// Breakdown → Banks' "Needs distribution" card.
export function ExampleInterestDueCard() {
  return (
    <div aria-hidden="true" data-tour="bank-interest-due" className="card mb-4">
      <div className="px-5 pt-4 pb-2">
        <div className="flex items-center justify-between gap-3 mb-1">
          <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono">Needs distribution</p>
          <ExampleBadge />
        </div>
        <p className="text-sm text-ink">
          <span className="font-mono [font-variant-numeric:tabular-nums] font-semibold">₱2,450.18</span> interest is
          ready to split across members.
        </p>
        <div className="mt-2">
          {[
            ["BDO", "₱1,612.40"],
            ["Maya", "₱837.78"]
          ].map(([bank, amount]) => (
            <div
              key={bank}
              className="w-full py-2.5 flex items-center justify-between gap-3 border-t border-dashed border-hairline"
            >
              <span className="text-sm text-ink font-medium">{bank}</span>
              <span className="flex items-center gap-2 shrink-0">
                <span className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-gold">{amount}</span>
                <span className="text-ink-soft">→</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Breakdown → Loans' "Needs action" card.
export function ExampleLoansNeedsActionCard() {
  const rows = [
    { loan: "Ana · Tuition loan", label: "Payment 12 days overdue", tone: "text-rust", amount: "₱8,000.00" },
    { loan: "Ben · Business loan", label: "Ready to close", tone: "text-sage", amount: "+₱600.00" }
  ]
  return (
    <div aria-hidden="true" data-tour="loans-attention" className="card mb-6">
      <div className="px-5 pt-4 pb-2">
        <div className="flex items-center justify-between gap-3 mb-1">
          <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono">Needs action</p>
          <ExampleBadge />
        </div>
        <p className="text-sm text-ink">2 loans waiting on an admin.</p>
        <div className="mt-2">
          {rows.map((r) => (
            <div
              key={r.loan}
              className="w-full py-2.5 flex items-center justify-between gap-3 border-t border-dashed border-hairline"
            >
              <span className="min-w-0">
                <span className="block text-sm text-ink font-medium truncate">{r.loan}</span>
                <span className={`block text-[11px] font-mono uppercase tracking-wide ${r.tone}`}>{r.label}</span>
              </span>
              <span className="flex items-center gap-2 shrink-0">
                <span className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-ink">{r.amount}</span>
                <span className="text-ink-soft">→</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
