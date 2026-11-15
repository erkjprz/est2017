"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Navbar from "@/app/components/Navbar"
import { useAuth } from "@/app/auth-context"
import { SkeletonCardList } from "@/app/components/Skeleton"
import { Toast } from "@/app/components/Toast"
import {
  availableToLend,
  fetchLendingPosition,
  holdPct,
  markLendingLimitsSeen,
  saveLendingLimits,
  type LendingPosition
} from "@/lib/lendingLimits"

const fmt = (n: number) =>
  Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`

const sectionLabelClass = "text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-1 px-1"
// The short explanation under a section label, above its card.
const sectionNoteClass = "text-[12px] text-ink-soft mb-2.5 px-1"

type LimitField = "max_total_loans_pct" | "max_per_borrower_pct" | "max_member_hold_pct"

const LIMIT_FIELDS: { field: LimitField; label: string; hint: string }[] = [
  { field: "max_total_loans_pct", label: "Total loans", hint: "of the fund out on loan at once" },
  { field: "max_per_borrower_pct", label: "Per borrower", hint: "of the fund to one borrower, all their loans counted" },
  { field: "max_member_hold_pct", label: "Member hold", hint: "of any one member's value on hold" }
]

// Admin-only settings for the three lending limits, with the fund's
// current position against each. The limits are warn-only: the admin
// queue flags a Loan Release that would go over one, nothing is blocked.
export default function LendingLimitsPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()

  const [position, setPosition] = useState<LendingPosition | null>(null)
  const [loadError, setLoadError] = useState("")
  const [draft, setDraft] = useState<Record<LimitField, string>>({
    max_total_loans_pct: "",
    max_per_borrower_pct: "",
    max_member_hold_pct: ""
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")
  const [toast, setToast] = useState("")

  const load = useCallback(async () => {
    try {
      const next = await fetchLendingPosition()
      setPosition(next)
      setDraft({
        max_total_loans_pct: String(next.limits.max_total_loans_pct),
        max_per_borrower_pct: String(next.limits.max_per_borrower_pct),
        max_member_hold_pct: String(next.limits.max_member_hold_pct)
      })
      setLoadError("")
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Something went wrong.")
    }
  }, [])

  useEffect(() => {
    if (authLoading) return
    if (!member) {
      router.push("/login")
      return
    }
    if (member.role !== "admin") {
      router.push("/dashboard")
      return
    }
    markLendingLimitsSeen()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data once the auth check above passes
    load()
  }, [authLoading, member, router, load])

  const parsed = LIMIT_FIELDS.map(({ field }) => Number(draft[field]))
  const draftValid = LIMIT_FIELDS.every(({ field }) => draft[field].trim() !== "") && parsed.every((n) => Number.isFinite(n) && n > 0 && n <= 100)
  const changed =
    position != null &&
    LIMIT_FIELDS.some(({ field }) => Number(draft[field]) !== position.limits[field])

  async function save() {
    if (!draftValid) return
    setSaving(true)
    setSaveError("")
    try {
      await saveLendingLimits({
        max_total_loans_pct: Number(draft.max_total_loans_pct),
        max_per_borrower_pct: Number(draft.max_per_borrower_pct),
        max_member_hold_pct: Number(draft.max_member_hold_pct)
      })
      await load()
      setToast("Lending limits saved")
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Something went wrong.")
    }
    setSaving(false)
  }

  if (authLoading || (!position && !loadError)) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-lg mx-auto px-4 sm:px-5 pt-8 pb-24">
            <SkeletonCardList rows={3} />
          </div>
        </main>
      </>
    )
  }

  const limits = position?.limits
  const available = position ? availableToLend(position) : 0
  const loanedPct = position && position.fundTotal > 0 ? (position.loanedOut / position.fundTotal) * 100 : 0

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-lg mx-auto px-4 sm:px-5 pt-8 pb-[calc(6rem+var(--dock-h)+env(safe-area-inset-bottom))]">
          <button
            onClick={() => router.push("/admin")}
            className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors"
          >
            ← Administration
          </button>

          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-6">Lending limits</h1>

          {loadError && <p className="mb-4 text-sm text-rust">Couldn&apos;t load: {loadError}</p>}

          {position && limits && (
            <div className="space-y-7">
              {/* ---- Where the fund stands ---- */}
              <section>
                <div className="card p-5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] text-ink-soft">Available to lend</span>
                    <span className={`font-mono text-2xl font-semibold ${available > 0 ? "text-ink" : "text-rust"}`}>
                      ₱{fmt(available)}
                    </span>
                  </div>
                  <div className="mt-3 h-1.5 rounded-full bg-hairline overflow-hidden">
                    <div
                      className={`h-full ${loanedPct > limits.max_total_loans_pct ? "bg-rust" : "bg-gold"}`}
                      style={{ width: `${Math.min(100, (loanedPct / limits.max_total_loans_pct) * 100)}%` }}
                    />
                  </div>
                  <dl className="mt-4 space-y-2 text-[13px]">
                    <Row label="Fund total" value={`₱${fmt(position.fundTotal)}`} />
                    <Row label="Cash in banks" value={`₱${fmt(position.cash)}`} />
                    <Row label="Out on loan" value={`₱${fmt(position.loanedOut)} · ${pct(loanedPct)}`} />
                  </dl>
                </div>
              </section>

              {/* ---- The limits themselves ---- */}
              <section>
                <p className={sectionLabelClass}>Limits</p>
                <p className={sectionNoteClass}>Tap a number to change it, then Save.</p>
                <div data-tour="lending-limits" className="card divide-y divide-hairline">
                  {LIMIT_FIELDS.map(({ field, label, hint }) => (
                    <label key={field} className="flex items-center gap-3 px-5 py-4 cursor-text">
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-ink">{label}</span>
                        <span className="block text-[12px] text-ink-soft">Max {hint}</span>
                      </span>
                      {/* A filled box with a gold edge reads as a field to type
                          in; the old hairline outline looked like plain text. */}
                      <span
                        className={`shrink-0 flex items-center gap-1 rounded-lg border bg-paper px-3 py-2 focus-within:border-gold ${
                          Number(draft[field]) !== limits[field] ? "border-gold" : "border-gold/40"
                        }`}
                      >
                        <input
                          type="number"
                          inputMode="decimal"
                          min={1}
                          max={100}
                          step="any"
                          value={draft[field]}
                          onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
                          onFocus={(e) => e.target.select()}
                          className="w-12 bg-transparent text-right font-mono text-base font-semibold text-ink focus:outline-none"
                          aria-label={`${label} limit, percent`}
                        />
                        <span className="font-mono text-sm text-ink-soft">%</span>
                      </span>
                    </label>
                  ))}
                </div>
                {!draftValid && <p className="mt-2 px-1 text-[12px] text-rust">Each limit must be more than 0% and at most 100%.</p>}
                {saveError && <p className="mt-2 px-1 text-[12px] text-rust">{saveError}</p>}
                <div className="mt-3 flex items-center justify-between gap-3 px-1">
                  <span className="text-[11px] text-ink-soft">
                    {limits.updated_by_name
                      ? `Last changed by ${limits.updated_by_name} · ${new Date(limits.updated_at ?? "").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
                      : "Not changed yet"}
                  </span>
                  <button
                    onClick={save}
                    disabled={!changed || !draftValid || saving}
                    className="shrink-0 bg-ink text-paper px-5 py-2 rounded-full text-sm font-semibold disabled:opacity-40"
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                </div>
              </section>

              {/* ---- Borrowers ---- */}
              <section>
                <p className={sectionLabelClass}>Borrowers</p>
                <p className={sectionNoteClass}>
                  Unpaid principal plus any pending request, as a share of the fund. Limit {pct(limits.max_per_borrower_pct)}.
                </p>
                {position.borrowers.length === 0 ? (
                  <div className="card px-5 py-4 text-[13px] text-ink-soft">No active or requested loans.</div>
                ) : (
                  <div className="card divide-y divide-hairline">
                    {position.borrowers.map((b) => {
                      const total = b.active + b.requested
                      const share = position.fundTotal > 0 ? (total / position.fundTotal) * 100 : 0
                      const over = share > limits.max_per_borrower_pct
                      return (
                        <div key={b.key} className="flex items-center gap-3 px-5 py-3.5">
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm font-semibold text-ink truncate">{b.name}</span>
                            <span className="block text-[12px] text-ink-soft">
                              ₱{fmt(b.active)} out{b.requested > 0 ? ` · ₱${fmt(b.requested)} requested` : ""}
                            </span>
                          </span>
                          <span className={`shrink-0 font-mono text-sm ${over ? "text-rust font-semibold" : "text-ink"}`}>
                            {pct(share)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>

              {/* ---- Member holds ---- */}
              <section>
                <p className={sectionLabelClass}>Member holds</p>
                <p className={sectionNoteClass}>
                  Money on hold for loans and investments, as a share of each member&apos;s own value. Limit{" "}
                  {pct(limits.max_member_hold_pct)}.
                </p>
                <div className="card divide-y divide-hairline">
                  {position.members.map((m) => {
                    const p = holdPct(m)
                    const over = p > limits.max_member_hold_pct
                    return (
                      <div key={m.member_id} className="flex items-center gap-3 px-5 py-3.5">
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-semibold text-ink truncate">{m.name}</span>
                          <span className="block text-[12px] text-ink-soft">
                            ₱{fmt(m.onHold)} of ₱{fmt(m.totalValue)}
                          </span>
                        </span>
                        <span className={`shrink-0 font-mono text-sm ${over ? "text-rust font-semibold" : "text-ink"}`}>
                          {pct(p)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </section>
            </div>
          )}
        </div>
      </main>
      {toast && <Toast message={toast} onDone={() => setToast("")} />}
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="font-mono text-ink text-right">{value}</dd>
    </div>
  )
}
