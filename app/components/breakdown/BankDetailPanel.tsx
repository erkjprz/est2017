"use client"

// Inline replacement for the old standalone /bank/[bank] route -- rendered
// in place inside BanksPanel so the Breakdown header and tab row stay on
// screen. The year drill-down (formerly /bank/[bank]/[year]) is owned
// entirely by this component rather than by BanksPanel: keeping it a local
// UI toggle instead of a separate mount means backing out of a year never
// re-triggers this panel's own data fetch or loading skeleton, so there's
// nothing for the remembered scroll position to race against.

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"
import { InfoBox, InfoRow, InfoSubRow } from "@/app/components/breakdown/InfoBox"
import { getPendingBankInterestGroups, type PendingBankInterestGroup } from "@/lib/bankInterest"
import { getBankQrPublicUrl } from "@/lib/bankQrUrl"
import BankQrModal from "@/app/components/BankQrModal"
import { BankYearDetailPanel } from "@/app/components/breakdown/BankYearDetailPanel"
import { Sheet } from "@/app/components/Sheet"
import { AdminActionRow, AdminMenuButton } from "@/app/components/breakdown/AdminMenu"
import {
  BankAccountSheet,
  BankQrSheet,
  DistributeInterestSheet,
  type BankAccountRow
} from "@/app/components/breakdown/BankAdminSheets"
import { readCache, writeCache } from "@/lib/cache"
import { recentlyApprovedIds } from "@/lib/bankImpact"
import { TRANSACTION_TYPE_LABELS as TXN_TYPE_LABELS } from "@/lib/transactionLabels"

type YearRow = { year: string; amount: number; memberCount: number }
type QrAccount = { id: string; account_name: string | null; qr_code_url: string }
type AdminSheet = "actions" | "edit" | "qr" | null
type ActivityRow = {
  key: string
  transaction_id: string
  date: string | null
  label: string
  who: string | null
  amount: number
  balanceAfter: number
}

type BankDetailSnapshot = {
  balance: number
  interestEarned: number
  tax: number
  years: YearRow[]
  qrAccounts: QrAccount[]
  accounts?: BankAccountRow[]
  activity?: ActivityRow[]
}

export function BankDetailPanel({
  bank,
  onBack,
  onChanged,
  onRenamed
}: {
  bank: string
  onBack: () => void
  // Lets the bank list refresh quietly behind this panel after an admin
  // edits or distributes here, so backing out doesn't show stale figures.
  onChanged?: () => void
  onRenamed?: (bankName: string) => void
}) {
  const router = useRouter()
  const { member } = useAuth()
  const isAdmin = member?.role === "admin"

  const [selectedYear, setSelectedYear] = useState<string | null>(null)
  const yearScrollPosRef = useRef(0)
  useEffect(() => {
    if (selectedYear === null) window.scrollTo(0, yearScrollPosRef.current)
  }, [selectedYear])

  const cacheKey = `bank-detail:${bank}`
  const cached = readCache<BankDetailSnapshot>(cacheKey)

  const [dataLoading, setDataLoading] = useState(!cached)
  const [balance, setBalance] = useState(cached?.balance ?? 0)
  const [interestEarned, setInterestEarned] = useState(cached?.interestEarned ?? 0)
  const [tax, setTax] = useState(cached?.tax ?? 0)
  const [years, setYears] = useState<YearRow[]>(cached?.years ?? [])
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState("")
  const [pendingGroups, setPendingGroups] = useState<PendingBankInterestGroup[]>([])
  const [qrAccounts, setQrAccounts] = useState<QrAccount[]>(cached?.qrAccounts ?? [])
  const [accounts, setAccounts] = useState<BankAccountRow[]>(cached?.accounts ?? [])
  const [zoomedQr, setZoomedQr] = useState<QrAccount | null>(null)
  const [adminSheet, setAdminSheet] = useState<AdminSheet>(null)
  const [reviewGroup, setReviewGroup] = useState<PendingBankInterestGroup | null>(null)
  const [activity, setActivity] = useState<ActivityRow[]>(cached?.activity ?? [])
  // Read once per mount -- just-approved ids from this device's Admin queue,
  // so they stand out here (transactions have no approved_at to go by).
  const [justApproved] = useState(recentlyApprovedIds)

  async function loadPending() {
    try {
      const groups = await getPendingBankInterestGroups()
      setPendingGroups(groups.filter((g) => g.bank === bank))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Something went wrong.")
    }
  }

  async function handleDistributed() {
    await Promise.all([loadPending(), load()])
    onChanged?.()
  }

  async function load() {
    // Only show the blocking loader on a true cold start -- if we already
    // rendered cached data (including a quiet reload after distributing
    // interest), refresh quietly behind it instead of flashing back to a
    // spinner.
    if (!readCache(cacheKey)) setDataLoading(true)

    const balancePromise = supabase.from("v_bank_balances").select("*").eq("bank", bank).maybeSingle()

    // bank falls back to the linked bank_accounts.bank_name -- transactions
    // recorded through the current form only set bank_account_id, leaving
    // the legacy bank text column null, so this can't filter with a plain
    // .eq("bank", bank) or it would silently exclude those rows entirely.
    // Mirrors the same fallback BanksPanel and getPendingBankInterestGroups
    // already use.
    const interestPromise = supabase
      .from("transactions")
      .select(
        "classification, amount, bank, interest_distributed, bank_accounts!transactions_bank_account_id_fkey ( bank_name )"
      )
      .eq("status", "approved")
      .in("classification", ["Bank Interest", "Tax"])

    // Every allocation row for this bank, across all years -- grouped
    // client-side by the year of allocation_date to build the year list.
    const allocationsPromise = supabase
      .from("bank_interest_allocations")
      .select("allocation_date, amount, member_id")
      .eq("bank", bank)

    // Every account under this bank name (not just the ones with a QR) --
    // the admin Edit/QR sheets need the account row even before it has one.
    const qrPromise = supabase
      .from("bank_accounts")
      .select("id, bank_name, account_name, qr_code_url")
      .eq("bank_name", bank)
      .order("account_name")

    // The latest entries that moved this bank's balance, newest first, in
    // the same order v_cash_ledger itself uses -- so walking back from the
    // current balance gives each entry's balance right after it.
    const activityPromise = supabase
      .from("v_cash_ledger")
      .select("transaction_id, txn_date, description, cash_effect, leg_order")
      .eq("bank", bank)
      .order("txn_date", { ascending: false })
      .order("transaction_id", { ascending: false })
      .order("leg_order", { ascending: false })
      .limit(10)

    const [balanceResult, interestResult, allocationsResult, qrResult, activityResult] = await Promise.all([
      balancePromise,
      interestPromise,
      allocationsPromise,
      qrPromise,
      activityPromise
    ])

    const nextAccounts = !qrResult.error ? ((qrResult.data as BankAccountRow[]) ?? []) : accounts
    const nextQrAccounts = !qrResult.error
      ? nextAccounts.filter((a): a is QrAccount & BankAccountRow => !!a.qr_code_url)
      : qrAccounts
    if (!qrResult.error) {
      setAccounts(nextAccounts)
      setQrAccounts(nextQrAccounts)
    }

    if (balanceResult.error || !balanceResult.data) {
      setNotFound(true)
      setDataLoading(false)
      return
    }

    const nextBalance = Number(balanceResult.data.balance)
    setBalance(nextBalance)

    let nextActivity = activity
    if (!activityResult.error && activityResult.data) {
      const ledger = activityResult.data as {
        transaction_id: string
        txn_date: string | null
        description: string | null
        cash_effect: number
        leg_order: number
      }[]
      const ids = Array.from(new Set(ledger.map((r) => r.transaction_id)))
      const { data: details } = ids.length
        ? await supabase
            .from("transactions")
            .select("transaction_id, classification, members!transactions_member_id_fkey ( name )")
            .in("transaction_id", ids)
        : { data: [] }
      type Detail = { transaction_id: string; classification: string; members: { name: string } | null }
      const byId = new Map(((details ?? []) as unknown as Detail[]).map((d) => [d.transaction_id, d]))
      let running = nextBalance
      nextActivity = ledger.map((r) => {
        const d = byId.get(r.transaction_id)
        const row: ActivityRow = {
          key: `${r.transaction_id}:${r.leg_order}`,
          transaction_id: r.transaction_id,
          date: r.txn_date,
          label: d ? TXN_TYPE_LABELS[d.classification] ?? d.classification : r.description ?? "Transaction",
          who: d?.members?.name ?? null,
          amount: Number(r.cash_effect),
          balanceAfter: Number(running.toFixed(2))
        }
        running -= Number(r.cash_effect)
        return row
      })
      setActivity(nextActivity)
    }

    let nextInterestEarned = interestEarned
    let nextTax = tax
    if (!interestResult.error) {
      let earned = 0
      let taxTotal = 0
      for (const row of interestResult.data ?? []) {
        const bankName = row.bank || (row as any).bank_accounts?.bank_name
        if (bankName !== bank) continue
        if (row.classification === "Bank Interest") earned += Number(row.amount)
        if (row.classification === "Tax") taxTotal += Number(row.amount)
      }
      nextInterestEarned = earned
      nextTax = taxTotal
      setInterestEarned(nextInterestEarned)
      setTax(nextTax)
    } else {
      setLoadError(interestResult.error.message)
    }

    let nextYears = years
    if (!allocationsResult.error) {
      const byYear: Record<string, { amount: number; members: Set<string> }> = {}
      for (const row of allocationsResult.data ?? []) {
        const year = (row.allocation_date || "").slice(0, 4)
        if (!year) continue
        if (!byYear[year]) byYear[year] = { amount: 0, members: new Set() }
        byYear[year].amount += Number(row.amount)
        byYear[year].members.add(row.member_id)
      }
      nextYears = Object.entries(byYear)
        .map(([year, v]) => ({ year, amount: v.amount, memberCount: v.members.size }))
        .sort((a, b) => b.year.localeCompare(a.year))
      setYears(nextYears)
    } else if (!loadError) {
      setLoadError(allocationsResult.error.message)
    }

    setDataLoading(false)

    writeCache<BankDetailSnapshot>(cacheKey, {
      balance: nextBalance,
      interestEarned: nextInterestEarned,
      tax: nextTax,
      years: nextYears,
      qrAccounts: nextQrAccounts,
      accounts: nextAccounts,
      activity: nextActivity
    })
  }

  // Opening a drill-down while the list is scrolled down would otherwise
  // leave the Breakdown header out of view -- jump back to top so it's
  // visible the instant the detail mounts. Runs once, only for the initial
  // open from the bank list -- the year drill-down is a local view swap
  // within this same mount, not a fresh one, so it doesn't hit this again.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    if (bank) {
      load()
      // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data when the selected bank changes
      loadPending()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bank])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (dataLoading) {
    return <SkeletonPanel />
  }

  if (notFound) {
    return (
      <div>
        <p className="text-sm text-ink-soft">This bank couldn&apos;t be found.</p>
        <button onClick={onBack} className="mt-4 text-sm font-medium text-gold">
          ← Back to Banks
        </button>
      </div>
    )
  }

  if (selectedYear) {
    return (
      <BankYearDetailPanel
        bank={bank}
        year={selectedYear}
        onBack={() => setSelectedYear(null)}
      />
    )
  }

  // tax is stored as a negative amount, so adding it nets it out --
  // subtracting it would add the withheld amount back instead.
  const netInterest = interestEarned + tax
  const totalDistributed = years.reduce((sum, y) => sum + y.amount, 0)
  // Not computed independently from interestEarned/totalDistributed --
  // reuses pendingGroups (the same getPendingBankInterestGroups result the
  // "Pending Distribution" section below is built from) so this figure can
  // never drift from what actually gets credited when Distribute is
  // clicked. That function already nets tax out and excludes years whose
  // interest was already fully distributed.
  const undistributed = pendingGroups.reduce((sum, g) => sum + g.totalAmount, 0)
  // Bank detail is keyed by bank name; the admin sheets act on that name's
  // first account, same account the old inline Edit form on the list used.
  const primaryAccount = accounts[0] ?? null
  const accountLabel = accounts.length === 1 ? accounts[0].account_name : null

  return (
    <div>
      <button onClick={onBack} className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors">
        ← Bank
      </button>

      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink min-w-0 break-words">{bank}</h1>
        {isAdmin && primaryAccount && (
          <AdminMenuButton onClick={() => setAdminSheet("actions")} label="Bank admin actions" />
        )}
      </div>
      <p className="text-[13px] text-ink-soft mb-6">
        {accountLabel ?? "Current balance and interest history for this account."}
      </p>

      <div className="card px-5 pt-4 pb-3.5">
        <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">Current Balance</p>
        <p className="font-mono [font-variant-numeric:tabular-nums] text-3xl font-bold text-ink">₱{fmt(balance)}</p>
      </div>

      {qrAccounts.length > 0 && (
        <button
          onClick={() => setZoomedQr(qrAccounts[0])}
          className="w-full flex items-center justify-between gap-3 card px-5 py-3.5 mt-4 hover:bg-paper transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-[18px] h-[18px] text-gold shrink-0">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <path d="M14 14h3v3h-3zM19 14v3M14 19h3M19 19h2v2h-2z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-sm font-semibold text-ink">Scan to Pay</span>
          </div>
          <span className="text-ink-soft">›</span>
        </button>
      )}

      {zoomedQr && (
        <BankQrModal
          title={zoomedQr.account_name || bank}
          url={getBankQrPublicUrl(zoomedQr.qr_code_url)}
          onClose={() => setZoomedQr(null)}
        />
      )}

      {adminSheet === "actions" && primaryAccount && (
        <Sheet title={bank} onClose={() => setAdminSheet(null)}>
          <div className="card">
            <div className="px-5">
              <AdminActionRow
                label="Edit bank details"
                hint="Bank name and account name"
                onClick={() => setAdminSheet("edit")}
              />
              <AdminActionRow
                label={primaryAccount.qr_code_url ? "Update scan-to-pay QR" : "Add scan-to-pay QR"}
                hint={primaryAccount.qr_code_url ? "Replace the QR members pay into" : "No QR code yet"}
                onClick={() => setAdminSheet("qr")}
                last
              />
            </div>
          </div>
        </Sheet>
      )}

      {adminSheet === "edit" && primaryAccount && (
        <BankAccountSheet
          account={primaryAccount}
          onClose={() => setAdminSheet(null)}
          onSaved={(bankName) => {
            onChanged?.()
            if (bankName !== bank) onRenamed?.(bankName)
            else load()
          }}
        />
      )}

      {adminSheet === "qr" && primaryAccount && (
        <BankQrSheet
          account={primaryAccount}
          onClose={() => setAdminSheet(null)}
          onUpdated={() => {
            load()
            onChanged?.()
          }}
        />
      )}

      {reviewGroup && (
        <DistributeInterestSheet
          group={reviewGroup}
          onClose={() => setReviewGroup(null)}
          onDistributed={handleDistributed}
        />
      )}

      <div className="card p-5 mt-4">
        <InfoBox label="Interest">
          <InfoRow label="Interest Earned" value={`+₱${fmt(interestEarned)}`} valueClass="text-sage" />
          {tax !== 0 && <InfoRow label="Tax Withheld" value={`-₱${fmt(Math.abs(tax))}`} valueClass="text-rust" />}
          <InfoRow label="Net Interest" value={`₱${fmt(netInterest)}`} bold />
          <div className="pt-1 space-y-1.5">
            <InfoSubRow label="Distributed to Members" value={`₱${fmt(totalDistributed)}`} />
            {undistributed > 0.01 && (
              <InfoSubRow label="Not Yet Distributed" value={`₱${fmt(undistributed)}`} valueClass="text-gold" />
            )}
          </div>
        </InfoBox>
      </div>

      {loadError && <p className="mt-4 text-sm text-rust">{loadError}</p>}

      {isAdmin && pendingGroups.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-lg font-medium text-ink mb-1">Ready to Distribute</h2>
          <p className="text-[13px] text-ink-soft mb-3">
            ₱{fmt(undistributed)}{" "}approved interest that hasn&apos;t been split across members yet.
          </p>
          <div className="card">
            <div className="px-5">
              {pendingGroups.map((group, i) => (
                <div
                  key={group.year}
                  className={`py-3 flex items-center justify-between gap-3 ${
                    i !== pendingGroups.length - 1 ? "border-b border-dashed border-hairline" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-sm text-ink font-medium">{group.year}</p>
                    <p className="font-mono [font-variant-numeric:tabular-nums] text-[13px] font-semibold text-ink">
                      ₱{fmt(group.totalAmount)}
                    </p>
                    <p className="text-[11px] text-ink-soft">
                      {group.transactionCount} transaction{group.transactionCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <button
                    onClick={() => setReviewGroup(group)}
                    className="shrink-0 bg-ink text-paper px-3.5 py-2 rounded-sm text-[13px] font-medium"
                  >
                    Review &amp; distribute
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="font-display text-lg font-medium text-ink mb-1">Interest by Year</h2>
        <p className="text-[13px] text-ink-soft mb-3">Tap a year to see how it was split across members.</p>

        {years.length > 0 && (
          <div className="card">
            <div className="px-5">
              {years.map((y, i) => (
                <button
                  key={y.year}
                  onClick={() => {
                    yearScrollPosRef.current = window.scrollY
                    setSelectedYear(y.year)
                  }}
                  className={`w-full py-3 flex justify-between items-center gap-3 text-left ${
                    i !== years.length - 1 ? "border-b border-dashed border-hairline" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-sm text-ink font-medium">{y.year}</p>
                    <p className="text-[11px] text-ink-soft">
                      split across {y.memberCount} member{y.memberCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-sage">
                      +₱{fmt(y.amount)}
                    </p>
                    <span className="text-ink-soft">→</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {years.length === 0 && !loadError && (
          <p className="text-sm text-ink-soft text-center py-8 card">
            No interest has been distributed for this bank yet.
          </p>
        )}
      </section>

      {/* What's moved this balance lately -- answers "did that approval
          land?" right where the balance is, instead of cross-checking the
          ledger. Entries approved from this device in the last 30 minutes
          are marked. */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <h2 className="font-display text-lg font-medium text-ink">Recent Activity</h2>
          <button
            onClick={() => router.push(`/transactions?bank=${encodeURIComponent(bank)}`)}
            className="shrink-0 text-[13px] font-medium text-gold"
          >
            View all →
          </button>
        </div>
        <p className="text-[13px] text-ink-soft mb-3">The latest entries that changed this balance.</p>

        {activity.length > 0 ? (
          <div className="card px-5">
            {activity.map((a, i) => {
              const isNew = justApproved.has(a.transaction_id)
              return (
                <div
                  key={a.key}
                  className={`py-3 flex justify-between items-center gap-3 ${
                    i !== activity.length - 1 ? "border-b border-dashed border-hairline" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-sm text-ink truncate">{a.label}</p>
                      {isNew && (
                        <span className="shrink-0 text-[9px] uppercase tracking-wide font-mono text-sage border border-sage/40 rounded px-1.5 py-0.5">
                          Just approved
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-ink-soft font-mono truncate">
                      {a.date
                        ? new Date(`${a.date}T00:00:00`).toLocaleDateString(undefined, {
                            day: "numeric",
                            month: "short",
                            year: "numeric"
                          })
                        : "No date"}
                      {a.who ? ` · ${a.who}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-col items-end shrink-0">
                    <p
                      className={`font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold ${
                        a.amount < 0 ? "text-rust" : "text-sage"
                      }`}
                    >
                      {a.amount < 0 ? "-" : "+"}₱{fmt(Math.abs(a.amount))}
                    </p>
                    <p className="text-[11px] text-ink-soft font-mono whitespace-nowrap">bal ₱{fmt(a.balanceAfter)}</p>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-ink-soft text-center py-8 card">No activity recorded for this bank yet.</p>
        )}
      </section>
    </div>
  )
}
