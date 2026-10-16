"use client"

// Inline replacement for the old standalone /bank/[bank]/[year] route --
// the second level of the Banks drill-down, rendered in place so the
// Breakdown header and tab row stay visible.

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"
import { InfoBox, InfoRow } from "@/app/components/breakdown/InfoBox"
import { readCache, writeCache } from "@/lib/cache"

type Share = {
  member_id: string
  member: string
  amount: number
  allocation_date: string
  current_value: number
  pct_share: number
}

type BankYearDetailSnapshot = {
  shares: Share[]
  interestEarned: number
  tax: number
}

export function BankYearDetailPanel({
  bank,
  year,
  onBack
}: {
  bank: string
  year: string
  onBack: () => void
}) {
  const { member } = useAuth()
  const myMemberId = member?.member_id ?? null

  const cacheKey = `bank-year-detail:${bank}:${year}`
  const cached = readCache<BankYearDetailSnapshot>(cacheKey)

  const [dataLoading, setDataLoading] = useState(!cached)
  const [shares, setShares] = useState<Share[]>(cached?.shares ?? [])
  const [interestEarned, setInterestEarned] = useState(cached?.interestEarned ?? 0)
  const [tax, setTax] = useState(cached?.tax ?? 0)
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState("")

  // Opening a drill-down while the list is scrolled down would otherwise
  // leave the Breakdown header out of view -- jump back to top so it's
  // visible the instant the detail mounts.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    async function load() {
      // Only show the blocking loader on a true cold start -- if we
      // already rendered cached data, refresh quietly behind it instead
      // of flashing back to a spinner on every navigation.
      if (!readCache(cacheKey)) setDataLoading(true)

      // Per-member split for this bank's interest in this calendar year.
      const sharesPromise = supabase
        .from("bank_interest_allocations")
        .select("amount, allocation_date, member_id, current_value, pct_share, members(name)")
        .eq("bank", bank)
        .gte("allocation_date", `${year}-01-01`)
        .lte("allocation_date", `${year}-12-31`)

      // The source Bank Interest/Tax transactions behind that split -- bank
      // falls back to the linked bank_accounts.bank_name and the year to
      // created_at, same fallbacks BankDetailPanel and getPendingBankInterestGroups
      // use, since legacy rows don't reliably have both set.
      const txnPromise = supabase
        .from("transactions")
        .select(
          "classification, amount, bank, txn_date, created_at, bank_accounts!transactions_bank_account_id_fkey ( bank_name )"
        )
        .eq("status", "approved")
        .in("classification", ["Bank Interest", "Tax"])

      const [{ data, error }, { data: txnData, error: txnError }] = await Promise.all([sharesPromise, txnPromise])

      let nextShares = shares
      if (error) {
        setLoadError(error.message)
      } else if (!data || data.length === 0) {
        setNotFound(true)
      } else {
        nextShares = data.map((r: any) => ({
          member_id: r.member_id,
          member: r.members?.name ?? "Unknown",
          amount: Number(r.amount),
          allocation_date: r.allocation_date,
          current_value: Number(r.current_value),
          pct_share: Number(r.pct_share)
        }))
        setShares(nextShares)
      }

      let nextInterestEarned = interestEarned
      let nextTax = tax
      if (txnError) {
        setLoadError(txnError.message)
      } else {
        let earned = 0
        let taxTotal = 0
        for (const row of txnData ?? []) {
          const bankName = row.bank || (row as any).bank_accounts?.bank_name
          if (bankName !== bank) continue
          const rowYear = String(new Date(row.txn_date ?? row.created_at ?? Date.now()).getFullYear())
          if (rowYear !== year) continue
          if (row.classification === "Bank Interest") earned += Number(row.amount)
          if (row.classification === "Tax") taxTotal += Number(row.amount)
        }
        nextInterestEarned = Number(earned.toFixed(2))
        nextTax = Number(taxTotal.toFixed(2))
        setInterestEarned(nextInterestEarned)
        setTax(nextTax)
      }

      setDataLoading(false)

      writeCache<BankYearDetailSnapshot>(cacheKey, {
        shares: nextShares,
        interestEarned: nextInterestEarned,
        tax: nextTax
      })
    }

    if (bank && year) load()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally omitted: the left-out values are fallbacks/cache data, and depending on them would refetch in a loop
  }, [bank, year])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (dataLoading) {
    return <SkeletonPanel />
  }

  if (notFound || (!loadError && shares.length === 0)) {
    return (
      <div>
        <p className="text-sm text-ink-soft">
          No interest distribution found for {bank} in {year}.
        </p>
        <button onClick={onBack} className="mt-4 text-sm font-medium text-gold">
          ← Back to {bank}
        </button>
      </div>
    )
  }

  const sortedShares = [...shares].sort((a, b) => b.amount - a.amount)
  const total = sortedShares.reduce((sum, s) => sum + s.amount, 0)
  const distributionDate = sortedShares[0]?.allocation_date

  return (
    <div>
      <button onClick={onBack} className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors">
        ← {bank}
      </button>

      <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">{bank}</div>
      <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-1">{year} Interest</h1>
      {distributionDate && (
        <p className="text-[13px] text-ink-soft mb-6">
          Distributed{" "}
          {new Date(distributionDate).toLocaleDateString(undefined, {
            month: "long",
            day: "numeric",
            year: "numeric"
          })}
        </p>
      )}

      <div className="card p-5">
        <InfoBox label="Interest">
          <InfoRow label="Interest Earned" value={`+₱${fmt(interestEarned)}`} valueClass="text-sage" />
          {tax !== 0 && <InfoRow label="Tax Withheld" value={`-₱${fmt(Math.abs(tax))}`} valueClass="text-rust" />}
          <InfoRow label="Net Interest" value={`₱${fmt(total)}`} bold />
        </InfoBox>
      </div>

      {loadError && <p className="mt-4 text-sm text-rust">{loadError}</p>}

      <section className="mt-8">
        <h2 className="font-display text-lg font-medium text-ink mb-1">Distributed Share per Member</h2>
        <p className="text-[13px] text-ink-soft mb-3">
          How {bank}&apos;s {year} interest was split across members.
        </p>

        {sortedShares.length > 0 && (
          <div className="card">
            <div className="px-5">
              {sortedShares.map((s, i) => (
                <div
                  key={s.member_id}
                  className={`py-3 flex justify-between items-center gap-3 ${
                    i !== sortedShares.length - 1 ? "border-b border-dashed border-hairline" : ""
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
                  <div className="flex flex-col items-end shrink-0">
                    <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-sage">
                      +₱{fmt(s.amount)}
                    </p>
                    <p className="text-[11px] text-ink-soft font-mono whitespace-nowrap">
                      {s.pct_share.toFixed(2)}% of ₱{fmt(s.current_value)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-hairline flex justify-between items-center">
              <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono">
                Split among {sortedShares.length} member{sortedShares.length === 1 ? "" : "s"}
              </p>
              <p className="font-mono [font-variant-numeric:tabular-nums] text-[13px] font-semibold text-sage">
                +₱{fmt(total)}
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
