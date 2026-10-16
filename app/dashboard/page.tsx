"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Navbar from "@/app/components/Navbar"
import ScanToPayCard from "@/app/components/ScanToPayCard"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"
import { TRANSACTION_TYPE_LABELS as TXN_TYPE_LABELS } from "@/lib/transactionLabels"
import { readCache, writeCache } from "@/lib/cache"
import { TRANSACTIONS_CHANGED_EVENT } from "@/lib/transactionEvents"
import { fetchDashboardFields, type DashboardSnapshot, type RecentTransaction } from "@/lib/dashboardSnapshot"

export default function DashboardPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()
  const cacheKey = member ? `dashboard:${member.member_id}` : null
  const cached = cacheKey ? readCache<DashboardSnapshot>(cacheKey) : undefined

  // Paints instantly from the last time this member's dashboard loaded,
  // before the browser ever shows a frame -- loadDashboard() below still
  // runs right after and replaces it with a fresh fetch, so a stale cache
  // never lingers past that first moment.
  const [dataLoading, setDataLoading] = useState(!cached)
  const [asOf, setAsOf] = useState<Date | null>(cached ? new Date(cached.asOf) : null)

  const [fundCash, setFundCash] = useState<number | null>(cached?.fundCash ?? null)
  const [myBalance, setMyBalance] = useState<number | null>(cached?.myBalance ?? null)
  const [pendingCount, setPendingCount] = useState(cached?.pendingCount ?? 0)
  const [myPendingCount, setMyPendingCount] = useState(cached?.myPendingCount ?? 0)
  const [recentTransactions, setRecentTransactions] = useState<RecentTransaction[]>(cached?.recentTransactions ?? [])
  const [loadError, setLoadError] = useState("")

  const memberName = member?.name ?? ""
  const isAdmin = member?.role === "admin"
  const checkingAccess = authLoading || dataLoading

  // Pulled out of the mount effect below so the FAB's quick-entry sheet
  // (in Navbar, above this page and unaware of it) can also trigger a
  // quiet refresh after saving a transaction -- see the listener effect
  // further down.
  const loadDashboard = useCallback(async () => {
      if (!member) return

      // Only show the blocking loader on a true cold start -- if we
      // already rendered cached data, refresh quietly behind it instead
      // of flashing back to a spinner on every navigation.
      if (!readCache(`dashboard:${member.member_id}`)) setDataLoading(true)

      // The six queries themselves live in lib/dashboardSnapshot.ts, shared
      // with the splash at / -- which runs the exact same fetch to get this
      // cache warm before ever navigating here. A field comes back
      // `undefined` when its own query errored; fall back to whatever's
      // already on screen rather than blanking a value the member was just
      // looking at over a transient error.
      const fields = await fetchDashboardFields(member)
      if (fields.error) setLoadError(fields.error)

      const nextFundCash = fields.fundCash ?? fundCash
      const nextMyBalance = fields.myBalance ?? myBalance
      const nextPendingCount = fields.pendingCount
      const nextMyPendingCount = fields.myPendingCount ?? myPendingCount
      const nextRecentTransactions = fields.recentTransactions ?? recentTransactions
      const nextAsOf = new Date()

      setFundCash(nextFundCash)
      setMyBalance(nextMyBalance)
      setPendingCount(nextPendingCount)
      setMyPendingCount(nextMyPendingCount)
      setRecentTransactions(nextRecentTransactions)
      setAsOf(nextAsOf)
      setDataLoading(false)

      writeCache<DashboardSnapshot>(`dashboard:${member.member_id}`, {
        fundCash: nextFundCash,
        myBalance: nextMyBalance,
        pendingCount: nextPendingCount,
        myPendingCount: nextMyPendingCount,
        recentTransactions: nextRecentTransactions,
        asOf: nextAsOf.toISOString()
      })
    // Depends only on member's id (see auth-context's own comment on why),
    // not on fundCash/myBalance/recentTransactions -- those are read only
    // as an error-path fallback, so a stale closure over them is harmless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member?.member_id])

  useEffect(() => {
    if (authLoading) return

    if (!member) {
      router.push("/login")
      return
    }

    if (member.status !== "approved") {
      router.push("/waiting")
      return
    }

    if (member.role === "borrower") {
      router.push("/borrower")
      return
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data once the auth check above passes
    loadDashboard()
  }, [authLoading, member, router, loadDashboard])

  // The FAB's quick-entry sheet lives in Navbar, above this page and with
  // no reference to its load function -- this listens for the plain DOM
  // event it fires after a successful save instead, so a contribution/
  // withdrawal/etc. submitted from here shows up without needing a full
  // navigation away and back.
  useEffect(() => {
    window.addEventListener(TRANSACTIONS_CHANGED_EVENT, loadDashboard)
    return () => window.removeEventListener(TRANSACTIONS_CHANGED_EVENT, loadDashboard)
  }, [loadDashboard])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const asOfLabel = asOf
    ? asOf.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
      })
    : ""

  if (checkingAccess) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(2.5rem+var(--dock-h)+env(safe-area-inset-bottom))]">
            <SkeletonPanel />
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Navbar />

      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(2.5rem+var(--dock-h)+env(safe-area-inset-bottom))]">
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Welcome back
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink">
            {memberName}
          </h1>
          {asOfLabel && (
            <p className="text-[11px] text-ink-soft mt-1 mb-5">As of {asOfLabel}</p>
          )}

          {loadError && (
            <p className="mt-2 mb-4 text-sm text-rust">
              Couldn&apos;t load some dashboard data: {loadError}
            </p>
          )}

          {/* The member's own entries still with an admin -- the submit
              toast is gone in a few seconds, this stays until each one is
              approved or rejected. */}
          {myPendingCount > 0 && (
            <button
              onClick={() => router.push("/transactions")}
              className="mb-5 w-full text-left bg-paper-2 border border-hairline rounded-md px-5 py-3.5 flex items-center justify-between"
            >
              <p className="text-sm text-ink">
                <span className="font-mono text-gold mr-1.5">●</span>
                {myPendingCount} of your {myPendingCount === 1 ? "entries is" : "entries are"} waiting for approval
              </p>
              <span className="text-ink-soft">→</span>
            </button>
          )}

          {/* Admin-only: fund-wide items needing action -- the one thing on
              this page that isn't the signed-in member's own money, so it
              stays visually distinct (gold border) from everything below. */}
          {isAdmin && pendingCount > 0 && (
            <button
              onClick={() => router.push("/admin")}
              className="mb-5 w-full text-left bg-paper-2 border border-gold rounded-md px-5 py-4 flex items-center justify-between"
            >
              <div>
                <p className="text-sm text-ink font-medium">
                  {pendingCount} {pendingCount === 1 ? "entry" : "entries"} awaiting approval
                </p>
                <p className="text-xs text-gold mt-0.5">Tap to review in Admin</p>
              </div>
              <span className="text-ink-soft">→</span>
            </button>
          )}

          <button
            onClick={() => router.push("/fund-breakdown?tab=fund&view=you")}
            className="w-full text-left card px-5 pt-4 pb-3.5 hover:bg-paper transition-colors"
          >
            <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">
              My Available Balance
            </p>
            <p className="font-mono [font-variant-numeric:tabular-nums] text-3xl font-bold text-ink">
              ₱{myBalance != null ? fmt(myBalance) : "—"}
            </p>
            <p className="text-[12px] text-gold font-semibold mt-2.5">View full breakdown →</p>
          </button>

          <button
            onClick={() => router.push("/fund-breakdown?tab=fund")}
            className="w-full text-left card px-5 pt-4 pb-3.5 mt-3 hover:bg-paper transition-colors"
          >
            <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">
              Fund Available Balance
            </p>
            <p className="font-mono [font-variant-numeric:tabular-nums] text-2xl font-bold text-ink">
              ₱{fundCash != null ? fmt(fundCash) : "—"}
            </p>
            <p className="text-[12px] text-gold font-semibold mt-2.5">View fund breakdown →</p>
          </button>

          <div className="mt-4">
            <ScanToPayCard />
          </div>

          <div className="flex items-baseline justify-between gap-3 mt-6 mb-2.5">
            <h2 className="font-display text-[17px] font-medium text-ink">Recent Transactions</h2>
            <button onClick={() => router.push("/transactions")} className="shrink-0 text-[13px] font-medium text-gold">
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
                      {new Date(t.date.length === 10 ? `${t.date}T00:00:00` : t.date).toLocaleDateString(undefined, {
                        day: "numeric",
                        month: "short",
                        year: "numeric"
                      })}
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
              No transactions recorded yet.
            </p>
          )}
        </div>
      </main>
    </>
  )
}
