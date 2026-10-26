"use client"

import { useState } from "react"
import { InterestRatePickerSheet } from "@/app/components/InterestRatePickerSheet"
import { TermPickerSheet } from "@/app/components/TermPickerSheet"
import { DueDayPickerSheet } from "@/app/components/DueDayPickerSheet"
import {
  FieldRow,
  InterestIcon,
  ClockIcon,
  RepeatIcon,
  CalendarIcon,
  rowInputClass
} from "@/app/components/TransactionFormUI"
import { totalRepayable, type InterestType } from "@/lib/loanMath"
import { daysTermLabel, lumpSumDueDate, longDate, monthsUntil, ordinalDay } from "@/lib/loanFormat"
import { dateOnly } from "@/lib/currentValue"

function isValidPositiveNumber(value: string, allowZero = false): boolean {
  if (!value.trim()) return false
  const n = Number(value)
  if (Number.isNaN(n)) return false
  return allowZero ? n >= 0 : n > 0
}

const fmt = (n: number) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// The "Loan Terms" card -- interest, term, repayment mode and the live
// repayment estimate -- shared by a member's Loan Request in
// NewTransactionSheet and a borrower's /borrower/request page, so both
// ways of asking for a loan look and behave the same. The values
// themselves stay owned by the caller (it validates and submits them);
// only the picker/custom-entry UI state lives here.
export function LoanTermsCard({
  amount,
  interestType,
  setInterestType,
  interestRate,
  setInterestRate,
  interestAmount,
  setInterestAmount,
  termMonths,
  setTermMonths,
  repaymentFrequency,
  setRepaymentFrequency,
  dueDay,
  setDueDay,
  dueDate,
  setDueDate,
  startDate,
  showErrors = false
}: {
  amount: string
  interestType: InterestType
  setInterestType: (v: InterestType) => void
  interestRate: string
  setInterestRate: (v: string) => void
  interestAmount: string
  setInterestAmount: (v: string) => void
  termMonths: string
  setTermMonths: (v: string) => void
  repaymentFrequency: string
  setRepaymentFrequency: (v: string) => void
  dueDay: string
  setDueDay: (v: string) => void
  // A lump sum's picked due date (YYYY-MM-DD), or "" for end of term.
  dueDate: string
  setDueDate: (v: string) => void
  // What the term counts from -- the loan's start date, or today for a new
  // request. The release moves it to the release day, but a picked due
  // date stays put.
  startDate?: string
  // Set once Submit/Continue was tapped with something missing -- each
  // empty term then shows what it needs (see FieldError).
  showErrors?: boolean
}) {
  const interestError =
    showErrors && !(interestType === "rate" ? interestRate : interestAmount)
      ? interestType === "rate"
        ? "Choose an interest rate"
        : "Enter the interest amount"
      : undefined
  const termError = showErrors && !termMonths ? "Choose a term" : undefined
  const dueDayError = showErrors && repaymentFrequency === "monthly" && !dueDay ? "Choose a due day" : undefined
  const [showInterestRatePicker, setShowInterestRatePicker] = useState(false)
  const [showTermPicker, setShowTermPicker] = useState(false)
  const [showDueDayPicker, setShowDueDayPicker] = useState(false)
  // Picker is the default interaction for both -- these only flip to true
  // when someone explicitly picks "Custom" from the sheet, swapping the
  // row over to the plain number input for direct typing.
  const [interestRateCustom, setInterestRateCustom] = useState(false)
  const [termCustom, setTermCustom] = useState(false)

  const termStart = startDate ?? dateOnly(new Date())
  const lumpSumDue =
    repaymentFrequency === "lump_sum"
      ? lumpSumDueDate(termStart, isValidPositiveNumber(termMonths) ? Number(termMonths) : null, dueDate)
      : null

  // A term and a picked due date are two ways of saying the same thing --
  // choosing a term drops the date, and picking a date sets the term to
  // the whole months up to it.
  function chooseTerm(months: string) {
    setTermMonths(months)
    setDueDate("")
  }

  const previewTotalRepayable =
    isValidPositiveNumber(amount) &&
    (interestType === "rate" ? isValidPositiveNumber(interestRate, true) : isValidPositiveNumber(interestAmount, true))
      ? totalRepayable(Number(amount), interestType, Number(interestRate || 0), Number(interestAmount || 0))
      : 0

  const previewPerInstallment =
    previewTotalRepayable && isValidPositiveNumber(termMonths) && repaymentFrequency === "monthly"
      ? previewTotalRepayable / Number(termMonths)
      : previewTotalRepayable

  return (
    <>
    <div>
      <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">Loan Terms</p>
      <div className="card divide-y divide-hairline overflow-hidden">
        {/* Toggle + value share one row instead of stacking (toggle, then a
            second full-width input below it) -- the toggle only ever needs
            two glyphs' worth of width once it's not also carrying "Rate (%)"/
            "Fixed amount (₱)" as button text. */}
        <FieldRow icon={<InterestIcon />} error={interestError}>
          {interestType === "rate" && !interestRateCustom ? (
            // Picker is the default way in -- tapping the
            // value area itself opens the same sheet the
            // trailing ▾ does, not just a narrow target.
            <button
              type="button"
              onClick={() => setShowInterestRatePicker(true)}
              className="flex-1 min-w-0 text-left text-sm"
            >
              {interestRate ? (
                <span className="text-ink">{interestRate}%</span>
              ) : (
                <span className="text-ink-soft">Interest rate, e.g. 5</span>
              )}
            </button>
          ) : (
            <input
              className={rowInputClass}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder={interestType === "rate" ? "Interest rate, e.g. 5" : "Interest amount, e.g. 5000"}
              value={interestType === "rate" ? interestRate : interestAmount}
              onChange={(e) =>
                interestType === "rate" ? setInterestRate(e.target.value) : setInterestAmount(e.target.value)
              }
              autoFocus={interestType === "rate" && interestRateCustom}
            />
          )}
          <div className="flex border border-hairline rounded-sm overflow-hidden shrink-0">
            <button
              type="button"
              onClick={() => setInterestType("rate")}
              aria-label="Interest as a rate"
              className={`w-8 py-1.5 text-xs font-semibold transition-colors ${
                interestType === "rate" ? "bg-ink text-paper" : "text-ink-soft"
              }`}
            >
              %
            </button>
            <button
              type="button"
              onClick={() => setInterestType("amount")}
              aria-label="Interest as a fixed amount"
              className={`w-8 py-1.5 text-xs font-semibold border-l border-hairline transition-colors ${
                interestType === "amount" ? "bg-ink text-paper" : "text-ink-soft"
              }`}
            >
              ₱
            </button>
          </div>
          {/* Fixed peso amounts have no sensible universal
              presets, so the picker shortcut only applies
              to the rate side -- the input itself stays the
              only way to enter a fixed amount either way. */}
          {interestType === "rate" && (
            <button
              type="button"
              onClick={() => setShowInterestRatePicker(true)}
              aria-label="Choose a common interest rate"
              className="text-ink-soft text-xs shrink-0 px-1"
            >
              ▾
            </button>
          )}
        </FieldRow>

        <FieldRow icon={<ClockIcon />} error={termError}>
          {!termCustom ? (
            <button
              type="button"
              onClick={() => setShowTermPicker(true)}
              className="flex-1 min-w-0 text-left text-sm"
            >
              {repaymentFrequency === "lump_sum" && dueDate ? (
                <span className="text-ink">{daysTermLabel(termStart, dueDate)}</span>
              ) : termMonths ? (
                <span className="text-ink">
                  {termMonths} {termMonths === "1" ? "month" : "months"}
                </span>
              ) : (
                <span className="text-ink-soft">Term, e.g. 6</span>
              )}
            </button>
          ) : (
            <>
              <input
                className={rowInputClass}
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                placeholder="Term, e.g. 6"
                value={termMonths}
                onChange={(e) => chooseTerm(e.target.value)}
                autoFocus
              />
              <span className="text-xs text-ink-soft shrink-0">months</span>
            </>
          )}
          <button
            type="button"
            onClick={() => setShowTermPicker(true)}
            aria-label="Choose a common payment term"
            className="text-ink-soft text-xs shrink-0 px-1"
          >
            ▾
          </button>
        </FieldRow>

        <FieldRow icon={<RepeatIcon />}>
          <div className="flex-1 flex border border-hairline rounded-sm overflow-hidden">
            <button
              type="button"
              onClick={() => {
                setRepaymentFrequency("monthly")
                setDueDate("")
              }}
              className={`flex-1 text-xs font-semibold py-2 transition-colors ${
                repaymentFrequency === "monthly" ? "bg-ink text-paper" : "text-ink-soft"
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setRepaymentFrequency("lump_sum")}
              className={`flex-1 text-xs font-semibold py-2 border-l border-hairline transition-colors ${
                repaymentFrequency === "lump_sum" ? "bg-ink text-paper" : "text-ink-soft"
              }`}
            >
              Lump sum
            </button>
          </div>
        </FieldRow>

        {/* A lump sum is due once: at the end of the term unless a date is
            picked here instead. */}
        {repaymentFrequency === "lump_sum" && (
          <FieldRow icon={<CalendarIcon />}>
            <span className="text-sm text-ink-soft shrink-0">Due on</span>
            <input
              className={`${rowInputClass} text-right`}
              type="date"
              aria-label="Lump sum due date"
              min={termStart}
              value={lumpSumDue ?? ""}
              onChange={(e) => {
                const date = e.target.value
                if (!date) return setDueDate("")
                setDueDate(date)
                setTermMonths(String(monthsUntil(termStart, date)))
                setTermCustom(false)
              }}
            />
          </FieldRow>
        )}


        {repaymentFrequency === "monthly" && (
          <FieldRow icon={<CalendarIcon />} error={dueDayError}>
            <button
              type="button"
              onClick={() => setShowDueDayPicker(true)}
              className="flex-1 min-w-0 text-left text-sm"
            >
              {dueDay ? (
                <span className="text-ink">Due on the {ordinalDay(Number(dueDay))} of each month</span>
              ) : (
                <span className="text-ink-soft">Due day each month, e.g. 15th</span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setShowDueDayPicker(true)}
              aria-label="Choose the monthly due day"
              className="text-ink-soft text-xs shrink-0 px-1"
            >
              ▾
            </button>
          </FieldRow>
        )}

        {/* Right in the same card, directly under the fields that produce
            it -- previously a separate box below the card, easy to miss
            without scrolling since nothing here visually tied it to Interest/
            Term/Repayment above it. bg-gold/10 is the app's own "highlighted
            result" accent (StepTrack, the selected row in a dropdown)
            rather than the plain bg-paper the old box used, which in
            dark mode is darker than the card itself and read as dead. */}
        {previewTotalRepayable > 0 && isValidPositiveNumber(termMonths) && (
          <>
            <div className="flex items-center justify-between px-4 py-3 bg-gold/10">
              <span className="text-sm font-semibold text-ink">Total repayable</span>
              <span className="text-sm font-bold font-mono [font-variant-numeric:tabular-nums] text-gold">
                ₱{fmt(previewTotalRepayable)}
              </span>
            </div>
            <div className="flex items-center justify-between px-4 py-3 bg-gold/10">
              <span className="text-sm text-ink-soft">
                {repaymentFrequency === "monthly"
                  ? `Per month × ${termMonths}`
                  : lumpSumDue
                    ? `Due ${longDate(lumpSumDue)}`
                    : `Due at ${termMonths} months`}
              </span>
              <span className="text-sm font-semibold font-mono [font-variant-numeric:tabular-nums] text-ink">
                ₱{fmt(previewPerInstallment)}
              </span>
            </div>
          </>
        )}
      </div>
    </div>

    {showInterestRatePicker && (
      <InterestRatePickerSheet
        value={interestRate}
        onClose={() => setShowInterestRatePicker(false)}
        onSelect={(rate) => {
          setInterestRate(String(rate))
          setInterestRateCustom(false)
          setShowInterestRatePicker(false)
        }}
        onCustom={() => {
          setInterestRateCustom(true)
          setShowInterestRatePicker(false)
        }}
      />
    )}

    {showDueDayPicker && (
      <DueDayPickerSheet
        value={dueDay}
        onClose={() => setShowDueDayPicker(false)}
        onSelect={(day) => {
          setDueDay(String(day))
          setShowDueDayPicker(false)
        }}
      />
    )}

    {showTermPicker && (
      <TermPickerSheet
        value={termMonths}
        onClose={() => setShowTermPicker(false)}
        onSelect={(months) => {
          chooseTerm(String(months))
          setTermCustom(false)
          setShowTermPicker(false)
        }}
        onCustom={() => {
          setTermCustom(true)
          setShowTermPicker(false)
        }}
      />
    )}
    </>
  )
}
