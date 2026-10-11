"use client"

// Admin-only bottom sheets for the Investments tab. Add Investment opens
// from the list; everything else (edit details, distribute, close, reopen)
// opens from the investment's own page -- each in its own sheet in place of
// the old Manage mode, inline forms and browser confirm() prompts. The
// writes themselves are unchanged.

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { Sheet } from "@/app/components/Sheet"
import { DateField, FieldRow, NoteIcon, RequiredMark, rowInputClass } from "@/app/components/TransactionFormUI"
import {
  distributeInvestmentGain,
  getUndistributedInvestmentGain,
  previewInvestmentDistribution,
  type InvestmentSharePreview
} from "@/lib/distributeInvestment"
import { closeInvestmentAndDistributeGain } from "@/lib/closeInvestment"
import { dateOnly } from "@/lib/currentValue"

export type InvestmentRow = {
  investment_id: string
  investment: string
  affects_cash: number
}

const fmt = (n: number) =>
  Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const primaryButtonClass = "w-full bg-ink text-paper px-4 py-3 rounded-sm text-sm font-medium disabled:opacity-50"
const sectionLabelClass = "text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-2 px-1"

function Callout({ tone = "neutral", children }: { tone?: "neutral" | "warn"; children: React.ReactNode }) {
  return (
    <p
      className={`text-[12px] rounded-md px-4 py-3 border ${
        tone === "warn" ? "text-rust border-rust/30 bg-rust/5" : "text-ink-soft border-hairline bg-paper"
      }`}
    >
      {children}
    </p>
  )
}

/* ---------------------------- Add / edit details ---------------------------- */

export function InvestmentDetailsSheet({
  investment,
  onClose,
  onSaved
}: {
  investment: InvestmentRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(investment?.investment ?? "")
  const [affectsCash, setAffectsCash] = useState(investment ? !!investment.affects_cash : true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")

  const cashChanged = !!investment && !!investment.affects_cash !== affectsCash

  async function save() {
    if (!name.trim()) {
      setMessage("Enter an investment name.")
      return
    }

    setSaving(true)
    setMessage("")

    if (investment) {
      const { error } = await supabase
        .from("investments")
        .update({ name, affects_cash: affectsCash ? 1 : 0 })
        .eq("investment_id", investment.investment_id)

      if (error) {
        setSaving(false)
        setMessage(error.message)
        return
      }

      // v_cash_ledger reads each transaction's own affects_cash, not the
      // investment's -- without this, flipping the toggle here would leave
      // every transaction already recorded against this investment still
      // treated the old way, silently contradicting what the toggle now
      // says.
      const { error: syncError } = await supabase
        .from("transactions")
        .update({ affects_cash: affectsCash ? 1 : 0 })
        .eq("investment_id", investment.investment_id)
        .in("classification", ["Investment", "Investment Return"])

      setSaving(false)
      if (syncError) {
        setMessage(`Investment saved, but couldn't update its existing transactions: ${syncError.message}`)
        return
      }
    } else {
      const { error } = await supabase.from("investments").insert({
        name,
        affects_cash: affectsCash ? 1 : 0
      })

      setSaving(false)
      if (error) {
        setMessage(error.message)
        return
      }
    }

    onSaved()
    onClose()
  }

  return (
    <Sheet
      title={investment ? "Edit Investment" : "Add Investment"}
      onClose={onClose}
      footer={
        <div>
          {message && <p className="text-sm text-rust mb-2">{message}</p>}
          <button className={primaryButtonClass} onClick={save} disabled={saving}>
            {saving ? "Saving..." : investment ? "Save Changes" : "Add Investment"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <p className={sectionLabelClass}>
            Investment name
            <RequiredMark />
          </p>
          <div className="card overflow-hidden">
            <FieldRow icon={<NoteIcon />}>
              <input
                className={rowInputClass}
                placeholder="e.g. Farmon - Rice (2026-Q3)"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </FieldRow>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setAffectsCash(!affectsCash)}
          className="w-full card flex items-center justify-between gap-3 px-4 py-3.5 text-left"
        >
          <span>
            <span className="block text-sm font-medium text-ink">Affects cash</span>
            <span className="block text-xs text-ink-soft mt-0.5">
              {affectsCash ? "Funded through the tracked bank accounts" : "Funded outside the tracked cash trail"}
            </span>
          </span>
          <span
            className={`shrink-0 relative w-[38px] h-[22px] rounded-full transition-colors ${
              affectsCash ? "bg-sage" : "bg-hairline"
            }`}
          >
            <span
              className={`absolute top-[2px] w-[18px] h-[18px] rounded-full bg-paper shadow transition-transform ${
                affectsCash ? "translate-x-[18px]" : "translate-x-[2px]"
              }`}
            />
          </span>
        </button>

        {/* Saving a changed toggle also rewrites every Investment/Investment
            Return already recorded against this investment -- said up front
            rather than left as a silent side effect. */}
        {cashChanged && (
          <Callout tone="warn">
            Saving also updates every investment and return transaction already recorded for this investment, so
            bank balances count them the new way.
          </Callout>
        )}

        <p className="text-[12px] text-ink-soft px-1">
          Invested, returned, and gain/loss aren&apos;t set here — they&apos;re totalled automatically from approved
          transactions tagged to this investment.
        </p>
      </div>
    </Sheet>
  )
}

/* -------------------------- Distribute / close -------------------------- */

// One sheet for both an ad hoc distribution and the final one on closing --
// closing is just a distribution that also flips the investment's status.
// Shows each member's share (a read-only preview using the same formula)
// before the irreversible write; the commit is the same
// distributeInvestmentGain / closeInvestmentAndDistributeGain call as
// before.
export function DistributeInvestmentSheet({
  investmentId,
  investmentName,
  mode,
  onClose,
  onDone
}: {
  investmentId: string
  investmentName?: string
  mode: "distribute" | "close"
  onClose: () => void
  onDone: () => void
}) {
  const closing = mode === "close"
  const [date, setDate] = useState(dateOnly(new Date()))
  const [direction, setDirection] = useState<"gain" | "loss">("gain")
  const [magnitude, setMagnitude] = useState("")
  const [notes, setNotes] = useState("")
  const [suggested, setSuggested] = useState<number | null>(null)
  const [touched, setTouched] = useState(false)
  // Each preview remembers the amount/date it was computed for, so a stale
  // one (from before the latest edit) is simply ignored at render time.
  const [previewResult, setPreviewResult] = useState<{
    key: string
    shares: InvestmentSharePreview[] | null
    error: string
  } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState("")

  // Prefills the amount with what's still undistributed as of the chosen
  // date -- the same figure the old form's "Use undistributed amount" link
  // filled in -- until the admin types their own.
  useEffect(() => {
    let cancelled = false
    getUndistributedInvestmentGain(investmentId, date)
      .then((value) => {
        if (cancelled) return
        setSuggested(value)
        if (!touched) {
          setDirection(value < 0 ? "loss" : "gain")
          setMagnitude(value === 0 ? (closing ? "0" : "") : String(Math.abs(value)))
        }
      })
      .catch((err) => {
        if (cancelled) return
        setSuggested(null)
        setMessage(err instanceof Error ? err.message : "Couldn't compute a suggested amount.")
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [investmentId, date])

  const parsed = magnitude.trim() ? Number(magnitude) : 0
  const amountNum = Number.isNaN(parsed) ? NaN : direction === "loss" ? -Math.abs(parsed) : Math.abs(parsed)

  // Debounced so typing an amount doesn't fire a preview per keystroke.
  const previewKey = `${amountNum}|${date}`
  useEffect(() => {
    if (Number.isNaN(amountNum) || amountNum === 0 || !date) return
    const key = `${amountNum}|${date}`
    const timer = setTimeout(() => {
      previewInvestmentDistribution(amountNum, date)
        .then((shares) => setPreviewResult({ key, shares, error: "" }))
        .catch((err) =>
          setPreviewResult({ key, shares: null, error: err instanceof Error ? err.message : "Couldn't load the preview." })
        )
    }, 350)
    return () => clearTimeout(timer)
  }, [amountNum, date])
  const current = previewResult?.key === previewKey ? previewResult : null
  const preview = current?.shares ?? null
  const previewError = current?.error ?? ""

  async function submit() {
    if (Number.isNaN(amountNum)) {
      setMessage("Enter a valid amount.")
      return
    }
    // A regular distribution with nothing to distribute makes no sense to
    // submit, but closing with a zero remainder is a legitimate "nothing
    // left to settle, just mark it done" case.
    if (!closing && amountNum === 0) {
      setMessage("Enter an amount to distribute.")
      return
    }
    if (!date) {
      setMessage("Pick a date.")
      return
    }

    setSubmitting(true)
    setMessage("")

    try {
      if (closing) {
        await closeInvestmentAndDistributeGain({
          investmentId,
          closingDate: date,
          amount: amountNum,
          notes: notes || undefined,
          investmentName
        })
      } else {
        await distributeInvestmentGain({
          investmentId,
          allocationDate: date,
          amount: amountNum,
          notes: notes || undefined
        })
      }
      onDone()
      onClose()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Something went wrong.")
      setSubmitting(false)
    }
  }

  const isLoss = amountNum < 0
  const noRecipients = preview !== null && preview.length === 0
  const cta = submitting
    ? closing
      ? "Closing..."
      : "Distributing..."
    : closing
    ? amountNum === 0
      ? "Close Investment"
      : `Close & ${isLoss ? "Record" : "Distribute"} ₱${fmt(Math.abs(amountNum || 0))} ${isLoss ? "Loss" : "Gain"}`
    : `Distribute ₱${fmt(Math.abs(amountNum || 0))} ${isLoss ? "Loss" : "Gain"}`

  return (
    <Sheet
      title={closing ? "Close Investment" : "Distribute Gain/Loss"}
      onClose={onClose}
      footer={
        <div>
          {message && <p className="text-sm text-rust mb-2">{message}</p>}
          <button
            className={primaryButtonClass}
            onClick={submit}
            disabled={submitting || Number.isNaN(amountNum) || (!closing && amountNum === 0) || noRecipients}
          >
            {cta}
          </button>
          <p className="text-[11px] text-ink-soft text-center mt-2">
            {closing
              ? "Marks it closed. You can reopen it later from the ⋯ menu."
              : "Credits each member's share now. This can't be undone from the app."}
          </p>
        </div>
      }
    >
      <div className="space-y-4">
        <Callout>
          {closing
            ? "Settles whatever's left, split by each member's value in the fund on the date below, and marks this investment closed. Zero is fine if there's nothing left to distribute."
            : "Splits a realized gain or loss across members, by each member's value in the fund on the date below."}
        </Callout>

        <div>
          <p className={sectionLabelClass}>
            Amount
            {/* Closing with nothing left to settle can be ₱0. */}
            {!closing && <RequiredMark />}
          </p>
          <div className="card overflow-hidden">
            <FieldRow icon={<span className="w-[18px] text-center text-ink-soft text-sm shrink-0">₱</span>}>
              <input
                className={`${rowInputClass} font-mono [font-variant-numeric:tabular-nums]`}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={magnitude}
                onChange={(e) => {
                  setTouched(true)
                  setMagnitude(e.target.value)
                }}
              />
              <div className="flex border border-hairline rounded-sm overflow-hidden shrink-0">
                {(["gain", "loss"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      setTouched(true)
                      setDirection(d)
                    }}
                    className={`px-3 py-1.5 text-xs font-semibold transition-colors ${d === "loss" ? "border-l border-hairline" : ""} ${
                      direction === d ? (d === "gain" ? "bg-sage text-paper" : "bg-rust text-paper") : "text-ink-soft"
                    }`}
                  >
                    {d === "gain" ? "Gain" : "Loss"}
                  </button>
                ))}
              </div>
            </FieldRow>
            <div className="border-t border-hairline">
              <DateField value={date} onChange={setDate} placeholder="Date" bare required />
            </div>
            <div className="border-t border-hairline">
              <FieldRow icon={<NoteIcon />}>
                <input
                  className={rowInputClass}
                  placeholder="Notes (optional)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </FieldRow>
            </div>
          </div>
          {suggested !== null && (
            <p className="text-[11px] text-ink-soft mt-1.5 px-1">
              Undistributed as of this date: {suggested < 0 ? "-" : "+"}₱{fmt(Math.abs(suggested))}
              {touched && suggested !== 0 && (
                <button
                  type="button"
                  className="text-gold ml-1.5"
                  onClick={() => {
                    setDirection(suggested < 0 ? "loss" : "gain")
                    setMagnitude(String(Math.abs(suggested)))
                  }}
                >
                  Use this
                </button>
              )}
            </p>
          )}
        </div>

        {amountNum !== 0 && !Number.isNaN(amountNum) && (
          <div>
            <h3 className="text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-2 px-1">
              Each member&apos;s share
            </h3>
            {previewError && <p className="text-sm text-rust">{previewError}</p>}
            {!previewError && preview === null && (
              <p className="text-sm text-ink-soft py-6 text-center">Calculating shares…</p>
            )}
            {noRecipients && (
              <p className="text-sm text-rust">
                No member has a positive value in the fund on this date, so there&apos;s no one to split this across.
              </p>
            )}
            {preview && preview.length > 0 && (
              <div className="card">
                <div className="px-5">
                  {preview.map((s, i) => (
                    <div
                      key={s.member_id}
                      className={`py-2.5 flex justify-between items-center gap-3 ${
                        i !== preview.length - 1 ? "border-b border-dashed border-hairline" : ""
                      }`}
                    >
                      <p className="text-sm text-ink truncate min-w-0">{s.name}</p>
                      <div className="flex flex-col items-end shrink-0">
                        <p
                          className={`font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold ${
                            s.amount < 0 ? "text-rust" : "text-sage"
                          }`}
                        >
                          {s.amount < 0 ? "-" : "+"}₱{fmt(Math.abs(s.amount))}
                        </p>
                        <p className="text-[11px] text-ink-soft font-mono">{s.pctShare.toFixed(2)}%</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Sheet>
  )
}

/* -------------------------------- Reopen -------------------------------- */

export function ReopenInvestmentSheet({
  investmentId,
  onClose,
  onReopened
}: {
  investmentId: string
  onClose: () => void
  onReopened: () => void
}) {
  const [reopening, setReopening] = useState(false)
  const [error, setError] = useState("")

  async function reopen() {
    setReopening(true)
    setError("")

    // One atomic RPC deletes the closing distribution's allocations/
    // transactions and flips the investment back to open. It only touches
    // rows flagged is_closing_distribution, so earlier ad hoc distributions
    // stay as they are.
    const { data: orphanedReceipts, error: rpcError } = await supabase.rpc("reopen_investment", {
      p_investment_id: investmentId
    })

    if (rpcError) {
      setError(rpcError.message)
      setReopening(false)
      return
    }

    // Gain Allocation rows are system-generated and never carry a receipt
    // today, but clean up defensively in case that ever changes.
    if (orphanedReceipts && orphanedReceipts.length > 0) {
      await supabase.storage.from("Receipts").remove(orphanedReceipts)
    }

    setReopening(false)
    onReopened()
    onClose()
  }

  return (
    <Sheet
      title="Reopen Investment"
      onClose={onClose}
      footer={
        <div>
          {error && <p className="text-sm text-rust mb-2">{error}</p>}
          <button className={primaryButtonClass} onClick={reopen} disabled={reopening}>
            {reopening ? "Reopening..." : "Reopen Investment"}
          </button>
        </div>
      }
    >
      <Callout>
        Reopening sets this investment back to open and removes the final gain or loss distribution recorded when
        it was closed. Any earlier distributions stay as they are.
      </Callout>
    </Sheet>
  )
}
