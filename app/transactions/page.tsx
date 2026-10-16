"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Navbar from "@/app/components/Navbar"
import ReceiptModal from "@/app/components/ReceiptModal"
import { SkeletonCardList } from "@/app/components/Skeleton"
import { useAuth } from "@/app/auth-context"
import { dateOnly } from "@/lib/currentValue"
import { TRANSACTION_TYPE_LABELS as typeLabels } from "@/lib/transactionLabels"
import { DateField, FieldRow, PersonIcon, BankIcon, StatusIcon, rowSelectClass } from "@/app/components/TransactionFormUI"
import { Sheet } from "@/app/components/Sheet"
import {
  TransactionDetailSheet,
  TransactionRow,
  cardDate,
  effectiveDate,
  ledgerBankKeys,
  monthLabel
} from "@/app/components/transactions/TransactionParts"
import { readCache, writeCache } from "@/lib/cache"
import { useHydrated } from "@/lib/useHydrated"
import { TRANSACTIONS_CHANGED_EVENT } from "@/lib/transactionEvents"
import { fetchTransactionsFields, bankAccountLabel, TRANSACTIONS_CACHE_KEY, type TransactionsSnapshot } from "@/lib/transactionsSnapshot"

// Rows rendered at first, and added each time the end of the list scrolls
// into view -- the full history is over a thousand entries, too many to
// lay out at once on a phone.
const PAGE_SIZE = 60
import { cacheTransactionRow } from "@/lib/transactionRowCache"

// yyyy-mm-dd (as stored in the date-input state) -> "18 Jul" for the pill
// label. Parsed with an explicit time to avoid the UTC-midnight-rolls-back-
// a-day issue plain `new Date("2026-07-18")` has in some timezones.
function formatShort(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short"
  })
}

type DatePreset = { key: string; label: string; from: string; to: string }

// Computed fresh each render off the current date rather than memoized --
// cheap enough (a handful of Date() constructions) that it's not worth
// tracking "today" as its own piece of state just to memoize this.
function buildDatePresets(): DatePreset[] {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()

  return [
    {
      key: "this_month",
      label: "This Month",
      from: dateOnly(new Date(year, month, 1)),
      to: dateOnly(new Date(year, month + 1, 0))
    },
    {
      key: "last_month",
      label: "Last Month",
      from: dateOnly(new Date(year, month - 1, 1)),
      to: dateOnly(new Date(year, month, 0))
    },
    {
      key: "this_year",
      label: "This Year",
      from: dateOnly(new Date(year, 0, 1)),
      to: dateOnly(new Date(year, 11, 31))
    },
    { key: "all_time", label: "All Time", from: "", to: "" }
  ]
}

function TypeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-5 h-5 text-ink-soft shrink-0">
      <path d="M7 7h10M7 12h10M7 17h6" strokeLinecap="round" />
    </svg>
  )
}

// Owns the raw keystroke-by-keystroke input state itself and only reports
// upward once typing pauses -- debouncing the *value* passed up wasn't
// enough on its own, since the parent still re-rendered (and re-diffed its
// full, possibly ~1000-row, transaction list) on every keystroke just to
// reflect the input's own updated text. Isolating that state here means a
// keystroke only re-renders this small subtree; the parent, and the list,
// re-render solely when onDebouncedChange actually fires.
function SearchBox({ onDebouncedChange }: { onDebouncedChange: (value: string) => void }) {
  const [value, setValue] = useState("")
  const [showHint, setShowHint] = useState(false)

  useEffect(() => {
    const timeout = setTimeout(() => onDebouncedChange(value), 300)
    return () => clearTimeout(timeout)
  }, [value, onDebouncedChange])

  return (
    <div className="flex-1 min-w-0">
      <div className="relative">
        <input
          type="text"
          placeholder="Search transactions..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={`w-full border border-hairline bg-paper-2 text-ink rounded-md pl-4 py-3 text-sm placeholder:text-ink-soft focus:outline-none ${
            value ? "pr-16" : "pr-10"
          }`}
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              setValue("")
              onDebouncedChange("")
            }}
            aria-label="Clear search"
            className="absolute right-9 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border border-hairline text-ink-soft text-[11px] font-semibold flex items-center justify-center shrink-0"
          >
            ×
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowHint((v) => !v)}
          aria-label="What does search look at?"
          aria-expanded={showHint}
          className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border border-hairline text-ink-soft text-[11px] font-semibold flex items-center justify-center shrink-0"
        >
          ?
        </button>
      </div>
      {showHint && (
        <p className="mt-2 text-xs text-ink-soft">
          Matches member names, banks, descriptions, loan/investment names, transaction types, and dates.
          Multiple words narrow the results -- e.g. &quot;Vhan BDO&quot; finds Vhan&apos;s transactions on BDO, even
          though the two words aren&apos;t next to each other on the card.
        </p>
      )}
    </div>
  )
}

export default function TransactionsPage() {
  return (
    <Suspense fallback={null}>
      <TransactionsPageInner />
    </Suspense>
  )
}

function TransactionsPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { loading: authLoading, member } = useAuth()
  const hydrated = useHydrated()
  const isAdmin = member?.role === "admin"
  // Read once per mount: the snapshot holds the full history (~1MB of JSON),
  // so parsing it inline on every render made each filter change, search,
  // and scroll-to-load-more pay for a full JSON.parse of it again.
  const [cached] = useState(() => readCache<TransactionsSnapshot>(TRANSACTIONS_CACHE_KEY))
  // Whether a list is already on screen (cached or freshly loaded), so a
  // background refresh doesn't flash back to the skeleton -- tracked here
  // rather than by re-reading the cache, which would mean parsing it again.
  const hasDataRef = useRef(!!cached)

  // Paints instantly from whatever was last loaded here, before the browser
  // ever shows a frame -- the load() effect below still runs right after
  // and replaces it with a fresh fetch, so a stale cache never lingers past
  // that first moment.
  const [transactions, setTransactions] = useState<any[]>(cached?.transactions ?? [])
  const [dataLoading, setDataLoading] = useState(!cached)
  const [totalCount, setTotalCount] = useState(cached?.totalCount ?? 0)
  const [members, setMembers] = useState<any[]>(cached?.members ?? [])

  // Set once from the ?loan= / ?investment= query param (e.g. "View all"
  // from a loan's or investment's detail page) -- cleared locally like any
  // other filter, doesn't try to keep syncing back to the URL after that.
  const [loanFilter, setLoanFilter] = useState(() => searchParams.get("loan") || "")
  const [investmentFilter, setInvestmentFilter] = useState(() => searchParams.get("investment") || "")
  // ?bank= arrives from a bank's "View all" -- matched against the same
  // bank key v_cash_ledger uses, so it lists exactly what moved that bank.
  const [bankFilter, setBankFilter] = useState(() => searchParams.get("bank") || "")

  // Default the member filter to whoever's logged in, once, the first time
  // their member record becomes available. After that we leave the filter
  // alone so switching to "All members" (or anyone else) sticks. Skipped
  // when arriving pre-filtered to a specific loan/investment -- that view
  // should show every member's activity on it, not just the viewer's own.
  //
  // Applied synchronously in useState's initializer, not a useEffect, so it
  // takes effect on the very first render -- member is already known on a
  // normal client-side navigation (the auth context resolved on an earlier
  // page), so waiting for a post-paint effect meant the first frame or two
  // rendered the cached *unfiltered* transactions list (everyone's, not
  // just this member's) before narrowing down, a visible flash now that
  // there's cached data to paint immediately instead of a loading skeleton.
  //
  // Admins open on everyone's activity instead -- they look after the
  // whole fund, not just their own entries.
  const defaultMemberAppliedRef = useRef(!!member)
  const [selectedMemberId, setSelectedMemberId] = useState(() =>
    member &&
    member.role !== "admin" &&
    !searchParams.get("loan") &&
    !searchParams.get("investment") &&
    !searchParams.get("bank")
      ? member.member_id
      : ""
  )
  const [selectedType, setSelectedType] = useState("")
  const [selectedStatus, setSelectedStatus] = useState("")
  // The row whose detail sheet is open.
  const [openTxnId, setOpenTxnId] = useState<string | null>(null)
  // ?txn= arrives from an "Approved" notification -- open that row's detail
  // sheet (it shows once the list has loaded) and drop the param in place.
  // Adjusted during render rather than in an effect, so a second
  // notification tapped while already here still opens.
  const requestedTxnId = searchParams.get("txn")
  const [seenTxnParam, setSeenTxnParam] = useState<string | null>(null)
  if (requestedTxnId !== seenTxnParam) {
    setSeenTxnParam(requestedTxnId)
    if (requestedTxnId) setOpenTxnId(requestedTxnId)
  }
  useEffect(() => {
    if (requestedTxnId) router.replace("/transactions", { scroll: false })
  }, [requestedTxnId, router])
  // Bumped to remount SearchBox, which owns its own text -- the way "Clear
  // filters" on an empty result also clears the search.
  const [searchKey, setSearchKey] = useState(0)
  // How many rows are rendered for the current filters (see PAGE_SIZE).
  const [shown, setShown] = useState({ key: "", count: PAGE_SIZE })
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)
  // The raw, keystroke-by-keystroke value lives in SearchBox itself (see
  // above) -- this only ever updates once typing pauses, which keeps this
  // component (and the potentially long list it renders) from re-rendering
  // on every keystroke.
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("")
  const [loadError, setLoadError] = useState("")
  const [openReceipt, setOpenReceipt] = useState<{ paths: string[]; index: number } | null>(null)

  // The actual queries live in lib/transactionsSnapshot.ts, shared with the
  // splash at / -- which runs the exact same fetch to get this cache warm
  // before ever navigating here. Pulled out to its own callback (rather
  // than staying inline in the mount effect below) so the FAB's quick-entry
  // sheet -- in Navbar, above this page and with no reference to this
  // page's own load function -- can also trigger a quiet refresh after
  // saving a transaction; see the listener effect further down.
  const load = useCallback(async () => {
    // Only show the blocking loader on a true cold start -- if we already
    // rendered cached data, refresh quietly behind it instead of flashing
    // back to a spinner on every navigation.
    if (!hasDataRef.current) setDataLoading(true)

    const { transactions: loadedTransactions, members: loadedMembers, error } = await fetchTransactionsFields()
    hasDataRef.current = true
    setLoadError(error ?? "")
    setTransactions(loadedTransactions)
    setTotalCount(loadedTransactions.length)
    setMembers(loadedMembers)
    setDataLoading(false)

    writeCache<TransactionsSnapshot>(TRANSACTIONS_CACHE_KEY, {
      transactions: loadedTransactions,
      totalCount: loadedTransactions.length,
      members: loadedMembers
    })
  }, [])

  // Every other main page redirects an unauthenticated/pending/borrower
  // visitor away before rendering real content -- this one didn't, so
  // navigating here directly just silently showed an empty list (RLS
  // still blocks the actual data either way, but the experience should
  // match everywhere else: bounced to the right screen instead of a
  // confusing blank page).
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
    load()
  }, [authLoading, member, router, load])

  // See the comment on `load` above -- this is what actually lets a
  // transaction saved through the FAB's sheet show up on this page without
  // a full navigation away and back.
  useEffect(() => {
    window.addEventListener(TRANSACTIONS_CHANGED_EVENT, load)
    return () => window.removeEventListener(TRANSACTIONS_CHANGED_EVENT, load)
  }, [load])

  // Ref-guarded run-once-on-load initializer, same as the effect above it --
  // loanFilter/investmentFilter are read once here, only at the moment
  // `member` first becomes available, so they're deliberately left out of
  // the dependency array.
  useEffect(() => {
    if (member && !defaultMemberAppliedRef.current) {
      if (!loanFilter && !investmentFilter && !bankFilter && member.role !== "admin") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectedMemberId(member.member_id)
      }
      defaultMemberAppliedRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member])

  function clearFilters() {
    setSelectedMemberId("")
    setSelectedType("")
    setSelectedStatus("")
    setDateFrom("")
    setDateTo("")
    setLoanFilter("")
    setInvestmentFilter("")
    setBankFilter("")
  }

  // Built from what's actually in the loaded data rather than the full
  // static typeLabels list -- classifications with zero current rows (e.g.
  // Expense, Gain Allocation before any distribution has run) simply don't
  // appear as filter options until a real row exists.
  const typeOptions = Array.from(new Set(transactions.map((t) => t.classification))).sort(
    (a, b) => (typeLabels[a] || a).localeCompare(typeLabels[b] || b)
  )

  // Same idea for banks -- every bank any loaded row touches, by its
  // ledger key (see ledgerBankKeys).
  const bankOptions = Array.from(new Set(transactions.flatMap(ledgerBankKeys))).sort((a, b) => a.localeCompare(b))

  // Building each row's searchable text means several toLocaleDateString
  // calls per row -- cheap in bulk, but the *first* time this ever runs
  // (cold Intl formatters, unwarmed JIT) is noticeably slower than every
  // run after it. Precomputed once here, keyed only on `transactions`, so
  // that one-time cost lands when the data loads rather than when the user
  // types their first search word -- every search after that, first word or
  // not, is then just a cheap .includes() over an already-built string.
  const searchableTransactions = useMemo(
    () =>
      transactions.map((t) => ({
        ...t,
        _searchHaystack: [
          t.members?.name,
          t.description,
          t.bank,
          bankAccountLabel(t.from_bank_account),
          bankAccountLabel(t.to_bank_account),
          t.classification,
          typeLabels[t.classification],
          t.loans?.name,
          t.loans?.borrowers?.name,
          t.investments?.name,
          t._transferLabel,
          t.txn_date,
          effectiveDate(t).toLocaleDateString(),
          cardDate(t),
          monthLabel(t)
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
      })),
    [transactions]
  )

  // Recomputing this list still means re-scanning every transaction, but
  // now it's just cheap field comparisons plus a .includes() against the
  // already-built haystack above -- fast enough that gating it on the
  // debounced query (rather than the raw one) is enough to keep typing
  // smooth.
  const filteredTransactions = useMemo(() => {
    const searchWords = debouncedSearchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean)

    return searchableTransactions.filter((t) => {
      const memberMatch = selectedMemberId ? t.member_id === selectedMemberId : true
      const typeMatch = selectedType ? t.classification === selectedType : true
      const statusMatch = selectedStatus ? t.status === selectedStatus : true
      const loanMatch = loanFilter ? t.loan_id === loanFilter : true
      const investmentMatch = investmentFilter ? t.investment_id === investmentFilter : true
      const bankMatch = bankFilter ? ledgerBankKeys(t).includes(bankFilter) : true

      const ts = effectiveDate(t).getTime()
      const fromMatch = dateFrom ? ts >= new Date(`${dateFrom}T00:00:00`).getTime() : true
      const toMatch = dateTo ? ts <= new Date(`${dateTo}T23:59:59`).getTime() : true

      // Every word in the query has to appear somewhere in the haystack,
      // but not necessarily adjacent to (or in the same field as) each
      // other -- e.g. "Vhan BDO" should match a row where the member name
      // and bank badge are two separate fields, not a literal "vhan bdo"
      // substring.
      const searchMatch = searchWords.length === 0 || searchWords.every((word) => t._searchHaystack.includes(word))

      return memberMatch && typeMatch && statusMatch && loanMatch && investmentMatch && bankMatch && fromMatch && toMatch && searchMatch
    })
  }, [
    searchableTransactions,
    selectedMemberId,
    selectedType,
    selectedStatus,
    loanFilter,
    investmentFilter,
    bankFilter,
    dateFrom,
    dateTo,
    debouncedSearchQuery
  ])

  // For the loan/investment filter pills' labels -- neither name is known
  // until at least one matching transaction has loaded.
  const loanFilterLabel = loanFilter
    ? transactions.find((t) => t.loan_id === loanFilter)?.loans?.borrowers?.name ||
      transactions.find((t) => t.loan_id === loanFilter)?.loans?.name ||
      "Loan"
    : ""
  const investmentFilterLabel = investmentFilter
    ? transactions.find((t) => t.investment_id === investmentFilter)?.investments?.name || "Investment"
    : ""

  const hasDateFilter = Boolean(dateFrom || dateTo)

  const dateRangeLabel = !hasDateFilter
    ? "Dates"
    : dateFrom && dateTo
    ? `${formatShort(dateFrom)} – ${formatShort(dateTo)}`
    : dateFrom
    ? `From ${formatShort(dateFrom)}`
    : `Until ${formatShort(dateTo)}`

  const selectedMemberLabel = selectedMemberId
    ? selectedMemberId === member?.member_id
      ? "You"
      : members.find((m) => m.member_id === selectedMemberId)?.name ?? "Member"
    : ""

  // Drives both the filter icon's badge count and the removable chip row --
  // one list of "what's currently filtered," each with its own clear
  // action, instead of maintaining the count and the chips separately.
  const filterChips = [
    loanFilter && { key: "loan", label: `Loan: ${loanFilterLabel}`, onClear: () => setLoanFilter("") },
    investmentFilter && {
      key: "investment",
      label: `Investment: ${investmentFilterLabel}`,
      onClear: () => setInvestmentFilter("")
    },
    bankFilter && { key: "bank", label: `Bank: ${bankFilter}`, onClear: () => setBankFilter("") },
    selectedMemberId && { key: "member", label: selectedMemberLabel, onClear: () => setSelectedMemberId("") },
    selectedType && {
      key: "type",
      label: typeLabels[selectedType] || selectedType,
      onClear: () => setSelectedType("")
    },
    selectedStatus && {
      key: "status",
      label: selectedStatus === "approved" ? "Approved" : selectedStatus === "pending" ? "Pending" : "Rejected",
      onClear: () => setSelectedStatus("")
    },
    hasDateFilter && {
      key: "dates",
      label: dateRangeLabel,
      onClear: () => {
        setDateFrom("")
        setDateTo("")
      }
    }
  ].filter(Boolean) as { key: string; label: string; onClear: () => void }[]
  // The default "your own transactions" member filter is applied from the
  // cached member on the client's first render, which the server never
  // sees -- showing its chip/badge during hydration is a mismatch (React
  // error #418), so they appear right after instead.
  const activeChips = hydrated ? filterChips : []
  // Same reason: the server always renders the skeleton (it has no cache),
  // so the cached list only takes over once hydration is done.
  const showLoading = dataLoading || !hydrated

  // Your own entries still in play -- rejected ones to fix first, then
  // pending ones waiting on an admin -- lead the page instead of sitting
  // somewhere down the list.
  const attention = filteredTransactions
    .filter((t) => t.member_id === member?.member_id && (t.status === "rejected" || t.status === "pending"))
    .sort((a, b) => (a.status === "rejected" ? 0 : 1) - (b.status === "rejected" ? 0 : 1))
  const attentionIds = new Set(attention.map((t) => t.transaction_id))
  const listRows = attention.length ? filteredTransactions.filter((t) => !attentionIds.has(t.transaction_id)) : filteredTransactions

  const filterKey = [
    selectedMemberId,
    selectedType,
    selectedStatus,
    loanFilter,
    investmentFilter,
    bankFilter,
    dateFrom,
    dateTo,
    debouncedSearchQuery
  ].join("|")
  const limit = shown.key === filterKey ? shown.count : PAGE_SIZE
  const visibleRows = listRows.slice(0, limit)
  const hasMore = listRows.length > limit

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) setShown({ key: filterKey, count: limit + PAGE_SIZE })
      },
      { rootMargin: "800px" }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, limit, filterKey])

  const openTxn = openTxnId ? transactions.find((t) => t.transaction_id === openTxnId) ?? null : null
  const anyFilterActive = activeChips.length > 0 || !!debouncedSearchQuery

  function clearEverything() {
    clearFilters()
    setDebouncedSearchQuery("")
    setSearchKey((k) => k + 1)
  }

  const statusOptions = [
    { value: "", label: "Any status" },
    { value: "approved", label: "Approved" },
    { value: "pending", label: "Pending" },
    { value: "rejected", label: "Rejected" }
  ]

  return (
    <>
      <Navbar />

      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(2.5rem+var(--dock-h)+env(safe-area-inset-bottom))]">
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Full History
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink">
            Transactions
          </h1>

          {loadError && (
            <p className="mt-4 text-sm text-rust">
              Couldn&apos;t load transactions: {loadError}
            </p>
          )}

          {/* Search stays a plain text input with its own "?" hint (see
              SearchBox) -- the filter icon next to it is a separate
              affordance for the structured filters (who/type/dates), opened
              in the sheet below rather than as a row of always-visible
              dropdowns. */}
          <div className="mt-6 flex items-start gap-2">
            <SearchBox key={searchKey} onDebouncedChange={setDebouncedSearchQuery} />
            <button
              type="button"
              onClick={() => setFilterSheetOpen(true)}
              aria-label="Filters"
              className={`relative shrink-0 w-[46px] h-[46px] flex items-center justify-center rounded-md border bg-paper-2 ${
                activeChips.length > 0 ? "border-gold text-gold" : "border-hairline text-ink-soft"
              }`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} className="w-[19px] h-[19px]">
                <path d="M4 6h16M7 12h10M10 18h4" strokeLinecap="round" />
              </svg>
              {activeChips.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gold text-ink text-[10px] font-bold font-mono flex items-center justify-center">
                  {activeChips.length}
                </span>
              )}
            </button>
          </div>

          {/* Small removable tags for whatever's currently filtered -- a
              plain horizontal scroller rather than a dot-indicator carousel,
              since chips are variable-width and free scroll reads more
              naturally here. With one or two chips there's nothing to
              scroll; it only starts sliding once the row actually overflows. */}
          {activeChips.length > 0 && (
            <div className="mt-3 -mx-4 sm:-mx-5 px-4 sm:px-5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="flex items-center gap-2 w-max">
                {activeChips.map((chip) => (
                  <span
                    key={chip.key}
                    className="shrink-0 flex items-center gap-1.5 bg-gold-soft text-ink rounded-full pl-3.5 pr-1.5 py-1.5 text-[13px] font-semibold whitespace-nowrap max-w-[12rem]"
                  >
                    <span className="truncate">{chip.label}</span>
                    <button
                      type="button"
                      onClick={chip.onClear}
                      aria-label={`Remove ${chip.label} filter`}
                      className="shrink-0 w-5 h-5 rounded-full bg-black/15 flex items-center justify-center text-[11px] leading-none"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  onClick={clearFilters}
                  className="shrink-0 border border-hairline rounded-full px-3.5 py-1.5 text-[13px] text-ink-soft"
                >
                  Clear all
                </button>
              </div>
            </div>
          )}

          {!showLoading && (
            <div className="mt-4 text-xs text-ink-soft font-mono [font-variant-numeric:tabular-nums]">
              {filteredTransactions.length} of {totalCount}
              {debouncedSearchQuery && ` matching "${debouncedSearchQuery}"`}
            </div>
          )}

          {!showLoading && attention.length > 0 && (
            <section className="mt-5">
              <p className="text-[11px] uppercase tracking-wide font-mono mb-2 text-gold">
                {attention.some((t) => t.status === "rejected") ? "Needs your attention" : "Waiting for approval"}
              </p>
              <div className="space-y-2">
                {attention.map((t) => (
                  <TransactionRow key={t.transaction_id} t={t} onOpen={() => setOpenTxnId(t.transaction_id)} />
                ))}
              </div>
            </section>
          )}

          <div className="mt-5">
            {showLoading && <SkeletonCardList rows={5} />}
            {!showLoading &&
              visibleRows.map((t, idx) => {
                const label = monthLabel(t)
                const showMonthHeader = idx === 0 || label !== monthLabel(visibleRows[idx - 1])
                return (
                  <div key={t.transaction_id}>
                    {showMonthHeader && (
                      <p className={`text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 ${idx === 0 ? "mt-0" : "mt-6"}`}>
                        {label}
                      </p>
                    )}
                    <div className={showMonthHeader ? "" : "mt-2"}>
                      <TransactionRow t={t} onOpen={() => setOpenTxnId(t.transaction_id)} />
                    </div>
                  </div>
                )
              })}

            {!showLoading && hasMore && (
              <div ref={sentinelRef} className="py-6 text-center text-xs text-ink-soft font-mono">
                Loading older entries…
              </div>
            )}

            {!showLoading && filteredTransactions.length === 0 && !loadError && (
              <div className="py-10 text-center">
                <p className="text-sm text-ink-soft">
                  {anyFilterActive ? "Nothing matches these filters." : "No transactions yet."}
                </p>
                {anyFilterActive && (
                  <button
                    type="button"
                    onClick={clearEverything}
                    className="mt-3 border border-hairline rounded-full px-4 py-2 text-sm font-semibold text-ink"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {filterSheetOpen && (
        <Sheet
          title="Filters"
          onClose={() => setFilterSheetOpen(false)}
          footer={
            <button
              type="button"
              onClick={() => setFilterSheetOpen(false)}
              className="w-full bg-ink text-paper px-6 py-3.5 rounded-full text-base font-bold shadow-lg motion-safe:transition-transform motion-safe:active:scale-[0.97]"
            >
              Show {filteredTransactions.length} {filteredTransactions.length === 1 ? "entry" : "entries"}
            </button>
          }
        >
          {/* Every control applies live -- the button just closes. */}
          <div className="card divide-y divide-hairline overflow-hidden">
            <FieldRow icon={<PersonIcon />}>
              <select className={rowSelectClass} value={selectedMemberId} onChange={(e) => setSelectedMemberId(e.target.value)}>
                <option value="">Everyone</option>
                {members.map((m) => (
                  <option key={m.member_id} value={m.member_id}>
                    {m.member_id === member?.member_id ? "You" : m.name}
                  </option>
                ))}
              </select>
            </FieldRow>
            <FieldRow icon={<TypeIcon />}>
              <select className={rowSelectClass} value={selectedType} onChange={(e) => setSelectedType(e.target.value)}>
                <option value="">All types</option>
                {typeOptions.map((type) => (
                  <option key={type} value={type}>
                    {typeLabels[type] || type}
                  </option>
                ))}
              </select>
            </FieldRow>
            <FieldRow icon={<BankIcon />}>
              <select className={rowSelectClass} value={bankFilter} onChange={(e) => setBankFilter(e.target.value)}>
                <option value="">All banks</option>
                {bankOptions.map((bank) => (
                  <option key={bank} value={bank}>
                    {bank}
                  </option>
                ))}
              </select>
            </FieldRow>
            <FieldRow icon={<StatusIcon />}>
              <select className={rowSelectClass} value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)}>
                {statusOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </FieldRow>
          </div>

          <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mt-5 mb-2 px-1">Dates</p>
          {/* Fills both dates in one tap for the common cases; picking a
              custom date below just stops matching any preset's range. */}
          <div className="flex gap-2 mb-3 -mx-4 px-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {buildDatePresets().map((preset) => {
              const active = dateFrom === preset.from && dateTo === preset.to
              return (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => {
                    setDateFrom(preset.from)
                    setDateTo(preset.to)
                  }}
                  className={`shrink-0 border rounded-full px-3 py-1.5 text-[13px] whitespace-nowrap ${
                    active ? "bg-gold-soft border-gold-soft text-ink font-semibold" : "border-hairline text-ink-soft"
                  }`}
                >
                  {preset.label}
                </button>
              )
            })}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-ink-soft mb-1 px-1">From</label>
              <DateField
                value={dateFrom}
                onChange={(v) => {
                  setDateFrom(v)
                  // Pre-fill "To" so its picker opens on the same month.
                  if (v) setDateTo(v)
                }}
                placeholder="Start date"
              />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-ink-soft mb-1 px-1">To</label>
              <DateField value={dateTo} onChange={setDateTo} placeholder="End date" />
            </div>
          </div>

          {activeChips.length > 0 && (
            <button type="button" onClick={clearFilters} className="mt-5 w-full text-center text-sm font-semibold text-gold">
              Reset all filters
            </button>
          )}
        </Sheet>
      )}

      {openTxn && (
        <TransactionDetailSheet
          t={openTxn}
          memberId={member?.member_id}
          isAdmin={isAdmin}
          onClose={() => setOpenTxnId(null)}
          onOpenReceipt={(paths, index) => setOpenReceipt({ paths, index })}
          onEdit={() => {
            setOpenTxnId(null)
            // Hands the exact row already on screen to EditTransactionSheet,
            // so it can render instantly instead of re-fetching by ID.
            cacheTransactionRow(openTxn)
            router.push(`/transactions?editTransaction=${openTxn.transaction_id}`, { scroll: false })
          }}
        />
      )}
      {openReceipt && (
        <ReceiptModal paths={openReceipt.paths} startIndex={openReceipt.index} onClose={() => setOpenReceipt(null)} />
      )}
    </>
  )
}
