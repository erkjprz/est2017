"use client"

// Inline replacement for the old standalone /investment/[id] route --
// rendered in place inside InvestmentsPanel so the Breakdown header and
// tab row stay on screen instead of a full page navigation.

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"
import { InfoBox, InfoRow } from "@/app/components/breakdown/InfoBox"
import { Sheet } from "@/app/components/Sheet"
import { AdminActionRow, AdminMenuButton } from "@/app/components/breakdown/AdminMenu"
import {
  DistributeInvestmentSheet,
  InvestmentDetailsSheet,
  ReopenInvestmentSheet
} from "@/app/components/breakdown/InvestmentAdminSheets"
import { TRANSACTION_TYPE_LABELS as TXN_TYPE_LABELS } from "@/lib/transactionLabels"
import { readCache, writeCache } from "@/lib/cache"

type Investment = {
  investment_id: string
  investment: string
  affects_cash: number
  invested: number
  returned: number
  gain_loss: number
  status: "open" | "closed"
  closed_date: string | null
}

type Share = {
  id: string
  member_id: string
  member: string
  amount: number
  allocation_type: string
  notes: string | null
}

type RecentTransaction = {
  transaction_id: string
  date: string
  classification: string
  amount: number
  status: string
}

type InvestmentDetailSnapshot = {
  investment: Investment | null
  shares: Share[]
  recentTransactions: RecentTransaction[]
}

type AdminSheet = "actions" | "edit" | "distribute" | "close" | "reopen" | null

export function InvestmentDetailPanel({
  investmentId,
  onBack,
  onChanged
}: {
  investmentId: string
  onBack: () => void
  // Lets the investment list refresh behind this panel after an admin action.
  onChanged?: () => void
}) {
  const router = useRouter()
  const { member } = useAuth()
  const isAdmin = member?.role === "admin"
  const myMemberId = member?.member_id ?? null

  const cacheKey = `investment-detail:${investmentId}`
  const cached = readCache<InvestmentDetailSnapshot>(cacheKey)

  const [dataLoading, setDataLoading] = useState(!cached)
  const [investment, setInvestment] = useState<Investment | null>(cached?.investment ?? null)
  const [shares, setShares] = useState<Share[]>(cached?.shares ?? [])
  const [recentTransactions, setRecentTransactions] = useState<RecentTransaction[]>(cached?.recentTransactions ?? [])
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState("")

  const [adminSheet, setAdminSheet] = useState<AdminSheet>(null)

  const loadInvestment = useCallback(async () => {
    const { data, error } = await supabase
      .from("v_investment_summary")
      .select("*")
      .eq("investment_id", investmentId)
      .single()

    if (error || !data) {
      setNotFound(true)
      return investment
    }

    const next = data as Investment
    setInvestment(next)
    return next
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally omitted: the left-out values are fallbacks/cache data, and depending on them would refetch in a loop
  }, [investmentId])

  const loadShares = useCallback(async () => {
    // Per-member split, per Section 8: Perfume Biz is a flat equal
    // split across all 10 members; Farmon's realized loss is spread
    // across 9 (Yabie isn't allocated a share, a pre-existing artifact
    // of this table's history, not something decided in this pass).
    const { data, error } = await supabase
      .from("investment_allocations")
      .select("id, amount, allocation_type, member_id, notes, members(name)")
      .eq("investment_id", investmentId)

    if (!error && data) {
      const next = data.map((r: any) => ({
        id: r.id,
        member_id: r.member_id,
        member: r.members?.name ?? "Unknown",
        amount: Number(r.amount),
        allocation_type: r.allocation_type,
        notes: r.notes ?? null
      }))
      setShares(next)
      setLoadError("")
      return next
    } else if (error) {
      setLoadError(error.message)
    }
    return shares
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally omitted: the left-out values are fallbacks/cache data, and depending on them would refetch in a loop
  }, [investmentId])

  const loadRecentTransactions = useCallback(async () => {
    const { data } = await supabase
      .from("transactions")
      .select("transaction_id, txn_date, created_at, classification, amount, status")
      .eq("investment_id", investmentId)
      .neq("status", "cancelled")
      .order("txn_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(5)

    const next = (data ?? []).map((r) => ({
      transaction_id: r.transaction_id,
      date: r.txn_date ?? r.created_at,
      classification: r.classification,
      amount: Number(r.amount),
      status: r.status
    }))
    setRecentTransactions(next)
    return next
  }, [investmentId])

  // Opening a drill-down while the list is scrolled down would otherwise
  // leave the Breakdown header out of view -- jump back to top so it's
  // visible the instant the detail mounts.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      // Only show the blocking loader on a true cold start -- if we
      // already rendered cached data, refresh quietly behind it instead
      // of flashing back to a spinner on every navigation.
      if (!readCache(cacheKey)) setDataLoading(true)

      const [nextInvestment, nextShares, nextRecentTransactions] = await Promise.all([
        loadInvestment(),
        loadShares(),
        loadRecentTransactions()
      ])
      if (cancelled) return
      setDataLoading(false)

      writeCache<InvestmentDetailSnapshot>(cacheKey, {
        investment: nextInvestment,
        shares: nextShares,
        recentTransactions: nextRecentTransactions
      })
    }

    if (investmentId) load()
    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally omitted: the left-out values are fallbacks/cache data, and depending on them would refetch in a loop
  }, [investmentId, member, loadInvestment, loadShares, loadRecentTransactions])

  async function reloadAfterAdminAction() {
    const [nextShares, nextInvestment, nextRecentTransactions] = await Promise.all([
      loadShares(),
      loadInvestment(),
      loadRecentTransactions()
    ])
    writeCache<InvestmentDetailSnapshot>(cacheKey, {
      investment: nextInvestment,
      shares: nextShares,
      recentTransactions: nextRecentTransactions
    })
    onChanged?.()
  }

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (dataLoading) {
    return <SkeletonPanel />
  }

  if (notFound || !investment) {
    return (
      <div>
        <p className="text-sm text-ink-soft">This investment couldn&apos;t be found.</p>
        <button onClick={onBack} className="mt-4 text-sm font-medium text-gold">
          ← Back to Investments
        </button>
      </div>
    )
  }

  const isGain = investment.gain_loss > 0
  const isFlat = investment.gain_loss === 0

  const signedShares = shares.map((s) => ({
    ...s,
    signed: s.allocation_type === "Investment Loss" ? -s.amount : s.amount
  }))

  const totalShared = signedShares.reduce((sum, s) => sum + s.signed, 0)
  const unallocated = Number((investment.gain_loss - totalShared).toFixed(2))

  // An investment can be distributed multiple times over its life (yearly,
  // ad hoc, a final one on closing), so the same member can end up with
  // more than one allocation row here -- rolled up into one total per
  // member rather than shown as separate line items, since two distinct
  // distributions can otherwise look like an accidental duplicate (e.g.
  // splitting the same total twice against unchanged member proportions
  // produces identical per-member amounts both times). The per-event
  // breakdown -- what was distributed and when -- lives on /transactions
  // instead, via each distribution's own "Gain Allocation" entries.
  const memberTotals = new Map<string, { member_id: string; member: string; signed: number }>()
  for (const s of signedShares) {
    const existing = memberTotals.get(s.member_id)
    if (existing) existing.signed += s.signed
    else memberTotals.set(s.member_id, { member_id: s.member_id, member: s.member, signed: s.signed })
  }
  const memberShares = Array.from(memberTotals.values()).sort((a, b) =>
    isGain ? b.signed - a.signed : a.signed - b.signed
  )

  // Only realized money is "ready" -- an open investment that's had money
  // put in but not yet returned shows a negative unallocated figure that's
  // just capital still out, not a loss to split. A closed one with anything
  // left over (either way) does need settling.
  const isOpen = investment.status === "open"
  const readyToDistribute = isOpen ? unallocated > 0.01 : Math.abs(unallocated) > 0.01

  const menuItems: { label: string; hint: string; onClick: () => void; danger?: boolean }[] = [
    { label: "Edit details", hint: "Name and whether it affects cash", onClick: () => setAdminSheet("edit") }
  ]
  if (isOpen) {
    menuItems.push(
      { label: "Distribute gain/loss", hint: "Split a realized amount across members", onClick: () => setAdminSheet("distribute") },
      { label: "Close investment", hint: "Settle what's left and mark it closed", onClick: () => setAdminSheet("close") }
    )
  } else {
    menuItems.push({ label: "Reopen investment", hint: "Undo the final distribution", onClick: () => setAdminSheet("reopen") })
  }

  return (
    <div>
      <button onClick={onBack} className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors">
        ← Investments
      </button>

      <div className="flex items-center gap-2 mb-1">
        {/* One status, like a loan's: Active while it's still running,
            and Gain/Loss only once closed, when the figure is final. */}
        {isOpen ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-gold" />
            <span className="text-[11px] font-mono uppercase tracking-wide text-gold">Active</span>
          </>
        ) : (
          <>
            <span className={`w-1.5 h-1.5 rounded-full ${isGain ? "bg-sage" : isFlat ? "bg-ink-soft" : "bg-rust"}`} />
            <span
              className={`text-[11px] font-mono uppercase tracking-wide ${
                isGain ? "text-sage" : isFlat ? "text-ink-soft" : "text-rust"
              }`}
            >
              Closed · {isGain ? "Gain" : isFlat ? "Flat" : "Loss"}
            </span>
          </>
        )}
      </div>
      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink min-w-0 break-words">
          {investment.investment}
        </h1>
        {isAdmin && <AdminMenuButton onClick={() => setAdminSheet("actions")} label="Investment admin actions" />}
      </div>
      <p className="text-[13px] text-ink-soft mb-6">
        {investment.affects_cash ? "Funded through the tracked bank accounts" : "Funded outside the tracked cash trail"}
      </p>

      {/* Gain/loss overview */}
      <div className="card px-5 pt-4 pb-3.5">
        <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">
          {isOpen ? "Net Gain / Loss So Far" : "Net Gain / Loss"}
        </p>
        <p
          className={`font-mono [font-variant-numeric:tabular-nums] text-3xl font-bold ${
            isGain ? "text-sage" : isFlat ? "text-ink" : "text-rust"
          }`}
        >
          {investment.gain_loss < 0 ? "-" : "+"}₱{fmt(Math.abs(investment.gain_loss))}
        </p>
      </div>

      {/* Invested / Returned */}
      <div className="card p-5 mt-4">
        <InfoBox label="Cash Flow">
          <InfoRow label="Invested" value={`₱${fmt(investment.invested)}`} />
          <InfoRow label="Returned" value={`₱${fmt(investment.returned)}`} />
          {investment.status === "closed" && investment.closed_date && (
            <InfoRow
              label="Closed"
              value={new Date(`${investment.closed_date}T00:00:00`).toLocaleDateString(undefined, {
                month: "long",
                day: "numeric",
                year: "numeric"
              })}
            />
          )}
        </InfoBox>
      </div>

      {/* Realized gain/loss that hasn't been split yet, right above the
          shares it would add to. Everyone sees the amount (same as a bank's
          "not yet distributed"); only admins get the button to split it. */}
      {readyToDistribute && (
        <section className="mt-8">
          <h2 className="font-display text-lg font-medium text-ink mb-1">
            {isAdmin ? "Ready to Distribute" : "Not Yet Distributed"}
          </h2>
          <p className="text-[13px] text-ink-soft mb-3">
            {isOpen
              ? "Realized gain that hasn't been split across members yet."
              : "Left over after closing and not yet split across members."}
          </p>
          <div className="card px-5 py-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-ink font-medium">Not yet split</p>
              <p
                className={`font-mono [font-variant-numeric:tabular-nums] text-[13px] font-semibold ${
                  unallocated < 0 ? "text-rust" : "text-sage"
                }`}
              >
                {unallocated < 0 ? "-" : "+"}₱{fmt(Math.abs(unallocated))}
              </p>
            </div>
            {isAdmin && isOpen && (
              <button
                onClick={() => setAdminSheet("distribute")}
                className="shrink-0 bg-ink text-paper px-3.5 py-2 rounded-sm text-[13px] font-medium"
              >
                Review &amp; distribute
              </button>
            )}
          </div>
        </section>
      )}

      {adminSheet === "actions" && (
        <Sheet title={investment.investment} onClose={() => setAdminSheet(null)}>
          <div className="card">
            <div className="px-5">
              {menuItems.map((item, i) => (
                <AdminActionRow key={item.label} {...item} last={i === menuItems.length - 1} />
              ))}
            </div>
          </div>
        </Sheet>
      )}

      {adminSheet === "edit" && (
        <InvestmentDetailsSheet
          investment={investment}
          onClose={() => setAdminSheet(null)}
          onSaved={reloadAfterAdminAction}
        />
      )}

      {(adminSheet === "distribute" || adminSheet === "close") && (
        <DistributeInvestmentSheet
          investmentId={investmentId}
          investmentName={investment.investment}
          mode={adminSheet}
          onClose={() => setAdminSheet(null)}
          onDone={reloadAfterAdminAction}
        />
      )}

      {adminSheet === "reopen" && (
        <ReopenInvestmentSheet
          investmentId={investmentId}
          onClose={() => setAdminSheet(null)}
          onReopened={reloadAfterAdminAction}
        />
      )}

      {/* Gain/loss share per member */}
      <section className="mt-8">
        <h2 className="font-display text-lg font-medium text-ink mb-1">Distributed Share per Member</h2>
        <p className="text-[13px] text-ink-soft mb-3">
          How this investment&apos;s {isGain ? "gain" : "loss"} is split across members.
        </p>

        {loadError && <p className="text-sm text-rust mb-3">{loadError}</p>}

        {memberShares.length > 0 && (
          <div className="card px-5 mb-3">
            {memberShares.map((s, i) => (
              <div
                key={s.member_id}
                className={`py-3 flex justify-between items-center gap-3 ${
                  i !== memberShares.length - 1 ? "border-b border-dashed border-hairline" : ""
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-sm text-ink truncate">{s.member}</p>
                  {s.member_id === myMemberId && (
                    <span className="shrink-0 text-[9px] uppercase tracking-wide font-mono text-gold border border-gold/40 rounded px-1.5 py-0.5">
                      You
                    </span>
                  )}
                </div>
                <p
                  className={`shrink-0 font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold ${
                    s.signed < 0 ? "text-rust" : "text-sage"
                  }`}
                >
                  {s.signed < 0 ? "-" : "+"}₱{fmt(Math.abs(s.signed))}
                </p>
              </div>
            ))}
          </div>
        )}

        {memberShares.length > 0 && (
          <div className="card px-5 py-3 flex justify-between items-center">
            <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono">
              Split among {memberShares.length} member{memberShares.length === 1 ? "" : "s"} total
            </p>
            <p
              className={`font-mono [font-variant-numeric:tabular-nums] text-[13px] font-semibold ${
                totalShared < 0 ? "text-rust" : "text-sage"
              }`}
            >
              {totalShared < 0 ? "-" : "+"}₱{fmt(Math.abs(totalShared))}
            </p>
          </div>
        )}

        {memberShares.length === 0 && !loadError && (
          <p className="text-sm text-ink-soft text-center py-8 card">
            No allocation on record for this investment.
          </p>
        )}
      </section>

      {/* Recent transactions */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h2 className="font-display text-lg font-medium text-ink">Recent Transactions</h2>
          <button
            onClick={() => router.push(`/transactions?investment=${investmentId}`)}
            className="shrink-0 text-[13px] font-medium text-gold"
          >
            View all →
          </button>
        </div>

        {recentTransactions.length > 0 ? (
          <div className="card px-5">
            {recentTransactions.map((t, i) => (
              <div
                key={t.transaction_id}
                className={`py-3 flex justify-between items-center gap-3 ${
                  i !== recentTransactions.length - 1 ? "border-b border-dashed border-hairline" : ""
                }`}
              >
                <div className="min-w-0">
                  <p className="text-sm text-ink truncate">
                    {TXN_TYPE_LABELS[t.classification] ?? t.classification}
                  </p>
                  <p className="text-[11px] text-ink-soft font-mono">
                    {new Date(t.date.length === 10 ? `${t.date}T00:00:00` : t.date).toLocaleDateString(
                      undefined,
                      { day: "numeric", month: "short", year: "numeric" }
                    )}
                    {t.status === "pending" ? " · pending" : ""}
                  </p>
                </div>
                <p
                  className={`shrink-0 font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold ${
                    t.amount < 0 ? "text-rust" : "text-sage"
                  }`}
                >
                  {t.amount < 0 ? "-" : "+"}₱{fmt(Math.abs(t.amount))}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-soft text-center py-8 card">
            No transactions recorded for this investment yet.
          </p>
        )}
      </section>
    </div>
  )
}
