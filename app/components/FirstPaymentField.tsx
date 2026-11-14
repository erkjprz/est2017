"use client"

import { firstUnpaidDueDate, longDate } from "@/lib/loanFormat"
import { dateOnly } from "@/lib/currentValue"
import { CalendarIcon } from "@/app/components/TransactionFormUI"

// The "First payment" row for a monthly loan (admin only). Same approach as
// DateField: a transparent native date input covers the whole row, so a
// tap anywhere opens the picker immediately (iOS's wheel included), while
// the visible text is ours. A bare visible <input type="date"> was a small,
// laggy tap target on iOS, especially while empty. The clear button sits
// above the input so it stays tappable.
//
// Left empty ("from release"), it shows the date the first payment would
// actually fall on -- the first due day at least 15 days after the release,
// same as the reminders -- and the picker opens on that date.
export function FirstPaymentField({
  value,
  onChange,
  dueDay,
  releasedOn
}: {
  // YYYY-MM-DD, or "" for "from release".
  value: string
  onChange: (v: string) => void
  // The loan's monthly due day; without one there's no single date to show.
  dueDay?: number | null
  // When the money went out, for a loan that's already active; otherwise
  // the estimate assumes it's released today.
  releasedOn?: string
}) {
  const fromRelease = dueDay
    ? new Date(firstUnpaidDueDate(null, releasedOn ?? dateOnly(new Date()), null, dueDay)).toISOString().slice(0, 10)
    : null

  return (
    <div className="relative">
      <input
        type="date"
        value={value || fromRelease || ""}
        onChange={(e) => onChange(e.target.value)}
        aria-label="First payment date"
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer [color-scheme:dark]"
      />
      <div className="pointer-events-none flex items-center gap-3 px-4 py-3.5 text-sm">
        <CalendarIcon />
        <span className="flex-1 min-w-0 text-ink">First payment</span>
        {value ? (
          <span className="shrink-0 text-ink">{longDate(value)}</span>
        ) : (
          <span className="shrink-0 text-right">
            {fromRelease && <span className="block text-ink-soft">{longDate(fromRelease)}</span>}
            <span className="block text-[11px] text-ink-soft">from release</span>
          </span>
        )}
        {/* Room for the clear button, which sits outside this
            pointer-events-none layer. */}
        {value && <span className="w-5 shrink-0" />}
      </div>
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear first payment date"
          className="absolute right-3 top-1/2 -translate-y-1/2 z-10 text-ink-soft text-xs px-1 py-1"
        >
          ✕
        </button>
      )}
    </div>
  )
}
