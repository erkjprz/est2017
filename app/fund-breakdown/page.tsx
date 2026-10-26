"use client"

import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import { SkeletonCardList, SkeletonPanel } from "@/app/components/Skeleton"
import { useAuth } from "@/app/auth-context"
import type { InterestType } from "@/lib/loanMath"
import { formatInterestLabel, daysTermLabel, durationLabel, paymentOverdueLabel } from "@/lib/loanFormat"
import { getPendingBankInterestGroups, isBankInterestDistributionDue } from "@/lib/bankInterest"
import { LoanDetailPanel } from "@/app/components/breakdown/LoanDetailPanel"
import { BankDetailPanel } from "@/app/components/breakdown/BankDetailPanel"
import { BankAccountSheet } from "@/app/components/breakdown/BankAdminSheets"
import { InvestmentDetailsSheet } from "@/app/components/breakdown/InvestmentAdminSheets"
import { InvestmentDetailPanel } from "@/app/components/breakdown/InvestmentDetailPanel"
import { InfoBox, InfoRow, InfoSubRow } from "@/app/components/breakdown/InfoBox"
import { readCache, writeCache } from "@/lib/cache"
import {
  fetchGroupBreakdownFields,
  GROUP_CACHE_KEY,
  type TrendPoint,
  type MemberRow,
  type FundTotals,
  type GroupSnapshot
} from "@/lib/fundBreakdownGroup"

type Tab = "fund" | "loans" | "banks" | "investments"
type FundView = "you" | "group"

const TABS: { id: Tab; label: string }[] = [
  { id: "fund", label: "Fund" },
  { id: "banks", label: "Banks" },
  { id: "loans", label: "Loans" },
  { id: "investments", label: "Investments" }
]

function isTab(v: string | null): v is Tab {
  return v === "fund" || v === "loans" || v === "banks" || v === "investments"
}

// Restores a saved scroll offset after backing out of a detail panel back
// to a list that's already loaded (no refetch, so no loading skeleton to
// race against).
function restoreScrollY(y: number) {
  window.scrollTo(0, y)
}

export default function FundBreakdownPage() {
  return (
    <Suspense fallback={null}>
      <FundBreakdownHub />
    </Suspense>
  )
}

function FundBreakdownHub() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { loading: authLoading, member } = useAuth()

  const activeTab: Tab = isTab(searchParams.get("tab")) ? (searchParams.get("tab") as Tab) : "fund"
  const activeView: FundView = searchParams.get("view") === "you" ? "you" : "group"

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
  }, [authLoading, member, router])

  function selectTab(tab: Tab) {
    if (tab === activeTab) return
    router.replace(tab === "fund" ? "/fund-breakdown" : `/fund-breakdown?tab=${tab}`, { scroll: false })
  }

  function selectView(view: FundView) {
    if (view === activeView) return
    router.replace(view === "group" ? "/fund-breakdown" : "/fund-breakdown?view=you", { scroll: false })
  }

  if (authLoading || !member) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(3rem+var(--dock-h)+env(safe-area-inset-bottom))]">
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
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(3rem+var(--dock-h)+env(safe-area-inset-bottom))]">
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-1">
            Fund Ledger
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-3">Breakdown</h1>

          {/* Top-level section nav -- plain underline tabs (not a boxed
              control) so it reads as page-level navigation, distinct from
              the pill toggle below it. */}
          <div className="flex border-b border-hairline mb-5">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => selectTab(t.id)}
                className={`flex-1 text-[14px] font-semibold pt-1 pb-2.5 border-b-2 -mb-px transition-colors ${
                  activeTab === t.id ? "text-ink border-gold" : "text-ink-soft border-transparent"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {activeTab === "fund" && (
            <>
              {/* Secondary view toggle -- raised-pill segmented control,
                  matching the Dashboard's You/Fund switcher, so it clearly
                  reads as a sub-choice under the Fund tab rather than a
                  second row of top-level tabs. */}
              <div className="flex bg-paper-2 border border-hairline rounded-full p-[3px] mb-5">
                {(["group", "you"] as FundView[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => selectView(v)}
                    className={`flex-1 py-2 rounded-full text-[13px] font-semibold transition-colors ${
                      activeView === v ? "bg-paper text-ink shadow-sm" : "text-ink-soft"
                    }`}
                  >
                    {v === "group" ? "Est. 2017" : "You"}
                  </button>
                ))}
              </div>

              {activeView === "you" ? (
                <YouPanel memberId={member.member_id} />
              ) : (
                <GroupPanel />
              )}
            </>
          )}

          {activeTab === "loans" && (
            <LoansPanel
              myMemberId={member.member_id}
              isAdmin={member.role === "admin"}
              // ?loan= opens straight into that loan -- the loan rows on an
              // admin's person sheet (Members page).
              initialLoan={searchParams.get("loan")}
              onLoanClosed={() => {
                if (searchParams.get("loan")) router.replace("/fund-breakdown?tab=loans", { scroll: false })
              }}
            />
          )}
          {activeTab === "banks" && (
            <BanksPanel
              isAdmin={member.role === "admin"}
              // ?bank= opens straight into that bank -- the "View →" link on
              // the Admin queue's approval confirmation.
              initialBank={searchParams.get("bank")}
              onBankClosed={() => {
                if (searchParams.get("bank")) router.replace("/fund-breakdown?tab=banks", { scroll: false })
              }}
            />
          )}
          {activeTab === "investments" && (
            <InvestmentsPanel
              isAdmin={member.role === "admin"}
              // ?investment= opens straight into that investment -- the
              // link on a transaction's detail sheet.
              initialInvestment={searchParams.get("investment")}
              onInvestmentClosed={() => {
                if (searchParams.get("investment")) router.replace("/fund-breakdown?tab=investments", { scroll: false })
              }}
            />
          )}
        </div>
      </main>
    </>
  )
}

/* ============================== Fund / You ============================== */

type MemberPerformance = {
  total_contribution: number
  total_withdrawal: number
  net_contribution: number
  bank_interest: number
  investment_gain_loss: number
  loan_gain: number
  bank_writeoff: number
  total_value: number
  money_on_hold: number
  withdrawable_now: number
}

type YearRow = {
  year: string
  contribution: number
  withdrawal: number
  netContribution: number
  bankInterest: number
  loanGain: number
  bankWriteoff: number
  investmentGainLoss: number
  beginningBalance: number
  endingBalance: number
}

// Shared by YouPanel and MemberBreakdownSheet -- both need the exact same
// all-time performance snapshot plus by-year breakdown for a member,
// differing only in whether the value-over-time trend is needed too (only
// YouPanel renders a sparkline for it). Keeping this in one place means a
// fix to one no longer has to be remembered for the other.
type MemberBreakdownSnapshot = {
  performance: MemberPerformance | null
  years: YearRow[]
  trend: TrendPoint[]
}

function useMemberBreakdown(memberId: string, includeTrend: boolean) {
  const cacheKey = `member-breakdown:${memberId}:${includeTrend}`
  const cached = readCache<MemberBreakdownSnapshot>(cacheKey)

  const [dataLoading, setDataLoading] = useState(!cached)
  const [performance, setPerformance] = useState<MemberPerformance | null>(cached?.performance ?? null)
  const [years, setYears] = useState<YearRow[]>(cached?.years ?? [])
  const [trend, setTrend] = useState<TrendPoint[]>(cached?.trend ?? [])
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    let cancelled = false

    async function load() {
      // Only show the blocking loader on a true cold start -- if we
      // already rendered cached data, refresh quietly behind it instead
      // of flashing back to a spinner on every navigation.
      if (!readCache(cacheKey)) setDataLoading(true)

      const performancePromise = supabase
        .from("v_member_performance")
        .select(
          "total_contribution, total_withdrawal, net_contribution, bank_interest, investment_gain_loss, loan_gain, bank_writeoff, total_value, money_on_hold, withdrawable_now"
        )
        .eq("member_id", memberId)
        .single()

      const trendPromise = includeTrend
        ? supabase
            .from("v_member_value_timeline")
            .select("event_date, running_total")
            .eq("member_id", memberId)
            .order("event_date", { ascending: true })
        : Promise.resolve({ data: null as any, error: null as any })

      const txPromise = supabase
        .from("transactions")
        .select("txn_date, classification, amount")
        .eq("member_id", memberId)
        .eq("status", "approved")
        .in("classification", ["Member Contribution", "Member Withdrawal", "Bank Write-off"])

      const bankInterestPromise = supabase
        .from("bank_interest_allocations")
        .select("allocation_date, amount")
        .eq("member_id", memberId)

      const loanGainPromise = supabase
        .from("loan_gain_allocations")
        .select("allocation_date, amount")
        .eq("member_id", memberId)

      const investmentAllocPromise = supabase
        .from("investment_allocations")
        .select("investment_id, allocation_type, amount, allocation_date")
        .eq("member_id", memberId)

      const investmentDatesPromise = supabase.from("v_investment_dates").select("investment_id, last_txn_date")

      const [performanceResult, trendResult, txResult, bankInterestResult, loanGainResult, investmentAllocResult, investmentDatesResult] =
        await Promise.all([
          performancePromise,
          trendPromise,
          txPromise,
          bankInterestPromise,
          loanGainPromise,
          investmentAllocPromise,
          investmentDatesPromise
        ])

      if (cancelled) return

      const firstError =
        performanceResult.error ||
        trendResult.error ||
        txResult.error ||
        bankInterestResult.error ||
        loanGainResult.error ||
        investmentAllocResult.error ||
        investmentDatesResult.error
      if (firstError) setLoadError(firstError.message)

      let nextTrend = trend
      if (includeTrend && !trendResult.error && trendResult.data) {
        nextTrend = (trendResult.data as any[]).map((r: any) => ({ value: Number(r.running_total), date: r.event_date }))
        setTrend(nextTrend)
      }

      let nextPerformance = performance
      if (!performanceResult.error && performanceResult.data) {
        nextPerformance = {
          total_contribution: Number(performanceResult.data.total_contribution),
          total_withdrawal: Number(performanceResult.data.total_withdrawal),
          net_contribution: Number(performanceResult.data.net_contribution),
          bank_interest: Number(performanceResult.data.bank_interest),
          investment_gain_loss: Number(performanceResult.data.investment_gain_loss),
          loan_gain: Number(performanceResult.data.loan_gain),
          bank_writeoff: Number(performanceResult.data.bank_writeoff),
          total_value: Number(performanceResult.data.total_value),
          money_on_hold: Number(performanceResult.data.money_on_hold),
          withdrawable_now: Number(performanceResult.data.withdrawable_now)
        }
        setPerformance(nextPerformance)
      }

      const byYear: Record<string, YearRow> = {}
      const ensure = (year: string) => {
        if (!byYear[year]) {
          byYear[year] = {
            year,
            contribution: 0,
            withdrawal: 0,
            netContribution: 0,
            bankInterest: 0,
            loanGain: 0,
            bankWriteoff: 0,
            investmentGainLoss: 0,
            beginningBalance: 0,
            endingBalance: 0
          }
        }
        return byYear[year]
      }

      ;(txResult.data ?? []).forEach((t: any) => {
        const year = (t.txn_date || "").slice(0, 4)
        if (!year) return
        const amount = Number(t.amount)
        const row = ensure(year)
        if (t.classification === "Member Contribution") {
          row.contribution += amount
          row.netContribution += amount
        } else if (t.classification === "Member Withdrawal") {
          row.withdrawal += amount
          row.netContribution += amount
        } else if (t.classification === "Bank Write-off") {
          row.bankWriteoff += amount
        }
      })

      ;(bankInterestResult.data ?? []).forEach((r: any) => {
        const year = (r.allocation_date || "").slice(0, 4)
        if (!year) return
        ensure(year).bankInterest += Number(r.amount)
      })

      ;(loanGainResult.data ?? []).forEach((r: any) => {
        const year = (r.allocation_date || "").slice(0, 4)
        if (!year) return
        ensure(year).loanGain += Number(r.amount)
      })

      const investmentDateByInvestmentId: Record<string, string> = {}
      ;(investmentDatesResult.data ?? []).forEach((r: any) => {
        investmentDateByInvestmentId[r.investment_id] = r.last_txn_date
      })

      ;(investmentAllocResult.data ?? []).forEach((r: any) => {
        const year = (r.allocation_date || investmentDateByInvestmentId[r.investment_id] || "").slice(0, 4)
        if (!year) return
        const amount = r.allocation_type === "Investment Loss" ? -Number(r.amount) : Number(r.amount)
        ensure(year).investmentGainLoss += amount
      })

      // Walk years oldest-first to build each year's Beginning/Ending Balance --
      // byYear only ever gets an entry for a year with real activity, so the
      // earliest year truly starts from zero.
      let runningBalance = 0
      const ascendingYears = Object.values(byYear).sort((a, b) => a.year.localeCompare(b.year))
      ascendingYears.forEach((row) => {
        row.beginningBalance = runningBalance
        runningBalance += row.netContribution + row.bankInterest + row.loanGain + row.bankWriteoff + row.investmentGainLoss
        row.endingBalance = runningBalance
      })

      const nextYears = ascendingYears.slice().sort((a, b) => b.year.localeCompare(a.year))
      setYears(nextYears)
      setDataLoading(false)

      writeCache<MemberBreakdownSnapshot>(cacheKey, {
        performance: nextPerformance,
        years: nextYears,
        trend: nextTrend
      })
    }

    load()
    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally omitted: the left-out values are fallbacks/cache data, and depending on them would refetch in a loop
  }, [memberId, includeTrend])

  return { dataLoading, performance, years, trend, loadError }
}

function YouPanel({ memberId }: { memberId: string }) {
  const { dataLoading, performance, years, trend: myTrend, loadError } = useMemberBreakdown(memberId, true)
  const [yearIndex, setYearIndex] = useState(0)
  const yearTouchStartX = useRef<number | null>(null)

  const loansCacheKey = `you-loans:${memberId}`
  const cachedLoans = readCache<Loan[]>(loansCacheKey)
  const [loansLoading, setLoansLoading] = useState(!cachedLoans)
  const [myLoans, setMyLoans] = useState<Loan[]>(cachedLoans ?? [])
  const [loansLoadError, setLoansLoadError] = useState("")
  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null)
  // Restores the scroll position lost to LoanDetailPanel's own
  // scroll-to-top-on-open when the user backs out of it.
  const scrollPosRef = useRef(0)
  useEffect(() => {
    if (selectedLoanId === null) restoreScrollY(scrollPosRef.current)
  }, [selectedLoanId])

  useEffect(() => {
    let cancelled = false

    async function loadLoans() {
      // Only show the blocking loader on a true cold start -- if we
      // already rendered cached data, refresh quietly behind it instead
      // of flashing back to a spinner on every navigation.
      if (!readCache(loansCacheKey)) setLoansLoading(true)
      const { data, error } = await supabase
        .from("v_loan_summary")
        .select("*")
        .eq("borrower_member_id", memberId)
        .order("start_date", { ascending: false })

      if (cancelled) return

      if (error) {
        setLoansLoadError(error.message)
      } else {
        const nextLoans = (data as Loan[]) ?? []
        setMyLoans(nextLoans)
        writeCache(loansCacheKey, nextLoans)
      }
      setLoansLoading(false)
    }

    loadLoans()
    return () => {
      cancelled = true
    }
  }, [memberId, loansCacheKey])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const signed = (n: number) => `${n < 0 ? "-" : "+"}₱${fmt(Math.abs(n))}`
  const tone = (n: number) => (n > 0 ? "text-sage" : n < 0 ? "text-rust" : "text-ink-soft")

  // Same touchend-only swipe detection as the Group carousel -- no
  // touchmove listener needed. The container's touch-action: pan-y (set
  // where this is rendered below) is what actually stops a mostly-
  // horizontal swipe from also dragging the page up/down: the browser
  // decides pan vs. no-op per gesture at the OS/compositor level based on
  // that hint, so a genuinely vertical touch still scrolls the page
  // natively, but a horizontal one never does, even if the finger drifts
  // slightly off-axis mid-swipe.
  function handleYearTouchStart(e: React.TouchEvent) {
    yearTouchStartX.current = e.touches[0].clientX
  }

  function handleYearTouchEnd(e: React.TouchEvent) {
    if (yearTouchStartX.current === null) return
    const dx = e.changedTouches[0].clientX - yearTouchStartX.current
    yearTouchStartX.current = null

    if (Math.abs(dx) < 32) return
    setYearIndex((i) => Math.max(0, Math.min(years.length - 1, dx < 0 ? i + 1 : i - 1)))
  }

  if (dataLoading) {
    return <SkeletonPanel />
  }

  const clampedYearIndex = Math.min(yearIndex, Math.max(0, years.length - 1))

  if (selectedLoanId) {
    return <LoanDetailPanel loanId={selectedLoanId} onBack={() => setSelectedLoanId(null)} />
  }

  return (
    <div>
      {loadError && <p className="mb-4 text-sm text-rust">Couldn&apos;t load some of this breakdown: {loadError}</p>}

      {performance != null && (
        <div className="card p-5">
          <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1">Available Balance</p>
          <p className="font-mono [font-variant-numeric:tabular-nums] text-2xl font-bold text-ink mb-4">
            ₱{fmt(performance.withdrawable_now)}
          </p>
          {performance.money_on_hold > 0 && (
            <p className="text-xs text-ink-soft -mt-3 mb-4">
              of ₱{fmt(performance.total_value)} total — ₱{fmt(performance.money_on_hold)} currently tied up in loans/investments
            </p>
          )}
          <div className="mb-4">
            <Sparkline points={myTrend} color="#5F7A5A" />
          </div>

          <InfoBox label="Capital (All-Time)">
            <InfoRow label="Total Contribution" value={`₱${fmt(performance.total_contribution)}`} />
            {performance.total_withdrawal !== 0 && (
              <InfoRow
                label="Total Withdrawal"
                value={`-₱${fmt(Math.abs(performance.total_withdrawal))}`}
                valueClass="text-rust"
              />
            )}
            <InfoRow
              label="Net Contribution"
              value={`${performance.net_contribution < 0 ? "-" : ""}₱${fmt(Math.abs(performance.net_contribution))}`}
              bold
            />
          </InfoBox>

          <InfoBox label="Performance (All-Time)">
            <InfoRow
              label="Total Gain/Loss"
              value={signed(
                performance.bank_interest + performance.investment_gain_loss + performance.loan_gain + performance.bank_writeoff
              )}
              valueClass={tone(
                performance.bank_interest + performance.investment_gain_loss + performance.loan_gain + performance.bank_writeoff
              )}
              bold
            />
            <div className="pt-1 space-y-1.5">
              {performance.bank_writeoff !== 0 && (
                <InfoSubRow
                  label="Bank Write-off"
                  value={signed(performance.bank_writeoff)}
                  valueClass={tone(performance.bank_writeoff)}
                />
              )}
              <InfoSubRow
                label="Investments"
                value={signed(performance.investment_gain_loss)}
                valueClass={tone(performance.investment_gain_loss)}
              />
              <InfoSubRow
                label="Bank Interests"
                value={signed(performance.bank_interest)}
                valueClass={tone(performance.bank_interest)}
              />
              <InfoSubRow
                label="Loans"
                value={signed(performance.loan_gain)}
                valueClass={tone(performance.loan_gain)}
              />
            </div>
          </InfoBox>
        </div>
      )}

      <section className="mt-8">
        <h2 className="font-display text-lg font-medium text-ink mb-1">By Year</h2>
        <p className="text-[13px] text-ink-soft mb-3">
          Contributions, withdrawals, bank interest, loan gain share, and investment gain/loss, by calendar year.
          Investment allocations aren&apos;t dated individually, so each is counted in the year of that investment&apos;s most
          recent transaction.
        </p>

        {years.length === 0 && !loadError && (
          <p className="text-sm text-ink-soft text-center py-8 card">
            No dated activity yet.
          </p>
        )}

        {years.length > 0 && (
          <>
            <div
              className="overflow-hidden"
              style={{ touchAction: "pan-y" }}
              onTouchStart={handleYearTouchStart}
              onTouchEnd={handleYearTouchEnd}
            >
              <div
                className="flex transition-transform duration-300 ease-out will-change-transform motion-reduce:transition-none"
                style={{ transform: `translateX(-${clampedYearIndex * 100}%)` }}
              >
                {years.map((y) => {
                  const yearGainLoss = y.bankInterest + y.loanGain + y.bankWriteoff + y.investmentGainLoss
                  return (
                    <div key={y.year} className="w-full shrink-0 card p-5">
                      <div className="mb-3">
                        <span className="font-display text-xl font-semibold text-ink">{y.year}</span>
                      </div>

                      <InfoBox label="Year Summary">
                        <InfoRow label="Beginning Balance" value={`₱${fmt(y.beginningBalance)}`} />
                        <InfoRow label="Contribution" value={`₱${fmt(y.contribution)}`} />
                        {y.withdrawal !== 0 && (
                          <InfoRow label="Withdrawal" value={`-₱${fmt(Math.abs(y.withdrawal))}`} valueClass="text-rust" />
                        )}
                        <InfoRow label="Gain/Loss" value={signed(yearGainLoss)} valueClass={tone(yearGainLoss)} />
                        <InfoRow label="Ending Balance" value={`₱${fmt(y.endingBalance)}`} bold />
                      </InfoBox>

                      {(y.bankWriteoff !== 0 || y.investmentGainLoss !== 0 || y.bankInterest !== 0 || y.loanGain !== 0) && (
                        <InfoBox label="Gain/Loss Breakdown">
                          {y.bankWriteoff !== 0 && (
                            <InfoSubRow
                              label="Bank Write-off"
                              value={signed(y.bankWriteoff)}
                              valueClass={tone(y.bankWriteoff)}
                            />
                          )}
                          {y.investmentGainLoss !== 0 && (
                            <InfoSubRow
                              label="Investments"
                              value={signed(y.investmentGainLoss)}
                              valueClass={tone(y.investmentGainLoss)}
                            />
                          )}
                          {y.bankInterest !== 0 && (
                            <InfoSubRow label="Bank Interests" value={signed(y.bankInterest)} valueClass={tone(y.bankInterest)} />
                          )}
                          {y.loanGain !== 0 && (
                            <InfoSubRow label="Loans" value={signed(y.loanGain)} valueClass={tone(y.loanGain)} />
                          )}
                        </InfoBox>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {years.length > 1 && (
              <div className="flex items-center justify-center gap-1.5 mt-4">
                {years.map((y, i) => (
                  <button
                    key={y.year}
                    onClick={() => setYearIndex(i)}
                    aria-label={`Go to ${y.year}`}
                    className="w-6 h-6 flex items-center justify-center"
                  >
                    <span
                      className={`block rounded-full transition-all ${
                        i === clampedYearIndex ? "w-4 h-1.5 rounded-[3px] bg-gold" : "w-1.5 h-1.5 bg-hairline"
                      }`}
                    />
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {!loansLoading && myLoans.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-lg font-medium text-ink mb-1">
            Your Loan{myLoans.length > 1 ? "s" : ""}
          </h2>
          <p className="text-[13px] text-ink-soft mb-3">Loans you&apos;re the borrower on, past and present.</p>
          {loansLoadError && <p className="mb-3 text-sm text-rust">Couldn&apos;t load loans: {loansLoadError}</p>}
          <div className="flex flex-col gap-3">
            {myLoans.map((loan) => (
              <LoanCard
                key={loan.loan_id}
                loan={loan}
                meta={loanStatusMeta(loan)}
                fmt={fmt}
                isMine
                onClick={() => {
                  scrollPosRef.current = window.scrollY
                  setSelectedLoanId(loan.loan_id)
                }}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

/* ============================== Fund / Group ============================== */

const SHARE_COLORS = ["#B8912F", "#5F7A5A", "#8FA88A", "#D4B65C", "#A99B84", "#C97B63", "#7A8FA6", "#9C8AA5"]

function GroupPanel() {
  const { member: authMember } = useAuth()
  const cachedGroup = readCache<GroupSnapshot>(GROUP_CACHE_KEY)
  const [members, setMembers] = useState<MemberRow[]>(cachedGroup?.members ?? [])
  const [fund, setFund] = useState<FundTotals | null>(cachedGroup?.fund ?? null)
  const [fundTrend, setFundTrend] = useState<TrendPoint[]>(cachedGroup?.fundTrend ?? [])
  const [loading, setLoading] = useState(!cachedGroup)
  const [loadError, setLoadError] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const [openMember, setOpenMember] = useState<{ id: string; name: string } | null>(null)
  const touchStartX = useRef<number | null>(null)
  const suppressClickRef = useRef(false)
  // Restores the scroll position lost to MemberBreakdownSheet's own
  // scroll-to-top-on-open when the user closes it.
  const memberScrollPosRef = useRef(0)
  useEffect(() => {
    if (openMember === null) restoreScrollY(memberScrollPosRef.current)
  }, [openMember])

  // The seven queries behind this live in lib/fundBreakdownGroup.ts, shared
  // with the splash at / -- which runs the exact same fetch to get this
  // cache warm before ever navigating here. members/fund are all-or-nothing
  // (a members or fund query error means the whole update is skipped,
  // keeping whatever was already on screen); fundTrend degrades on its own
  // -- undefined means keep the current fundTrend rather than clear it.
  useEffect(() => {
    let cancelled = false

    async function load() {
      // Only show the blocking loader on a true cold start -- if we
      // already rendered cached data, refresh quietly behind it instead
      // of flashing back to a spinner on every navigation.
      if (!readCache(GROUP_CACHE_KEY)) setLoading(true)

      const fields = await fetchGroupBreakdownFields()
      if (cancelled) return

      if (fields.error) setLoadError(fields.error)

      if (fields.data) {
        const nextFundTrend = fields.data.fundTrend ?? fundTrend
        setMembers(fields.data.members)
        setFund(fields.data.fund)
        setFundTrend(nextFundTrend)
        writeCache<GroupSnapshot>(GROUP_CACHE_KEY, {
          members: fields.data.members,
          fund: fields.data.fund,
          fundTrend: nextFundTrend
        })
      }

      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally omitted: the left-out values are fallbacks/cache data, and depending on them would refetch in a loop
  }, [])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const signed = (n: number) => `${n < 0 ? "-" : "+"}₱${fmt(Math.abs(n))}`
  const tone = (n: number) => (n > 0 ? "text-sage" : n < 0 ? "text-rust" : "text-ink-soft")

  function handleCarouselTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX
  }

  function handleCarouselTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null

    if (Math.abs(dx) < 10) return

    suppressClickRef.current = true
    if (Math.abs(dx) >= 32) {
      setActiveIndex((i) => Math.max(0, Math.min(members.length - 1, dx < 0 ? i + 1 : i - 1)))
    }
  }

  function handleCardClick(memberId: string, memberName: string, e: React.MouseEvent) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      e.preventDefault()
      return
    }
    memberScrollPosRef.current = window.scrollY
    setOpenMember({ id: memberId, name: memberName })
  }

  if (loading) {
    return <SkeletonCardList rows={4} />
  }

  if (openMember) {
    return (
      <MemberBreakdownSheet
        memberId={openMember.id}
        memberName={openMember.name}
        isSelf={authMember?.member_id === openMember.id}
        onClose={() => setOpenMember(null)}
      />
    )
  }

  const clampedIndex = Math.min(activeIndex, Math.max(0, members.length - 1))

  return (
    <div>
      <p className="text-sm text-ink-soft mt-0 mb-6">
        Ownership based on net contribution, investment performance, bank interest, and loan gain share.
      </p>

      {loadError && <p className="mb-4 text-sm text-rust">Couldn&apos;t load the fund breakdown: {loadError}</p>}

      {members.length > 0 && (
        <div className="card px-5 py-4 mb-6">
          <div className="flex justify-between items-baseline mb-1">
            <span className="text-[11px] uppercase tracking-wide text-ink-soft font-mono">Fund Total Cash</span>
            <span className="text-[13px] text-ink-soft font-mono">{members.length} members</span>
          </div>
          <p className="font-mono [font-variant-numeric:tabular-nums] text-2xl sm:text-3xl font-bold text-ink">
            ₱{fund != null ? fmt(fund.total_cash) : "—"}
          </p>
          <Sparkline points={fundTrend} color="#B8912F" />

          <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono mb-1.5 mt-3.5">Ownership Share</p>
          <div className="flex h-2 rounded-full overflow-hidden bg-hairline">
            {members.map((m, i) => (
              <div
                key={m.member_id}
                title={`${m.name}: ${m.shareOfFund.toFixed(1)}%`}
                style={{
                  width: `${Math.max(0, m.shareOfFund)}%`,
                  backgroundColor: SHARE_COLORS[i % SHARE_COLORS.length]
                }}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 mt-2.5">
            {members.map((m, i) => (
              <div key={m.member_id} className="flex items-center gap-1.5">
                <span
                  className="w-[7px] h-[7px] rounded-full"
                  style={{ backgroundColor: SHARE_COLORS[i % SHARE_COLORS.length] }}
                />
                <span className="text-[10.5px] text-ink-soft font-mono">
                  {m.name} {m.shareOfFund.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {fund != null && (
        <div className="card p-5 mb-6">
          <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-3">Fund Breakdown</p>

          <InfoBox label="Capital">
            <InfoRow label="Total Contribution" value={`₱${fmt(fund.total_contribution)}`} />
            {fund.total_withdrawal !== 0 && (
              <InfoRow
                label="Total Withdrawal"
                value={`-₱${fmt(Math.abs(fund.total_withdrawal))}`}
                valueClass="text-rust"
              />
            )}
            <InfoRow
              label="Net Contribution"
              value={`${fund.net_contribution < 0 ? "-" : ""}₱${fmt(Math.abs(fund.net_contribution))}`}
              bold
            />
          </InfoBox>

          {fund.open_loans_count > 0 && (
            <InfoBox label="Loans">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-ink font-semibold">
                  Outstanding
                  <span className="block text-[11px] text-ink-soft font-normal">{fund.open_loans_count} active</span>
                </span>
                <span className="font-mono [font-variant-numeric:tabular-nums] whitespace-nowrap text-[15px] font-bold text-ink">
                  ₱{fmt(fund.open_loans_outstanding)}
                </span>
              </div>
              <p className="text-[11px] text-ink-soft pt-1">Doesn&apos;t include interest owed.</p>
            </InfoBox>
          )}

          <InfoBox label="Performance">
            <InfoRow
              label="Total Fund Gain/Loss"
              value={signed(
                fund.total_bank_writeoff + fund.total_bank_interest + fund.net_investment_gain_loss + fund.total_loan_gain_distributed
              )}
              valueClass={tone(
                fund.total_bank_writeoff + fund.total_bank_interest + fund.net_investment_gain_loss + fund.total_loan_gain_distributed
              )}
              bold
            />
            <div className="pt-1 space-y-1.5">
              {fund.total_bank_writeoff !== 0 && (
                <InfoSubRow
                  label="Bank Write-off"
                  value={signed(fund.total_bank_writeoff)}
                  valueClass={tone(fund.total_bank_writeoff)}
                />
              )}
              <InfoSubRow
                label="Investments"
                value={signed(fund.net_investment_gain_loss)}
                valueClass={tone(fund.net_investment_gain_loss)}
              />
              <InfoSubRow label="Bank Interests" value={signed(fund.total_bank_interest)} valueClass="text-sage" />
              <InfoSubRow
                label="Loans"
                value={signed(fund.total_loan_gain_distributed)}
                valueClass={tone(fund.total_loan_gain_distributed)}
              />
            </div>
          </InfoBox>
        </div>
      )}

      <div
        className="overflow-hidden"
        style={{ touchAction: "pan-y" }}
        onTouchStart={handleCarouselTouchStart}
        onTouchEnd={handleCarouselTouchEnd}
      >
        <div
          className="flex transition-transform duration-300 ease-out will-change-transform motion-reduce:transition-none"
          style={{ transform: `translateX(-${clampedIndex * 100}%)` }}
        >
          {members.map((member) => (
            <button
              key={member.member_id}
              onClick={(e) => handleCardClick(member.member_id, member.name, e)}
              className="w-full shrink-0 text-left card p-5 hover:bg-paper transition-colors"
            >
              <div className="flex justify-between items-baseline flex-wrap gap-1.5 mb-4">
                <span className="font-display text-xl font-semibold text-ink">{member.name}</span>
                <div className="flex items-baseline gap-2.5">
                  {member.roi !== null && (
                    <span
                      className={`text-[11.5px] font-mono font-semibold px-[7px] py-[2px] rounded-full ${tone(
                        member.roi
                      )} ${member.roi > 0 ? "bg-sage/10" : member.roi < 0 ? "bg-rust/10" : "bg-ink-soft/10"}`}
                    >
                      {member.roi >= 0 ? "+" : ""}
                      {member.roi.toFixed(1)}% return
                    </span>
                  )}
                  <span className="text-[11px] text-ink-soft font-mono">{member.shareOfFund.toFixed(2)}% of fund</span>
                </div>
              </div>

              <InfoBox label="Capital">
                <InfoRow label="Total Contribution" value={`₱${fmt(member.total_contribution)}`} />
                {member.total_withdrawal !== 0 && (
                  <InfoRow
                    label="Total Withdrawal"
                    value={`-₱${fmt(Math.abs(member.total_withdrawal))}`}
                    valueClass="text-rust"
                  />
                )}
                <InfoRow
                  label="Net Contribution"
                  value={`${member.net_contribution < 0 ? "-" : ""}₱${fmt(Math.abs(member.net_contribution))}`}
                  bold
                />
              </InfoBox>

              <InfoBox label="Performance">
                <InfoRow
                  label="Total Gain/Loss"
                  value={signed(member.totalGainLoss)}
                  valueClass={tone(member.totalGainLoss)}
                  bold
                />
                <div className="pt-1 space-y-1.5">
                  {member.bank_writeoff !== 0 && (
                    <InfoSubRow
                      label="Bank Write-off"
                      value={signed(member.bank_writeoff)}
                      valueClass={tone(member.bank_writeoff)}
                    />
                  )}
                  <InfoSubRow
                    label="Investments"
                    value={signed(member.investment_gain_loss)}
                    valueClass={tone(member.investment_gain_loss)}
                  />
                  <InfoSubRow label="Bank Interests" value={signed(member.bank_interest)} valueClass={tone(member.bank_interest)} />
                  <InfoSubRow label="Loans" value={signed(member.loan_gain)} valueClass={tone(member.loan_gain)} />
                </div>
              </InfoBox>

              <div className="mt-4">
                <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1">Available Balance</p>
                <p className="font-mono [font-variant-numeric:tabular-nums] text-2xl font-bold text-ink">
                  ₱{fmt(member.withdrawable_now)}
                </p>
                {member.money_on_hold > 0 && (
                  <p className="text-xs text-ink-soft mt-1">
                    of ₱{fmt(member.total_value)} total — ₱{fmt(member.money_on_hold)} currently tied up in loans/investments
                  </p>
                )}
              </div>

              <p className="text-[11px] text-ink-soft text-right mt-3">View Breakdown →</p>
            </button>
          ))}
        </div>
      </div>

      {members.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 mt-4">
          {members.map((m, i) => (
            <button
              key={m.member_id}
              onClick={() => setActiveIndex(i)}
              aria-label={`Go to ${m.name}`}
              className="w-6 h-6 flex items-center justify-center"
            >
              <span
                className={`block rounded-full transition-all ${
                  i === clampedIndex ? "w-4 h-1.5 rounded-[3px] bg-gold" : "w-1.5 h-1.5 bg-hairline"
                }`}
              />
            </button>
          ))}
        </div>
      )}

    </div>
  )
}

/* A member's full capital/performance breakdown, opened in place over the
   Group tab instead of navigating to its own route -- same data and layout
   the old /member-breakdown/[id] page rendered, just as an overlay so
   closing it returns to exactly where the carousel was left. */
function MemberBreakdownSheet({
  memberId,
  memberName,
  isSelf,
  onClose
}: {
  memberId: string
  memberName: string
  isSelf: boolean
  onClose: () => void
}) {
  const { dataLoading, performance, years, loadError } = useMemberBreakdown(memberId, false)
  const [yearIndex, setYearIndex] = useState(0)
  const yearTouchStartX = useRef<number | null>(null)

  const loansCacheKey = `member-loans:${memberId}`
  const cachedLoans = readCache<Loan[]>(loansCacheKey)
  const [loansLoading, setLoansLoading] = useState(!cachedLoans)
  const [memberLoans, setMemberLoans] = useState<Loan[]>(cachedLoans ?? [])
  const [loansLoadError, setLoansLoadError] = useState("")
  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null)
  const [closedYear, setClosedYear] = useState<number | "all" | null>(null)
  // Restores the scroll position lost to LoanDetailPanel's own
  // scroll-to-top-on-open when the user backs out of it.
  const loanScrollPosRef = useRef(0)
  useEffect(() => {
    if (selectedLoanId === null) restoreScrollY(loanScrollPosRef.current)
  }, [selectedLoanId])

  // Opening this while the Group carousel is scrolled down would otherwise
  // leave the Breakdown header out of view -- jump back to top so it's
  // visible the instant the sheet mounts.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadLoans() {
      // Only show the blocking loader on a true cold start -- if we
      // already rendered cached data, refresh quietly behind it instead
      // of flashing back to a spinner on every navigation.
      if (!readCache(loansCacheKey)) setLoansLoading(true)
      const { data, error } = await supabase
        .from("v_loan_summary")
        .select("*")
        .eq("borrower_member_id", memberId)
        .order("start_date", { ascending: false })

      if (cancelled) return

      if (error) {
        setLoansLoadError(error.message)
      } else {
        const nextLoans = (data as Loan[]) ?? []
        setMemberLoans(nextLoans)
        writeCache(loansCacheKey, nextLoans)
      }
      setLoansLoading(false)
    }

    loadLoans()
    return () => {
      cancelled = true
    }
  }, [memberId, loansCacheKey])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const signed = (n: number) => `${n < 0 ? "-" : "+"}₱${fmt(Math.abs(n))}`
  const tone = (n: number) => (n > 0 ? "text-sage" : n < 0 ? "text-rust" : "text-ink-soft")

  // Same touchend-only swipe detection as YouPanel's/the Group carousel --
  // see YouPanel's handleYearTouchStart/End for why touch-action: pan-y on
  // the wrapping div (set below) is what lets a vertical touch keep
  // scrolling the page natively while a horizontal swipe never does.
  function handleYearTouchStart(e: React.TouchEvent) {
    yearTouchStartX.current = e.touches[0].clientX
  }

  function handleYearTouchEnd(e: React.TouchEvent) {
    if (yearTouchStartX.current === null) return
    const dx = e.changedTouches[0].clientX - yearTouchStartX.current
    yearTouchStartX.current = null

    if (Math.abs(dx) < 32) return
    setYearIndex((i) => Math.max(0, Math.min(years.length - 1, dx < 0 ? i + 1 : i - 1)))
  }

  const clampedYearIndex = Math.min(yearIndex, Math.max(0, years.length - 1))

  const openMemberLoans = memberLoans.filter((l) => l.status !== "closed")
  const closedMemberLoans = memberLoans.filter((l) => l.status === "closed")
  // Newest first. Defaults to the current year when it has closed loans;
  // otherwise falls back to the most recent year that does.
  const closedMemberYears = Array.from(new Set(closedMemberLoans.map(loanYear))).sort((a, b) => b - a)
  const currentYear = new Date().getFullYear()
  const effectiveClosedYear =
    closedYear ?? (closedMemberYears.includes(currentYear) ? currentYear : closedMemberYears[0] ?? "all")
  const visibleClosedMemberLoans =
    effectiveClosedYear === "all"
      ? closedMemberLoans
      : closedMemberLoans.filter((l) => loanYear(l) === effectiveClosedYear)

  if (selectedLoanId) {
    return <LoanDetailPanel loanId={selectedLoanId} onBack={() => setSelectedLoanId(null)} />
  }

  return (
    <div>
      <button onClick={onClose} className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors">
        ← Group
      </button>

      <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">Personal Ledger</div>
      <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-1">
        {isSelf ? "Your Breakdown" : `${memberName}'s Breakdown`}
      </h1>
      <p className="text-[13px] text-ink-soft mb-6">
        {isSelf ? "Your" : `${memberName}'s`} capital and performance, all-time and by year.
      </p>

        {dataLoading ? (
          <SkeletonPanel />
        ) : (
          <>
            {loadError && <p className="mb-4 text-sm text-rust">Couldn&apos;t load some of this breakdown: {loadError}</p>}

            {performance != null && (
              <div className="card p-5">
                <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1">Available Balance</p>
                <p className="font-mono [font-variant-numeric:tabular-nums] text-2xl font-bold text-ink mb-4">
                  ₱{fmt(performance.withdrawable_now)}
                </p>
                {performance.money_on_hold > 0 && (
                  <p className="text-xs text-ink-soft -mt-3 mb-4">
                    of ₱{fmt(performance.total_value)} total — ₱{fmt(performance.money_on_hold)} currently tied up in
                    loans/investments
                  </p>
                )}

                <InfoBox label="Capital (All-Time)">
                  <InfoRow label="Total Contribution" value={`₱${fmt(performance.total_contribution)}`} />
                  {performance.total_withdrawal !== 0 && (
                    <InfoRow
                      label="Total Withdrawal"
                      value={`-₱${fmt(Math.abs(performance.total_withdrawal))}`}
                      valueClass="text-rust"
                    />
                  )}
                  <InfoRow
                    label="Net Contribution"
                    value={`${performance.net_contribution < 0 ? "-" : ""}₱${fmt(Math.abs(performance.net_contribution))}`}
                    bold
                  />
                </InfoBox>

                <InfoBox label="Performance (All-Time)">
                  <InfoRow
                    label="Total Gain/Loss"
                    value={signed(
                      performance.bank_interest + performance.investment_gain_loss + performance.loan_gain + performance.bank_writeoff
                    )}
                    valueClass={tone(
                      performance.bank_interest + performance.investment_gain_loss + performance.loan_gain + performance.bank_writeoff
                    )}
                    bold
                  />
                  <div className="pt-1 space-y-1.5">
                    {performance.bank_writeoff !== 0 && (
                      <InfoSubRow
                        label="Bank Write-off"
                        value={signed(performance.bank_writeoff)}
                        valueClass={tone(performance.bank_writeoff)}
                      />
                    )}
                    <InfoSubRow
                      label="Investments"
                      value={signed(performance.investment_gain_loss)}
                      valueClass={tone(performance.investment_gain_loss)}
                    />
                    <InfoSubRow
                      label="Bank Interests"
                      value={signed(performance.bank_interest)}
                      valueClass={tone(performance.bank_interest)}
                    />
                    <InfoSubRow
                      label="Loans"
                      value={signed(performance.loan_gain)}
                      valueClass={tone(performance.loan_gain)}
                    />
                  </div>
                </InfoBox>
              </div>
            )}

            <section className="mt-8">
              <h2 className="font-display text-lg font-medium text-ink mb-1">By Year</h2>
              <p className="text-[13px] text-ink-soft mb-3">
                Contributions, withdrawals, bank interest, loan gain share, and investment gain/loss, by calendar
                year. Investment allocations aren&apos;t dated individually, so each is counted in the year of that
                investment&apos;s most recent transaction.
              </p>

              {years.length === 0 && !loadError && (
                <p className="text-sm text-ink-soft text-center py-8 card">
                  No dated activity yet.
                </p>
              )}

              {years.length > 0 && (
              <div
                className="overflow-hidden"
                style={{ touchAction: "pan-y" }}
                onTouchStart={handleYearTouchStart}
                onTouchEnd={handleYearTouchEnd}
              >
              <div
                className="flex transition-transform duration-300 ease-out will-change-transform motion-reduce:transition-none"
                style={{ transform: `translateX(-${clampedYearIndex * 100}%)` }}
              >
                {years.map((y) => {
                  const yearGainLoss = y.bankInterest + y.loanGain + y.bankWriteoff + y.investmentGainLoss
                  return (
                    <div key={y.year} className="w-full shrink-0 card p-5">
                      <div className="mb-3">
                        <span className="font-display text-xl font-semibold text-ink">{y.year}</span>
                      </div>

                      <InfoBox label="Year Summary">
                        <InfoRow label="Beginning Balance" value={`₱${fmt(y.beginningBalance)}`} />
                        <InfoRow label="Contribution" value={`₱${fmt(y.contribution)}`} />
                        {y.withdrawal !== 0 && (
                          <InfoRow label="Withdrawal" value={`-₱${fmt(Math.abs(y.withdrawal))}`} valueClass="text-rust" />
                        )}
                        <InfoRow label="Gain/Loss" value={signed(yearGainLoss)} valueClass={tone(yearGainLoss)} />
                        <InfoRow label="Ending Balance" value={`₱${fmt(y.endingBalance)}`} bold />
                      </InfoBox>

                      {(y.bankWriteoff !== 0 || y.investmentGainLoss !== 0 || y.bankInterest !== 0 || y.loanGain !== 0) && (
                        <InfoBox label="Gain/Loss Breakdown">
                          {y.bankWriteoff !== 0 && (
                            <InfoSubRow
                              label="Bank Write-off"
                              value={signed(y.bankWriteoff)}
                              valueClass={tone(y.bankWriteoff)}
                            />
                          )}
                          {y.investmentGainLoss !== 0 && (
                            <InfoSubRow
                              label="Investments"
                              value={signed(y.investmentGainLoss)}
                              valueClass={tone(y.investmentGainLoss)}
                            />
                          )}
                          {y.bankInterest !== 0 && (
                            <InfoSubRow label="Bank Interests" value={signed(y.bankInterest)} valueClass={tone(y.bankInterest)} />
                          )}
                          {y.loanGain !== 0 && (
                            <InfoSubRow label="Loans" value={signed(y.loanGain)} valueClass={tone(y.loanGain)} />
                          )}
                        </InfoBox>
                      )}
                    </div>
                  )
                })}
              </div>
              </div>
              )}

              {years.length > 1 && (
                <div className="flex items-center justify-center gap-1.5 mt-4">
                  {years.map((y, i) => (
                    <button
                      key={y.year}
                      onClick={() => setYearIndex(i)}
                      aria-label={`Go to ${y.year}`}
                      className="w-6 h-6 flex items-center justify-center"
                    >
                      <span
                        className={`block rounded-full transition-all ${
                          i === clampedYearIndex ? "w-4 h-1.5 rounded-[3px] bg-gold" : "w-1.5 h-1.5 bg-hairline"
                        }`}
                      />
                    </button>
                  ))}
                </div>
              )}
            </section>

            {!loansLoading && memberLoans.length > 0 && (
              <section className="mt-8">
                <h2 className="font-display text-lg font-medium text-ink mb-1">
                  {isSelf ? "Your Loan" : `${memberName}'s Loan`}
                  {memberLoans.length > 1 ? "s" : ""}
                </h2>
                <p className="text-[13px] text-ink-soft mb-3">
                  {isSelf ? "Loans you're the borrower on" : `Loans ${memberName} is the borrower on`}, past and
                  present.
                </p>
                {loansLoadError && <p className="mb-3 text-sm text-rust">Couldn&apos;t load loans: {loansLoadError}</p>}

                {openMemberLoans.length > 0 && (
                  <div className="flex flex-col gap-3 mb-3">
                    {openMemberLoans.map((loan) => (
                      <LoanCard
                        key={loan.loan_id}
                        loan={loan}
                        meta={loanStatusMeta(loan)}
                        fmt={fmt}
                        isMine={isSelf}
                        onClick={() => {
                          loanScrollPosRef.current = window.scrollY
                          setSelectedLoanId(loan.loan_id)
                        }}
                      />
                    ))}
                  </div>
                )}

                {closedMemberYears.length > 1 && (
                  <div className="flex gap-2 overflow-x-auto mb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <button
                      type="button"
                      onClick={() => setClosedYear("all")}
                      className={`shrink-0 border rounded-full px-3.5 py-1.5 text-sm whitespace-nowrap ${
                        effectiveClosedYear === "all" ? "bg-gold-soft border-gold-soft text-ink font-semibold" : "border-hairline text-ink-soft"
                      }`}
                    >
                      All
                    </button>
                    {closedMemberYears.map((y) => (
                      <button
                        key={y}
                        type="button"
                        onClick={() => setClosedYear(y)}
                        className={`shrink-0 border rounded-full px-3.5 py-1.5 text-sm whitespace-nowrap ${
                          effectiveClosedYear === y ? "bg-gold-soft border-gold-soft text-ink font-semibold" : "border-hairline text-ink-soft"
                        }`}
                      >
                        {y}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex flex-col gap-3">
                  {visibleClosedMemberLoans.map((loan) => (
                    <LoanCard
                      key={loan.loan_id}
                      loan={loan}
                      meta={loanStatusMeta(loan)}
                      fmt={fmt}
                      isMine={isSelf}
                      onClick={() => {
                        loanScrollPosRef.current = window.scrollY
                        setSelectedLoanId(loan.loan_id)
                      }}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
    </div>
  )
}

/* ============================== Loans ============================== */

type Loan = {
  loan_id: string
  loan: string
  status: "requested" | "active" | "closed"
  start_date: string
  closed_date: string | null
  borrower: string
  borrower_member_id: string | null
  principal: number
  repayment: number
  gain: number
  outstanding: number
  total_repayable: number
  term_months: number | null
  interest_type: InterestType | null
  interest_rate: number | null
  interest_amount: number | null
  repayment_frequency: string | null
  last_repayment_date: string | null
  due_day: number | null
  due_date: string | null
}

function termLabel(loan: Loan): string | null {
  if (loan.repayment_frequency === "lump_sum" && loan.due_date) return daysTermLabel(loan.start_date, loan.due_date)
  return loan.term_months != null ? `${loan.term_months} mo` : null
}

// A closed loan isn't always a full repayment -- "Close Early"
// closes it with whatever was actually repaid, which can be less than
// total_repayable. Label off the real repayment total instead of assuming
// every closed loan was paid off in full (same rule as LoanDetailPanel).
function loanStatusMeta(loan: Loan): { label: string; dot: string; text: string } {
  if (loan.status === "active") return { label: "Active", dot: "bg-gold", text: "text-gold" }
  if (loan.status === "requested") return { label: "Requested", dot: "bg-ink-soft", text: "text-ink-soft" }
  return loan.repayment >= loan.total_repayable
    ? { label: "Repaid in full", dot: "bg-sage", text: "text-sage" }
    : { label: "Closed early", dot: "bg-rust", text: "text-rust" }
}

// Falls back to start_date for the rare closed loan missing a closed_date.
function loanYear(loan: Loan): number {
  return new Date(loan.closed_date ?? loan.start_date).getFullYear()
}

// Every loan the fund has released -- fund-wide, not scoped to a member.
const LOANS_CACHE_KEY = "fund-breakdown:loans"

function LoansPanel({
  myMemberId,
  isAdmin,
  initialLoan,
  onLoanClosed
}: {
  myMemberId: string | null
  isAdmin: boolean
  initialLoan?: string | null
  onLoanClosed?: () => void
}) {
  const cachedLoans = readCache<Loan[]>(LOANS_CACHE_KEY)
  const [loading, setLoading] = useState(!cachedLoans)
  const [loans, setLoans] = useState<Loan[]>(cachedLoans ?? [])
  const [loadError, setLoadError] = useState("")
  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(initialLoan ?? null)
  const [closedYear, setClosedYear] = useState<number | "all" | null>(null)
  // Bumped by LoanDetailPanel after an admin action so the list (and its
  // Needs action card) is fresh when backing out of the loan.
  const [reloadKey, setReloadKey] = useState(0)
  // Restores the scroll position lost to LoanDetailPanel's own
  // scroll-to-top-on-open when the user backs out of it.
  const scrollPosRef = useRef(0)
  useEffect(() => {
    if (selectedLoanId === null) restoreScrollY(scrollPosRef.current)
  }, [selectedLoanId])

  useEffect(() => {
    let cancelled = false

    async function load() {
      // Only show the blocking loader on a true cold start -- if we
      // already rendered cached data, refresh quietly behind it instead
      // of flashing back to a spinner on every navigation.
      if (!readCache(LOANS_CACHE_KEY)) setLoading(true)

      const { data, error } = await supabase
        .from("v_loan_summary")
        .select("*")
        .order("start_date", { ascending: false })

      if (cancelled) return

      if (error) {
        setLoadError(error.message)
      } else {
        const nextLoans = (data as Loan[]) ?? []
        setLoans(nextLoans)
        writeCache(LOANS_CACHE_KEY, nextLoans)
      }

      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (loading) {
    return <SkeletonCardList rows={4} />
  }

  if (selectedLoanId) {
    return (
      <LoanDetailPanel
        loanId={selectedLoanId}
        onBack={() => {
          setSelectedLoanId(null)
          onLoanClosed?.()
        }}
        onChanged={() => setReloadKey((k) => k + 1)}
      />
    )
  }

  const openLoans = loans.filter((l) => l.status !== "closed")
  // A requested loan hasn't been released yet -- nothing is owed until it
  // is, so it stays out of Outstanding and its total (the fund's own
  // totals only count active loans too). Admins see it under Needs action;
  // everyone else gets a separate Requested list.
  const requestedLoans = openLoans.filter((l) => l.status === "requested")
  const outstandingLoans = openLoans.filter((l) => l.status !== "requested")
  const closedLoans = loans.filter((l) => l.status === "closed")
  const totalInterestEarned = closedLoans.reduce((sum, l) => sum + l.gain, 0)
  const totalOutstanding = outstandingLoans.reduce((sum, l) => sum + l.outstanding, 0)

  // Admin-only to-do list: loans waiting on a release, loans repaid in full
  // and ready to close, and loans behind on payments. Each row opens the
  // loan, where its Next Step / ⋯ menu has the matching action.
  const needsAction = isAdmin
    ? openLoans.flatMap((l) => {
        if (l.status === "requested") return [{ loan: l, label: "Awaiting release", tone: "text-ink-soft" }]
        if (l.status === "active" && l.outstanding <= 0) return [{ loan: l, label: "Ready to close", tone: "text-sage" }]
        const overdue = paymentOverdueLabel(l.status, l.repayment_frequency, l.start_date, l.last_repayment_date, l.due_day)
        return overdue ? [{ loan: l, label: overdue, tone: "text-rust" }] : []
      })
    : []

  function openLoan(loanId: string) {
    scrollPosRef.current = window.scrollY
    setSelectedLoanId(loanId)
  }

  // Newest first. Defaults to the current year when it has closed loans;
  // otherwise falls back to the most recent year that does.
  const closedYears = Array.from(new Set(closedLoans.map(loanYear))).sort((a, b) => b - a)
  const currentYear = new Date().getFullYear()
  const effectiveClosedYear =
    closedYear ?? (closedYears.includes(currentYear) ? currentYear : closedYears[0] ?? "all")
  const visibleClosedLoans =
    effectiveClosedYear === "all" ? closedLoans : closedLoans.filter((l) => loanYear(l) === effectiveClosedYear)

  return (
    <div>
      <p className="text-[13px] text-ink-soft mb-6">Every loan the fund has released, and what came back.</p>

      {!loadError && loans.length > 0 && (
        <div className="card px-5 pt-4 pb-3.5 mb-6">
          <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">Total Outstanding</p>
          <p className="font-mono [font-variant-numeric:tabular-nums] text-3xl font-bold text-ink">
            ₱{fmt(totalOutstanding)}
          </p>
          <p className="text-[11px] text-ink-soft mt-1">
            across {outstandingLoans.length} outstanding loan{outstandingLoans.length === 1 ? "" : "s"}
          </p>

          {closedLoans.length > 0 && (
            <div className="flex items-baseline justify-between mt-3.5 pt-3 border-t border-hairline">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">Interest Earned</p>
                <p className="text-[10px] text-ink-soft mt-0.5">
                  across {closedLoans.length} closed loan{closedLoans.length === 1 ? "" : "s"}
                </p>
              </div>
              <p
                className={`font-mono [font-variant-numeric:tabular-nums] text-[15px] font-semibold ${
                  totalInterestEarned > 0 ? "text-sage" : totalInterestEarned < 0 ? "text-rust" : "text-ink"
                }`}
              >
                {totalInterestEarned < 0 ? "-" : "+"}₱{fmt(Math.abs(totalInterestEarned))}
              </p>
            </div>
          )}
        </div>
      )}

      {needsAction.length > 0 && (
        <div className="card mb-6">
          <div className="px-5 pt-4 pb-2">
            <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1">Needs action</p>
            <p className="text-sm text-ink">
              {needsAction.length} loan{needsAction.length === 1 ? "" : "s"} waiting on an admin.
            </p>
            <div className="mt-2">
              {needsAction.map(({ loan, label, tone }) => (
                <button
                  key={loan.loan_id}
                  onClick={() => openLoan(loan.loan_id)}
                  className="w-full py-2.5 flex items-center justify-between gap-3 text-left border-t border-dashed border-hairline"
                >
                  <span className="min-w-0">
                    <span className="block text-sm text-ink font-medium truncate">{loan.loan}</span>
                    <span className={`block text-[11px] font-mono uppercase tracking-wide ${tone}`}>{label}</span>
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-ink">
                      {loan.status === "active" && loan.outstanding <= 0
                        ? `+₱${fmt(loan.gain)}`
                        : `₱${fmt(loan.status === "requested" ? loan.principal : loan.outstanding)}`}
                    </span>
                    <span className="text-ink-soft">→</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {loadError && <p className="mb-4 text-sm text-rust">Couldn&apos;t load loans: {loadError}</p>}

      {!loadError && loans.length === 0 && (
        <p className="text-sm text-ink-soft text-center py-12">No loans on record yet.</p>
      )}

      {!isAdmin && requestedLoans.length > 0 && (
        <section className="mb-7">
          <h2 className="text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-3">Requested</h2>
          <div className="flex flex-col gap-3">
            {requestedLoans.map((loan) => (
              <LoanCard
                key={loan.loan_id}
                loan={loan}
                meta={loanStatusMeta(loan)}
                fmt={fmt}
                isMine={loan.borrower_member_id === myMemberId}
                onClick={() => openLoan(loan.loan_id)}
              />
            ))}
          </div>
        </section>
      )}

      {outstandingLoans.length > 0 && (
        <section className="mb-7">
          <h2 className="text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-3">Outstanding</h2>
          <div className="flex flex-col gap-3">
            {outstandingLoans.map((loan) => (
              <LoanCard
                key={loan.loan_id}
                loan={loan}
                meta={loanStatusMeta(loan)}
                fmt={fmt}
                isMine={loan.borrower_member_id === myMemberId}
                onClick={() => openLoan(loan.loan_id)}
              />
            ))}
          </div>
        </section>
      )}

      {closedLoans.length > 0 && (
        <section>
          <h2 className="text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-3">Closed</h2>

          {closedYears.length > 1 && (
            <div className="flex gap-2 overflow-x-auto mb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <button
                type="button"
                onClick={() => setClosedYear("all")}
                className={`shrink-0 border rounded-full px-3.5 py-1.5 text-sm whitespace-nowrap ${
                  effectiveClosedYear === "all" ? "bg-gold-soft border-gold-soft text-ink font-semibold" : "border-hairline text-ink-soft"
                }`}
              >
                All
              </button>
              {closedYears.map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => setClosedYear(y)}
                  className={`shrink-0 border rounded-full px-3.5 py-1.5 text-sm whitespace-nowrap ${
                    effectiveClosedYear === y ? "bg-gold-soft border-gold-soft text-ink font-semibold" : "border-hairline text-ink-soft"
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-3">
            {visibleClosedLoans.map((loan) => (
              <LoanCard
                key={loan.loan_id}
                loan={loan}
                meta={loanStatusMeta(loan)}
                fmt={fmt}
                isMine={loan.borrower_member_id === myMemberId}
                onClick={() => openLoan(loan.loan_id)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function LoanCard({
  loan,
  meta,
  fmt,
  isMine,
  onClick
}: {
  loan: Loan
  meta: { label: string; dot: string; text: string }
  fmt: (n: number) => string
  isMine: boolean
  onClick: () => void
}) {
  // Driven by the real repaid amount, not total_repayable - outstanding --
  // outstanding is forced to 0 for any closed loan (see v_loan_summary),
  // which would otherwise show a full bar even for a write-off that was
  // never actually repaid.
  const repaidPct = loan.total_repayable > 0 ? Math.min(100, (loan.repayment / loan.total_repayable) * 100) : 0
  const fullyRepaid = loan.repayment >= loan.total_repayable

  const overdueLabel = paymentOverdueLabel(
    loan.status,
    loan.repayment_frequency,
    loan.start_date,
    loan.last_repayment_date,
    loan.due_day
  )

  const subtitleParts = [
    termLabel(loan),
    loan.status === "closed" && durationLabel(loan.start_date, loan.closed_date)
      ? `paid off in ${durationLabel(loan.start_date, loan.closed_date)}`
      : null
  ].filter((part): part is string => Boolean(part))

  return (
    <button
      onClick={onClick}
      className="w-full text-left card px-5 py-4 hover:bg-paper transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="font-display text-[17px] font-semibold text-ink truncate">{loan.loan}</p>
            {isMine && (
              <span className="shrink-0 text-[9px] uppercase tracking-wide font-mono text-gold border border-gold/40 rounded px-1.5 py-0.5">
                You
              </span>
            )}
          </div>
          {/* Borrower and year-month already lead the loan's own name
              above -- this line only adds what that doesn't cover. */}
          {subtitleParts.length > 0 && (
            <p className="text-[12px] text-ink-soft">{subtitleParts.join(" · ")}</p>
          )}
          {overdueLabel && (
            <p className="text-[11px] font-mono uppercase tracking-wide text-rust mt-1">⚠ {overdueLabel}</p>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
            <span className={`text-[11px] font-mono uppercase tracking-wide ${meta.text}`}>{meta.label}</span>
          </div>
          <span className="text-ink-soft">→</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 items-baseline mt-3.5">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">Principal</p>
          <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-ink">
            ₱{fmt(loan.principal)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gold font-mono font-bold">Interest</p>
          <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-gold">
            {formatInterestLabel(loan.interest_type, loan.interest_rate, loan.interest_amount, fmt)}
          </p>
        </div>
        {loan.status === "closed" ? (
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">
              {loan.gain >= 0 ? "Gain" : "Loss"}
            </p>
            <p
              className={`font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold ${
                loan.gain >= 0 ? "text-sage" : "text-rust"
              }`}
            >
              {loan.gain >= 0 ? "+" : "-"}₱{fmt(Math.abs(loan.gain))}
            </p>
          </div>
        ) : loan.status === "requested" ? (
          // Nothing's owed until it's released -- show what will be.
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">To repay</p>
            <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-ink-soft">
              ₱{fmt(loan.total_repayable)}
            </p>
          </div>
        ) : (
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">Outstanding</p>
            <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-ink">
              ₱{fmt(loan.outstanding)}
            </p>
          </div>
        )}
      </div>

      {!(loan.status === "closed" && fullyRepaid) && (
        <div className="h-1.5 rounded-full bg-hairline overflow-hidden mt-2.5">
          <div
            className={`h-full ${loan.status === "closed" ? "bg-rust" : "bg-gold"}`}
            style={{ width: `${repaidPct}%` }}
          />
        </div>
      )}
    </button>
  )
}

/* ============================== Banks ============================== */

type Bank = {
  bank: string
  balance: number
  interest_earned: number
  tax: number
  distributed: number
  pending_interest: number
  // The part of pending_interest from years already due (from Jan 1 of the
  // next year) --
  // only this drives the admin "Needs distribution" banner.
  due_interest?: number
}


type BanksSnapshot = {
  banks: Bank[]
}

// Fund-wide list of bank accounts and balances, not scoped to a member.
const BANKS_CACHE_KEY = "fund-breakdown:banks"

function BanksPanel({
  isAdmin,
  initialBank,
  onBankClosed
}: {
  isAdmin: boolean
  initialBank?: string | null
  onBankClosed?: () => void
}) {
  const cachedBanks = readCache<BanksSnapshot>(BANKS_CACHE_KEY)
  const [loading, setLoading] = useState(!cachedBanks)
  const [banks, setBanks] = useState<Bank[]>(cachedBanks?.banks ?? [])
  const [loadError, setLoadError] = useState("")
  const [selectedBank, setSelectedBank] = useState<string | null>(initialBank ?? null)
  // Restores the scroll position lost to BankDetailPanel's own
  // scroll-to-top-on-open when the user backs out of it. The year
  // drill-down within a bank is BankDetailPanel's own concern now (it
  // never remounts for that transition, so it never needs this).
  const bankScrollPosRef = useRef(0)
  useEffect(() => {
    if (selectedBank === null) restoreScrollY(bankScrollPosRef.current)
  }, [selectedBank])

  const [showAddSheet, setShowAddSheet] = useState(false)

  async function load() {
    // Only show the blocking loader on a true cold start -- if we already
    // rendered cached data (including a quiet reload after saving a bank),
    // refresh quietly behind it instead of flashing back to a spinner.
    if (!readCache(BANKS_CACHE_KEY)) setLoading(true)

    const bankAccountsPromise = supabase.from("bank_accounts").select("*").order("bank_name")
    const balancesPromise = supabase.from("v_bank_balances").select("*")
    // bank falls back to the linked bank_accounts.bank_name -- transactions
    // recorded through the current form only set bank_account_id, leaving
    // the legacy bank text column null. v_cash_ledger already resolves the
    // same way (COALESCE(t.bank, ba.account_name, ba.bank_name)); this
    // mirrors it so a bank's balance and its interest/tax never disagree
    // about which bank a transaction belongs to.
    const interestPromise = supabase
      .from("transactions")
      .select("bank, classification, amount, bank_accounts!transactions_bank_account_id_fkey ( bank_name )")
      .eq("status", "approved")
      .in("classification", ["Bank Interest", "Tax"])
    const distributedPromise = supabase.from("bank_interest_allocations").select("bank, amount")
    // Same source the admin Distrib. tab is built from -- reusing it here
    // instead of tracking pending status from the raw transactions means
    // this "not yet distributed" figure can never drift from what
    // Distribute actually credits (tax netted out, orphaned already-
    // distributed years excluded). Caught locally, unlike the other
    // promises here -- getPendingBankInterestGroups throws instead of
    // resolving to {error}, which would otherwise abort the whole
    // Promise.all and leave every other result here unprocessed too.
    const pendingGroupsPromise = getPendingBankInterestGroups().catch((err) => {
      setLoadError(err instanceof Error ? err.message : "Couldn't load pending interest.")
      return []
    })

    const [bankAccountsResult, balancesResult, interestResult, distributedResult, pendingGroups] = await Promise.all([
      bankAccountsPromise,
      balancesPromise,
      interestPromise,
      distributedPromise,
      pendingGroupsPromise
    ])

    if (bankAccountsResult.error) {
      setLoadError(bankAccountsResult.error.message)
      setLoading(false)
      return
    }

    const byBank: Record<string, Bank> = {}
    for (const acct of bankAccountsResult.data ?? []) {
      byBank[acct.bank_name] = { bank: acct.bank_name, balance: 0, interest_earned: 0, tax: 0, distributed: 0, pending_interest: 0 }
    }

    if (!balancesResult.error) {
      for (const row of balancesResult.data ?? []) {
        if (!byBank[row.bank]) byBank[row.bank] = { bank: row.bank, balance: 0, interest_earned: 0, tax: 0, distributed: 0, pending_interest: 0 }
        byBank[row.bank].balance = Number(row.balance)
      }
    } else {
      setLoadError(balancesResult.error.message)
    }

    if (!interestResult.error) {
      for (const row of interestResult.data ?? []) {
        const bankName = row.bank || (row as any).bank_accounts?.bank_name
        // Shouldn't happen -- every transaction here should resolve to a
        // real bank one way or the other -- but skip rather than pool
        // unattributed interest/tax into a bogus "unknown bank" card.
        if (!bankName) continue
        if (!byBank[bankName]) byBank[bankName] = { bank: bankName, balance: 0, interest_earned: 0, tax: 0, distributed: 0, pending_interest: 0 }
        if (row.classification === "Bank Interest") byBank[bankName].interest_earned += Number(row.amount)
        if (row.classification === "Tax") byBank[bankName].tax += Number(row.amount)
      }
    } else {
      setLoadError(interestResult.error.message)
    }

    if (!distributedResult.error) {
      for (const row of distributedResult.data ?? []) {
        if (!byBank[row.bank]) byBank[row.bank] = { bank: row.bank, balance: 0, interest_earned: 0, tax: 0, distributed: 0, pending_interest: 0 }
        byBank[row.bank].distributed += Number(row.amount)
      }
    } else {
      setLoadError(distributedResult.error.message)
    }

    for (const group of pendingGroups) {
      if (!byBank[group.bank]) {
        byBank[group.bank] = { bank: group.bank, balance: 0, interest_earned: 0, tax: 0, distributed: 0, pending_interest: 0 }
      }
      byBank[group.bank].pending_interest += group.totalAmount
      if (isBankInterestDistributionDue(group.year)) {
        byBank[group.bank].due_interest = (byBank[group.bank].due_interest ?? 0) + group.totalAmount
      }
    }

    const nextBanks = Object.values(byBank).sort((a, b) => b.balance - a.balance)
    setBanks(nextBanks)
    setLoading(false)

    writeCache<BanksSnapshot>(BANKS_CACHE_KEY, { banks: nextBanks })
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data once on mount
    load()
  }, [])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (loading) {
    return <SkeletonCardList rows={3} />
  }

  if (selectedBank) {
    return (
      <BankDetailPanel
        bank={selectedBank}
        onBack={() => {
          setSelectedBank(null)
          onBankClosed?.()
        }}
        onChanged={load}
        onRenamed={setSelectedBank}
      />
    )
  }

  const totalBalance = banks.reduce((sum, b) => sum + b.balance, 0)
  // tax is stored as a negative amount, so adding it nets it out -- subtracting
  // it would add the withheld amount back instead.
  const totalNetInterest = banks.reduce((sum, b) => sum + (b.interest_earned + b.tax), 0)
  const dueBanks = banks.filter((b) => (b.due_interest ?? 0) > 0.01)
  const totalDue = dueBanks.reduce((sum, b) => sum + (b.due_interest ?? 0), 0)

  function openBank(bank: string) {
    bankScrollPosRef.current = window.scrollY
    setSelectedBank(bank)
  }

  return (
    <div>
      {/* The list itself is read-only -- every per-bank admin action (edit,
          QR, distribute) lives on that bank's own page, behind its ⋯ menu.
          Only Add Bank, which has no bank to live on yet, stays here, on the
          same row as the intro so it doesn't sit alone on a line of its own. */}
      <div className="flex items-center justify-between gap-4 mb-5">
        <p className="text-[13px] text-ink-soft">Where the fund&apos;s cash sits, and the interest each account has earned.</p>
        {isAdmin && (
          <button
            className="shrink-0 bg-gold-soft text-ink px-3.5 py-2 rounded-sm text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity flex items-center gap-1.5"
            onClick={() => setShowAddSheet(true)}
          >
            <span className="text-lg leading-none">+</span>
            Add Bank
          </button>
        )}
      </div>

      {showAddSheet && (
        <BankAccountSheet account={null} onClose={() => setShowAddSheet(false)} onSaved={() => load()} />
      )}

      {isAdmin && !loadError && dueBanks.length > 0 && (
        <div className="card mb-4">
          <div className="px-5 pt-4 pb-2">
            <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1">Needs distribution</p>
            <p className="text-sm text-ink">
              <span className="font-mono [font-variant-numeric:tabular-nums] font-semibold">₱{fmt(totalDue)}</span>{" "}
              interest is ready to split across members.
            </p>
            <p className="text-[12px] text-ink-soft mt-1.5">
              Before distributing, make sure December&apos;s interest and tax are logged for BDO and Maya.
            </p>
            <div className="mt-2">
              {dueBanks.map((b) => (
                <button
                  key={b.bank}
                  onClick={() => openBank(b.bank)}
                  className="w-full py-2.5 flex items-center justify-between gap-3 text-left border-t border-dashed border-hairline"
                >
                  <span className="text-sm text-ink font-medium truncate">{b.bank}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-gold">
                      ₱{fmt(b.due_interest ?? 0)}
                    </span>
                    <span className="text-ink-soft">→</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {!loadError && banks.length > 0 && (
        <div className="card px-5 pt-4 pb-3.5 mb-6">
          <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">Total Bank Balance</p>
          <p className="font-mono [font-variant-numeric:tabular-nums] text-3xl font-bold text-ink">₱{fmt(totalBalance)}</p>
          <p className="text-[11px] text-ink-soft mt-1">
            across {banks.length} account{banks.length === 1 ? "" : "s"}
          </p>

          <div className="flex items-baseline justify-between mt-3.5 pt-3 border-t border-hairline">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">Interest Earned</p>
              <p className="text-[10px] text-ink-soft mt-0.5">
                across {banks.length} account{banks.length === 1 ? "" : "s"}
              </p>
            </div>
            <p
              className={`font-mono [font-variant-numeric:tabular-nums] text-[15px] font-semibold ${
                totalNetInterest > 0 ? "text-sage" : totalNetInterest < 0 ? "text-rust" : "text-ink"
              }`}
            >
              {totalNetInterest < 0 ? "-" : "+"}₱{fmt(Math.abs(totalNetInterest))}
            </p>
          </div>
        </div>
      )}

      {loadError && <p className="mb-4 text-sm text-rust">Couldn&apos;t load banks: {loadError}</p>}

      {!loadError && banks.length === 0 && (
        <p className="text-sm text-ink-soft text-center py-12">No bank accounts on record yet.</p>
      )}

      <div className="flex flex-col gap-3">
        {banks.map((b) => (
          <BankCard key={b.bank} bank={b} fmt={fmt} onClick={() => openBank(b.bank)} />
        ))}
      </div>
    </div>
  )
}

function BankCard({
  bank,
  fmt,
  onClick
}: {
  bank: Bank
  fmt: (n: number) => string
  onClick: () => void
}) {
  // tax is stored as a negative amount, so adding it nets it out --
  // subtracting it would add the withheld amount back instead.
  const netInterest = bank.interest_earned + bank.tax
  // Not derived as interest_earned - distributed -- pending_interest comes
  // straight from getPendingBankInterestGroups (the same source the admin
  // Distrib. tab uses), so it can never drift from what Distribute
  // actually credits: tax netted out, and years whose interest was
  // already fully distributed correctly excluded.
  const undistributed = bank.pending_interest

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onClick()
        }
      }}
      className="w-full text-left bg-paper-2 border border-hairline rounded-md px-5 py-4 hover:bg-paper transition-colors cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-[17px] font-semibold text-ink truncate">{bank.bank}</p>
          <p className="font-mono [font-variant-numeric:tabular-nums] text-2xl font-bold text-ink mt-0.5">
            ₱{fmt(bank.balance)}
          </p>
          <p className="text-[11px] text-ink-soft">current balance</p>
        </div>
        <span className="text-ink-soft shrink-0">→</span>
      </div>

      <div className="flex items-baseline justify-between mt-3.5">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">Interest Earned</p>
          <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-sage">
            +₱{fmt(netInterest)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">Distributed</p>
          <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-ink">₱{fmt(bank.distributed)}</p>
        </div>
      </div>

      {undistributed > 0.01 && (
        <p className="text-[11px] text-gold mt-2">₱{fmt(undistributed)} not yet distributed</p>
      )}
    </div>
  )
}

/* ============================== Investments ============================== */

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

// Fund-wide list of investments, not scoped to a member.
const INVESTMENTS_CACHE_KEY = "fund-breakdown:investments"
// Cached alongside the list so a cached render never shows every
// investment as fully undistributed while allocations are still loading.
const INVESTMENT_ALLOCATIONS_CACHE_KEY = "fund-breakdown:investment-allocations"

function InvestmentsPanel({
  isAdmin,
  initialInvestment,
  onInvestmentClosed
}: {
  isAdmin: boolean
  initialInvestment?: string | null
  onInvestmentClosed?: () => void
}) {
  const cachedInvestments = readCache<Investment[]>(INVESTMENTS_CACHE_KEY)
  const [loading, setLoading] = useState(!cachedInvestments)
  const [investments, setInvestments] = useState<Investment[]>(cachedInvestments ?? [])
  const [loadError, setLoadError] = useState("")
  const [selectedInvestmentId, setSelectedInvestmentId] = useState<string | null>(initialInvestment ?? null)
  // Restores the scroll position lost to InvestmentDetailPanel's own
  // scroll-to-top-on-open when the user backs out of it.
  const scrollPosRef = useRef(0)
  useEffect(() => {
    if (selectedInvestmentId === null) restoreScrollY(scrollPosRef.current)
  }, [selectedInvestmentId])

  const [showAddSheet, setShowAddSheet] = useState(false)
  // Signed gain/loss already split across members, per investment -- used
  // to show each card's "not yet distributed" line, and the admin-only
  // Needs distribution card.
  const cachedAllocations = readCache<Record<string, number>>(INVESTMENT_ALLOCATIONS_CACHE_KEY)
  const [allocatedById, setAllocatedById] = useState<Record<string, number>>(cachedAllocations ?? {})
  // False until allocations are known (cached or fetched) -- until then
  // the undistributed figures would just be each investment's full gain/loss.
  const [allocationsReady, setAllocationsReady] = useState(!!cachedAllocations)

  async function load() {
    // Only show the blocking loader on a true cold start -- if we already
    // rendered cached data (including a quiet reload after saving an
    // investment), refresh quietly behind it instead of flashing back to a
    // spinner.
    if (!readCache(INVESTMENTS_CACHE_KEY)) setLoading(true)

    const [{ data, error }, allocResult] = await Promise.all([
      supabase.from("v_investment_summary").select("*").order("investment"),
      supabase.from("investment_allocations").select("investment_id, amount, allocation_type")
    ])

    if (allocResult.data) {
      const next: Record<string, number> = {}
      for (const r of allocResult.data as { investment_id: string; amount: number; allocation_type: string }[]) {
        const signed = r.allocation_type === "Investment Loss" ? -Number(r.amount) : Number(r.amount)
        next[r.investment_id] = (next[r.investment_id] ?? 0) + signed
      }
      setAllocatedById(next)
      setAllocationsReady(true)
      writeCache(INVESTMENT_ALLOCATIONS_CACHE_KEY, next)
    }

    if (error) {
      setLoadError(error.message)
    } else {
      const nextInvestments = (data as Investment[]) ?? []
      setInvestments(nextInvestments)
      writeCache(INVESTMENTS_CACHE_KEY, nextInvestments)
    }

    setLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data once on mount
    load()
  }, [])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (loading) {
    return <SkeletonCardList rows={4} />
  }

  if (selectedInvestmentId) {
    return (
      <InvestmentDetailPanel
        investmentId={selectedInvestmentId}
        onBack={() => {
          setSelectedInvestmentId(null)
          onInvestmentClosed?.()
        }}
        onChanged={load}
      />
    )
  }

  // Active takes priority over gain/loss direction -- a still-open
  // investment's current gain/loss is just an interim snapshot, not a
  // settled outcome, so it belongs with the other ongoing investments
  // rather than being sorted by a number that can still move. Gains/Losses
  // are scoped to closed investments only, where the number is final.
  const active = investments.filter((i) => i.status === "open")
  const closedInvestments = investments.filter((i) => i.status === "closed")
  const gains = closedInvestments.filter((i) => i.gain_loss > 0).sort((a, b) => b.gain_loss - a.gain_loss)
  const losses = closedInvestments.filter((i) => i.gain_loss <= 0).sort((a, b) => a.gain_loss - b.gain_loss)
  const netTotal = investments.reduce((sum, i) => sum + i.gain_loss, 0)

  // Same "ready" rule as the investment's own page: an open investment
  // only counts once its realized gain exceeds what's been split (money
  // still out isn't a loss yet); a closed one counts if anything's left.
  const undistributedById: Record<string, number> = {}
  for (const i of allocationsReady ? investments : []) {
    const unallocated = Number((i.gain_loss - (allocatedById[i.investment_id] ?? 0)).toFixed(2))
    if (i.status === "open" ? unallocated > 0.01 : Math.abs(unallocated) > 0.01) {
      undistributedById[i.investment_id] = unallocated
    }
  }
  const needsDistribution = isAdmin
    ? investments
        .filter((i) => undistributedById[i.investment_id] !== undefined)
        .map((i) => ({ inv: i, unallocated: undistributedById[i.investment_id] }))
    : []

  function openInvestment(id: string) {
    scrollPosRef.current = window.scrollY
    setSelectedInvestmentId(id)
  }

  function renderInvestmentGroup(inv: Investment) {
    return (
      <InvestmentCard
        key={inv.investment_id}
        inv={inv}
        fmt={fmt}
        undistributed={undistributedById[inv.investment_id] ?? 0}
        onClick={() => openInvestment(inv.investment_id)}
      />
    )
  }

  return (
    <div>
      {/* The list itself is read-only -- edit, distribute, close and reopen
          all live on each investment's own page, behind its ⋯ menu. Only Add,
          which has no investment to live on yet, stays here. */}
      <div className="flex items-center justify-between gap-4 mb-5">
        <p className="text-[13px] text-ink-soft">Every venture the fund has put money into, and how it turned out.</p>
        {isAdmin && (
          <button
            className="shrink-0 bg-gold-soft text-ink px-3.5 py-2 rounded-sm text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity flex items-center gap-1.5"
            onClick={() => setShowAddSheet(true)}
          >
            <span className="text-lg leading-none">+</span>
            Add Investment
          </button>
        )}
      </div>

      {showAddSheet && (
        <InvestmentDetailsSheet investment={null} onClose={() => setShowAddSheet(false)} onSaved={load} />
      )}

      {!loadError && needsDistribution.length > 0 && (
        <div className="card mb-4">
          <div className="px-5 pt-4 pb-2">
            <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1">Needs distribution</p>
            <p className="text-sm text-ink">
              {needsDistribution.length} investment{needsDistribution.length === 1 ? " has" : "s have"} gain or loss
              not yet split across members.
            </p>
            <div className="mt-2">
              {needsDistribution.map(({ inv, unallocated }) => (
                <button
                  key={inv.investment_id}
                  onClick={() => openInvestment(inv.investment_id)}
                  className="w-full py-2.5 flex items-center justify-between gap-3 text-left border-t border-dashed border-hairline"
                >
                  <span className="text-sm text-ink font-medium truncate">{inv.investment}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span
                      className={`font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold ${
                        unallocated < 0 ? "text-rust" : "text-sage"
                      }`}
                    >
                      {unallocated < 0 ? "-" : "+"}₱{fmt(Math.abs(unallocated))}
                    </span>
                    <span className="text-ink-soft">→</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {!loadError && investments.length > 0 && (
        <div className="card px-5 pt-4 pb-3.5 mb-6">
          <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">Net Position</p>
          <p
            className={`font-mono [font-variant-numeric:tabular-nums] text-3xl font-bold ${
              netTotal > 0 ? "text-sage" : netTotal < 0 ? "text-rust" : "text-ink"
            }`}
          >
            {netTotal < 0 ? "-" : "+"}₱{fmt(Math.abs(netTotal))}
          </p>
          <p className="text-[11px] text-ink-soft mt-1">
            across {investments.length} investment{investments.length === 1 ? "" : "s"}
          </p>
        </div>
      )}

      {loadError && <p className="mb-4 text-sm text-rust">Couldn&apos;t load investments: {loadError}</p>}

      {!loadError && investments.length === 0 && (
        <p className="text-sm text-ink-soft text-center py-12">No investments on record yet.</p>
      )}

      {active.length > 0 && (
        <section className={gains.length > 0 || losses.length > 0 ? "mb-7" : ""}>
          <h2 className="text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-3">Active</h2>
          <div className="flex flex-col gap-3">{active.map(renderInvestmentGroup)}</div>
        </section>
      )}

      {gains.length > 0 && (
        <section className={losses.length > 0 ? "mb-7" : ""}>
          <h2 className="text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-3">Gains</h2>
          <div className="flex flex-col gap-3">{gains.map(renderInvestmentGroup)}</div>
        </section>
      )}

      {losses.length > 0 && (
        <section>
          <h2 className="text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-3">Losses</h2>
          <div className="flex flex-col gap-3">{losses.map(renderInvestmentGroup)}</div>
        </section>
      )}
    </div>
  )
}

function InvestmentCard({
  inv,
  fmt,
  undistributed,
  onClick
}: {
  inv: Investment
  fmt: (n: number) => string
  // Realized gain/loss not yet split across members (0 when nothing's
  // due) -- shown to everyone, like a bank card's "not yet distributed".
  undistributed: number
  onClick: () => void
}) {
  const isGain = inv.gain_loss > 0
  const isFlat = inv.gain_loss === 0

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onClick()
        }
      }}
      className="w-full text-left bg-paper-2 border border-hairline rounded-md px-5 py-4 hover:bg-paper transition-colors cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-[17px] font-semibold text-ink truncate">{inv.investment}</p>
          <p className="text-[12px] text-ink-soft">₱{fmt(inv.invested)} invested</p>
        </div>
        {/* No status pill -- cards already sit under an Active, Gains or
            Losses heading, and an active card's figure is labelled "so far"
            below since it can still move. */}
        <span className="text-ink-soft shrink-0">→</span>
      </div>

      <div className="flex items-baseline justify-between mt-3.5">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">Returned</p>
          <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-ink">₱{fmt(inv.returned)}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">
            {inv.status === "open" ? "Gain / Loss So Far" : "Gain / Loss"}
          </p>
          <p
            className={`font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold ${
              isGain ? "text-sage" : isFlat ? "text-ink" : "text-rust"
            }`}
          >
            {inv.gain_loss < 0 ? "-" : "+"}₱{fmt(Math.abs(inv.gain_loss))}
          </p>
        </div>
      </div>

      {Math.abs(undistributed) > 0.01 && (
        <p className="text-[11px] text-gold mt-2">
          {undistributed < 0 ? "-" : ""}₱{fmt(Math.abs(undistributed))} not yet distributed
        </p>
      )}
    </div>
  )
}

/* ============================== Sparkline ============================== */

function Sparkline({ points, color }: { points: TrendPoint[]; color: string }) {
  const { linePoints, ticks } = useMemo(() => {
    if (!points || points.length < 2) return { linePoints: "", ticks: [] as { x: number; label: string }[] }

    const values = points.map((p) => p.value)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1
    const w = 300
    const h = 34
    const step = w / (points.length - 1)

    const linePoints = points
      .map((p, i) => {
        const x = i * step
        const y = h - ((p.value - min) / range) * (h - 4) - 2
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(" ")

    // One tick per calendar year, placed at that year's first data point.
    // Consecutive real-world years can land very close together in index-
    // space if a member had a burst of activity recently, so enforce a
    // minimum pixel gap and let the later year win a collision rather than
    // overlapping the text.
    const minGap = 26
    const rawTicks: { x: number; label: string }[] = []
    let lastYear = ""
    points.forEach((p, i) => {
      const year = (p.date || "").slice(0, 4)
      if (year && year !== lastYear) {
        rawTicks.push({ x: i * step, label: year })
        lastYear = year
      }
    })

    const ticks: { x: number; label: string }[] = []
    rawTicks.forEach((t) => {
      if (ticks.length > 0 && t.x - ticks[ticks.length - 1].x < minGap) {
        ticks[ticks.length - 1] = t
      } else {
        ticks.push(t)
      }
    })

    return { linePoints, ticks }
  }, [points])

  if (!linePoints) {
    return <div className="h-[48px] mt-2.5" />
  }

  return (
    <div className="mt-2.5">
      <svg className="block" width="100%" height="34" viewBox="0 0 300 34" preserveAspectRatio="none">
        <polyline points={linePoints} fill="none" stroke={color} strokeWidth="2" />
      </svg>
      <div className="relative h-[14px] mt-1">
        {ticks.map((t, i) => (
          <span
            key={i}
            className="absolute text-[9.5px] text-ink-soft font-mono"
            style={{
              left: `${(t.x / 300) * 100}%`,
              transform: i === 0 ? "translateX(0)" : i === ticks.length - 1 ? "translateX(-100%)" : "translateX(-50%)"
            }}
          >
            {t.label}
          </span>
        ))}
      </div>
    </div>
  )
}

