import type { InterestType } from "@/lib/loanMath"

// The one place that turns a loan's interest terms into display text --
// used on both the loans list and the loan detail page so the wording
// ("flat" vs "%") never drifts between them.
export function formatInterestLabel(
  interestType: InterestType | null | undefined,
  interestRate: number | null | undefined,
  interestAmount: number | null | undefined,
  fmt: (n: number) => string
): string {
  if (interestType === "amount") {
    return interestAmount != null ? `₱${fmt(interestAmount)} flat` : "—"
  }
  return interestRate != null ? `${interestRate}%` : "—"
}

// How long a closed loan took to pay off, from release to its closing date
// (v_loan_summary.closed_date -- the last gain allocation, or for a
// zero-gain loan with no allocation row, its last approved repayment).
// Returns null while the loan is still open.
export function durationLabel(startDate: string, closedDate: string | null): string | null {
  if (!closedDate) return null

  const days = Math.max(0, Math.round((new Date(closedDate).getTime() - new Date(startDate).getTime()) / 86400000))
  if (days === 0) return "same day"
  if (days < 30) return `${days} day${days === 1 ? "" : "s"}`

  const months = days / 30.44
  if (months < 24) return `${Math.round(months)} mo`

  const years = Math.floor(months / 12)
  const remMonths = Math.round(months % 12)
  return remMonths > 0 ? `${years} yr ${remMonths} mo` : `${years} yr`
}

// Flags an active monthly loan that's behind -- lump_sum loans have no
// periodic cadence to miss, so only 'monthly' is checked.
//
// With a due day set, it counts from the next due date after the last
// approved "Loan Repayment" (or start_date if none yet): overdue once that
// date has passed unpaid. A payment counts toward the due date nearest it,
// so paying a few days early or late doesn't flag the very next cycle --
// see nextDueDate.
//
// Older loans with no due day keep the original heuristic: 45 days of
// silence (vs. a strict 30, absorbing payment-date drift between cycles).
export function paymentOverdueLabel(
  status: "requested" | "active" | "closed",
  repaymentFrequency: string | null | undefined,
  startDate: string,
  lastRepaymentDate: string | null,
  dueDay?: number | null,
  today: Date = new Date()
): string | null {
  if (status !== "active" || repaymentFrequency !== "monthly") return null

  const since = lastRepaymentDate ?? startDate

  if (dueDay) {
    const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
    let due = nextDueDate(since, dueDay)
    let missed = 0
    while (due < todayUtc) {
      missed++
      due = dueDateInMonth(new Date(due).getUTCFullYear(), new Date(due).getUTCMonth() + 1, dueDay)
    }
    if (missed === 0) return null
    return missed === 1 ? "Payment overdue" : `${missed} payments overdue`
  }

  const days = Math.round((today.getTime() - new Date(since).getTime()) / 86400000)
  if (days <= 45) return null

  const monthsLate = Math.max(1, Math.floor(days / 30.44))
  return monthsLate === 1 ? "Payment overdue" : `${monthsLate} mo overdue`
}

// The due day in a given month, clamped to that month's last day (a 31st
// due day falls on Feb 28/29, Apr 30, ...). UTC midnight, in ms.
function dueDateInMonth(year: number, monthIndex: number, dueDay: number): number {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  return Date.UTC(year, monthIndex, Math.min(dueDay, lastDay))
}

// First due date more than 15 days after `from` (a YYYY-MM-DD date): the
// next installment owed after a payment or release on that date. The
// 15-day gap is what lets a payment cover the due date it was nearest to
// -- paid on the 13th for a 15th due day, the next one owed is next
// month's 15th, not two days later.
export function nextDueDate(from: string, dueDay: number): number {
  const [y, m, d] = from.split("-").map(Number)
  const threshold = Date.UTC(y, m - 1, d + 15)
  let year = y
  let month = m - 1
  let due = dueDateInMonth(year, month, dueDay)
  while (due <= threshold) {
    month++
    if (month > 11) {
      month = 0
      year++
    }
    due = dueDateInMonth(year, month, dueDay)
  }
  return due
}

// 1 -> "1st", 22 -> "22nd", 13 -> "13th" -- for a loan's monthly due day.
export function ordinalDay(day: number): string {
  const mod100 = day % 100
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th"
  return `${day}${suffix}`
}

// How a loan is named wherever a member picks which one they're paying:
// "₱10,000.00 loan · Oct 15, 2026" -- the raw "from 2026-10-15" read like
// a database dump.
export function loanPickLabel(principal: number, startDate: string, fmt: (n: number) => string): string {
  const date = new Date(`${startDate}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
  return `₱${fmt(principal)} loan · ${date}`
}

// When a lump-sum loan is due, as YYYY-MM-DD: its picked due date if it
// has one, otherwise start date + term. Month-ends clamp the way Postgres
// does (Jan 31 + 1 month = Feb 28), matching the payment reminders.
export function lumpSumDueDate(startDate: string, termMonths: number | null, dueDate?: string | null): string | null {
  if (dueDate) return dueDate
  if (!termMonths) return null
  const [y, m, d] = startDate.split("-").map(Number)
  const lastDay = new Date(Date.UTC(y, m - 1 + termMonths + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m - 1 + termMonths, Math.min(d, lastDay))).toISOString().slice(0, 10)
}

// Whole months from startDate to dueDate (both YYYY-MM-DD), rounded up and
// at least 1 -- the term stored alongside a picked lump-sum due date.
export function monthsUntil(startDate: string, dueDate: string): number {
  const [y1, m1, d1] = startDate.split("-").map(Number)
  const [y2, m2, d2] = dueDate.split("-").map(Number)
  return Math.max(1, (y2 - y1) * 12 + (m2 - m1) + (d2 > d1 ? 1 : 0))
}

// "15 Dec 2026", for a YYYY-MM-DD date.
export function longDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

// A lump sum's term when it has a picked due date: the days from start to
// due date ("2 days", "45 days") rather than the rounded-up month count.
export function daysTermLabel(startDate: string, dueDate: string): string {
  const days = Math.max(0, Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000))
  return `${days} ${days === 1 ? "day" : "days"}`
}
