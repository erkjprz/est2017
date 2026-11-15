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
        <span className="text-gold">6</span> waiting on you
      </span>
      <ExampleBadge />
    </span>
  )
}

type ExampleTxn = {
  name: string
  arrow: string
  tone: "in" | "out"
  line: string
  amount: string
  flags?: string[]
}

// One of every kind of entry that reaches the queue, split the same way
// the real one is: money already in the bank (approve in a batch) vs money
// going out or anything that needs checking one at a time.
const CONFIRMED: ExampleTxn[] = [
  { name: "Maria Santos", arrow: "↑", tone: "in", line: "Contribution · BDO", amount: "₱1,000.00", flags: ["No receipt", "Possible duplicate"] },
  { name: "Ana Cruz", arrow: "↑", tone: "in", line: "Loan Payment · Maya", amount: "₱2,150.00" }
]
const NEEDS_DECISION: ExampleTxn[] = [
  { name: "Jose Reyes", arrow: "↓", tone: "out", line: "Withdrawal · pick the disbursing bank", amount: "₱5,000.00", flags: ["Over balance"] },
  { name: "Ben Garcia", arrow: "↓", tone: "out", line: "Loan Release · requested", amount: "₱20,000.00", flags: ["Over borrower limit by ₱2,000.00"] },
  { name: "Fund", arrow: "↑", tone: "in", line: "Investment Return · Rice trading", amount: "₱3,600.00" }
]

function ExampleTxnCard({ t, action }: { t: ExampleTxn; action: string }) {
  return (
    <div className="card overflow-hidden flex items-center gap-3 px-4 py-3">
      <FlowBadge arrow={t.arrow} tone={t.tone} small />
      <span className="min-w-0 flex-1">
        <span className="block font-display font-medium truncate text-sm">{t.name}</span>
        <span className="block text-xs text-ink-soft truncate">{t.line}</span>
        {t.flags && (
          <span className="mt-1 flex flex-wrap gap-1">
            {t.flags.map((f) => (
              <Chip key={f}>{f}</Chip>
            ))}
          </span>
        )}
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-sm font-mono">{t.amount}</span>
        <span className={`block text-[11px] font-mono mt-0.5 ${action === "Review →" ? "text-gold" : "text-ink-soft"}`}>{action}</span>
      </span>
    </div>
  )
}

export function ExampleQueueSection() {
  return (
    <div aria-hidden="true" className="space-y-8">
      <section data-tour="queue-confirmed">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold">Confirmed money</span>
          <ExampleBadge />
        </div>
        <p className="mt-1 text-xs text-ink-soft">Already in the bank — just confirm.</p>
        <div className="mt-2 space-y-2">
          {CONFIRMED.map((t) => (
            <ExampleTxnCard key={t.name} t={t} action="Reject" />
          ))}
        </div>
      </section>
      <section data-tour="queue-decision">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold">Needs a decision</span>
          <ExampleBadge />
        </div>
        <p className="mt-1 text-xs text-ink-soft">Money going out needs a bank and proof of transfer.</p>
        <div className="mt-2 space-y-2">
          {NEEDS_DECISION.map((t) => (
            <ExampleTxnCard key={t.name} t={t} action="Review →" />
          ))}
        </div>
      </section>
    </div>
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

// /messages, when there are no conversations yet: one short thread
// showing it's a two-way chat.
export function ExampleConversation() {
  return (
    <div aria-hidden="true" data-tour="messages-list" className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-display font-medium text-sm">Maria Santos</p>
        <ExampleBadge />
      </div>
      <div className="flex">
        <p className="max-w-[80%] rounded-2xl rounded-bl-sm bg-paper-2 px-3 py-2 text-sm text-ink">
          Hi! When will my withdrawal be sent?
        </p>
      </div>
      <div className="flex justify-end">
        <p className="max-w-[80%] rounded-2xl rounded-br-sm bg-ink px-3 py-2 text-sm text-paper">
          Sending it this afternoon. I&apos;ll attach the screenshot here.
        </p>
      </div>
    </div>
  )
}
