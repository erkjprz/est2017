"use client"

// Small presentational pieces shared by NewTransactionSheet and
// EditTransactionSheet, which mirror each other's layout closely.
// Each keeps its own classification/type -> { arrow, tone } mapping,
// since the two key off different vocabularies (type keys vs
// classification strings) -- only the rendering is shared here.

import { useEffect, useMemo, useState } from "react"
import { getReceiptSignedUrl } from "@/lib/receiptUrl"

export function FlowBadge({
  arrow,
  tone,
  small
}: {
  arrow: string
  tone: "in" | "out" | "neutral"
  small?: boolean
}) {
  const toneClass =
    tone === "in" ? "text-sage bg-sage/10" : tone === "out" ? "text-rust bg-rust/10" : "text-gold bg-gold/10"

  return (
    <span
      className={`rounded-full flex items-center justify-center font-bold shrink-0 ${toneClass} ${
        small ? "w-5 h-5 text-[11px]" : "w-7 h-7 rounded text-sm"
      }`}
    >
      {arrow}
    </span>
  )
}

// Thousands-comma display for AmountHero -- a plain type="number" input
// can't show commas at all (browsers reject non-digit characters in its
// value), so this only formats the integer part for display; the decimal
// part is left exactly as typed, uncapped, so typing isn't fought mid-edit.
function formatAmountDisplay(raw: string): string {
  if (!raw) return ""
  const dotIndex = raw.indexOf(".")
  const intPart = dotIndex === -1 ? raw : raw.slice(0, dotIndex)
  const decPart = dotIndex === -1 ? "" : raw.slice(dotIndex)
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + decPart
}

// Reverses formatAmountDisplay on every keystroke so the value handed to
// onChange (and everywhere else that reads this same amount -- Number()
// parsing, validation) stays the same plain digit string it always was,
// commas never part of the contract.
function stripAmountFormatting(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, "")
  const firstDot = cleaned.indexOf(".")
  if (firstDot === -1) return cleaned
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "")
}

// Amount-first entry point -- the hero of the redesigned form. A real
// text input (not a display-only readout) so typing, pasting, and the
// mobile numeric keypad all work exactly like the old plain field did;
// only the styling makes it the first, biggest thing on the screen. Not
// type="number" -- that can't display comma-formatted digits at all, so
// this sanitizes input by hand instead of leaning on native number
// parsing/validation.
export function AmountHero({
  value,
  onChange,
  label,
  helper,
  error
}: {
  value: string
  onChange: (v: string) => void
  // Shown under the number once Submit has been tapped with it missing.
  error?: string
  // Both optional and only rendered when given -- the number itself is
  // already the biggest thing on screen, so a caller with no real label/
  // helper to add (see NewTransactionSheet) isn't stuck reserving a blank
  // line's worth of space for either.
  label?: string
  helper?: string
}) {
  return (
    <div className="text-center pt-2 pb-5">
      {label && <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2">{label}</p>}
      <div className="flex items-center justify-center gap-1.5">
        <span className="font-mono text-3xl font-bold text-ink-soft">₱</span>
        <input
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          value={formatAmountDisplay(value)}
          onChange={(e) => onChange(stripAmountFormatting(e.target.value))}
          className="text-size-intentional font-mono [font-variant-numeric:tabular-nums] text-4xl font-bold text-ink bg-transparent text-center w-full max-w-[220px] focus:outline-none placeholder:text-ink-soft/30"
        />
      </div>
      {error && <FieldError message={error} className="!text-sm mt-2" />}
      {helper && <p className="text-sm text-ink-soft mt-2.5 max-w-xs mx-auto">{helper}</p>}
    </div>
  )
}

// Collapsed by default -- just the current selection, one field-height
// row -- and expands in place into an overlay list on tap. A horizontal
// scrolling row (tried first) was easy to mistake for a plain swipe and
// have the tap on a partially-visible pill fire instead of continuing the
// scroll; a row that wraps onto more lines instead of scrolling fixed
// that but made the type picker the tallest thing on the form. A
// collapsed dropdown is the compact option: one row when closed, and the
// overlay list (not a wrapped block) doesn't push the rest of the form
// down while it's open. Each page still owns its own key/classification
// -> {arrow, tone} mapping (see file comment above); callers merge that
// in before passing options here.
export function TypeDropdown({
  options,
  value,
  onChange
}: {
  options: { key: string; label: string; adminOnly: boolean; arrow: string; tone: "in" | "out" | "neutral" }[]
  value: string
  onChange: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find((o) => o.key === value)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 border border-hairline bg-paper rounded-sm px-3.5 py-3"
      >
        <span className="flex items-center gap-2.5 min-w-0">
          {selected && <FlowBadge arrow={selected.arrow} tone={selected.tone} small />}
          <span className="text-sm font-semibold text-ink truncate">{selected?.label}</span>
        </span>
        <span
          className={`text-ink-soft text-xs shrink-0 motion-safe:transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1.5 w-full max-h-64 overflow-y-auto border border-hairline rounded-sm bg-paper shadow-lg">
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => {
                onChange(o.key)
                setOpen(false)
              }}
              className={`w-full flex items-center justify-between gap-3 px-3.5 py-3 text-sm text-left border-b border-hairline last:border-b-0 transition-colors ${
                o.key === value ? "bg-(--selected-bg) text-ink font-semibold" : "bg-paper text-ink-soft"
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <FlowBadge arrow={o.arrow} tone={o.tone} small />
                <span className="truncate">{o.label}</span>
              </span>
              {o.adminOnly && (
                <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-gold border border-gold/40 rounded-full px-2 py-0.5">
                  Admin
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Slim progress track for the Details -> Review sub-flow used by the
// entry types with the most conditional fields (Loan Request, Investment,
// and Edit's Loan Release). Everything else stays a single flowing view.
export function StepTrack({ step, labels }: { step: 1 | 2; labels: [string, string] }) {
  return (
    <div className="mb-5">
      <div className="flex gap-1.5">
        {[0, 1].map((i) => (
          <div key={i} className="flex-1 h-[3px] rounded-full bg-hairline overflow-hidden">
            <div
              className="h-full bg-gold transition-all duration-300 ease-out"
              style={{ width: i < step ? "100%" : "0%" }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-1.5">
        {labels.map((l, i) => (
          <span
            key={l}
            className={`text-[10px] uppercase tracking-wide font-mono ${
              i === step - 1 ? "text-gold" : "text-ink-soft"
            }`}
          >
            {l}
          </span>
        ))}
      </div>
    </div>
  )
}

// A single read-only line in the Review step's summary -- what the member
// or admin is about to submit, restated plainly before they commit to it.
export function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5 border-b border-hairline last:border-b-0">
      {/* Labels are short -- keep them on one line and let a long value
          (e.g. a loan request's payout details) do the wrapping. */}
      <span className="shrink-0 whitespace-nowrap text-sm text-ink-soft">{label}</span>
      <span className="text-sm font-semibold font-mono [font-variant-numeric:tabular-nums] text-ink text-right">
        {value}
      </span>
    </div>
  )
}

// Receipt/proof-of-payment uploader shared by New and Edit -- three
// mutually exclusive states: a newly-picked file's preview, Edit's
// existing receipt (with a Replace affordance), or the empty dropzone.
// The copy is written mobile-first ("Tap to upload a photo") since this
// is used almost entirely from a phone, where "drag a photo here" is
// meaningless -- drag-and-drop still works for anyone on a desktop
// browser, it's just no longer the wording that's advertised.
export function ReceiptField({
  receipt,
  receiptPreview,
  existingReceiptUrl,
  existingReceiptSignedUrl,
  dragActive,
  setDragActive,
  onFileChange,
  emptyLabel = "Tap to upload a photo",
  error
}: {
  receipt: File | null
  receiptPreview: string | null
  existingReceiptUrl?: string | null
  existingReceiptSignedUrl?: string | null
  dragActive: boolean
  setDragActive: (v: boolean) => void
  onFileChange: (file: File | null) => void
  emptyLabel?: string
  // Shown (with a red outline) once Submit has been tapped with no file.
  error?: string
}) {
  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragActive(false)
    const file = e.dataTransfer.files?.[0]
    if (file) onFileChange(file)
  }

  if (receiptPreview) {
    return (
      <div className="relative border border-hairline rounded-md p-3 flex items-center gap-3">
        <img
          src={receiptPreview}
          alt="Receipt preview"
          className="w-16 h-16 object-cover rounded-md border border-hairline"
        />
        <div className="min-w-0 flex-1">
          <p className="text-base text-ink truncate">{receipt?.name}</p>
          <p className="text-sm text-ink-soft">{receipt ? `${(receipt.size / 1024).toFixed(0)} KB` : ""}</p>
        </div>
        <button
          type="button"
          onClick={() => onFileChange(null)}
          className="text-sm text-rust border border-rust rounded-full px-2.5 py-1 shrink-0"
        >
          Remove
        </button>
      </div>
    )
  }

  if (existingReceiptUrl && existingReceiptSignedUrl) {
    return (
      <div className="relative border border-hairline rounded-md p-3 flex items-center gap-3">
        <img
          src={existingReceiptSignedUrl}
          alt="Current receipt"
          className="w-16 h-16 object-cover rounded-md border border-hairline"
        />
        <div className="min-w-0 flex-1">
          <p className="text-base text-ink">Current receipt</p>
          <p className="text-sm text-ink-soft">Tap Replace to upload a different photo</p>
        </div>
        <label className="shrink-0 text-sm font-semibold text-gold border border-gold/40 rounded-full px-3 py-1.5 cursor-pointer">
          Replace
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>
    )
  }

  return (
    <>
      <label
        onDragOver={(e) => {
          e.preventDefault()
          setDragActive(true)
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={`flex items-center justify-center gap-2 border rounded-sm px-3 py-3 cursor-pointer text-center transition-colors ${
          dragActive ? "border-dashed border-gold bg-gold/5" : error ? "border-rust" : "border-dashed border-hairline"
        }`}
      >
        <span className="text-base shrink-0">📎</span>
        <span className="text-sm text-ink-soft">{emptyLabel}</span>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
        />
      </label>
      {error && <FieldError message={error} className="px-1 mt-1.5" />}
    </>
  )
}

// Proof-of-transfer uploader for one or more files: already-saved receipts
// (Edit) first, then newly-picked ones, each removable on its own, with an
// "Add another photo" dropzone underneath. Picking several at once works
// too. Used everywhere a receipt is attached; ReceiptField above stays for
// the single-file payout QR.
export function ReceiptsField({
  files,
  onAddFiles,
  onRemoveFile,
  existingPaths = [],
  onRemoveExisting,
  accept = "image/*",
  emptyLabel = "Tap to upload photos",
  emptyHint = "You can add more than one",
  addLabel = "Add another photo",
  error
}: {
  files: File[]
  onAddFiles: (files: File[]) => void
  onRemoveFile: (index: number) => void
  existingPaths?: string[]
  onRemoveExisting?: (path: string) => void
  accept?: string
  emptyLabel?: string
  // Second line under emptyLabel, so it's clear several files are fine.
  emptyHint?: string
  addLabel?: string
  // Shown (with a red outline) once Submit has been tapped with no file.
  error?: string
}) {
  const [dragActive, setDragActive] = useState(false)
  const previews = useMemo(
    () => files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null)),
    [files]
  )
  useEffect(
    () => () => {
      for (const p of previews) if (p) URL.revokeObjectURL(p)
    },
    [previews]
  )

  function pick(list: FileList | null | undefined) {
    const picked = Array.from(list ?? [])
    if (picked.length > 0) onAddFiles(picked)
  }

  const hasAny = existingPaths.length + files.length > 0

  return (
    <div className="space-y-2">
      {existingPaths.map((path) => (
        <div key={path} className="border border-hairline rounded-md p-3 flex items-center gap-3">
          <SavedReceiptPreview path={path} />
          <div className="min-w-0 flex-1">
            <p className="text-base text-ink">Current receipt</p>
            <p className="text-sm text-ink-soft">Already attached</p>
          </div>
          {onRemoveExisting && (
            <button
              type="button"
              onClick={() => onRemoveExisting(path)}
              className="text-sm text-rust border border-rust rounded-full px-2.5 py-1 shrink-0"
            >
              Remove
            </button>
          )}
        </div>
      ))}

      {files.map((file, i) => (
        <div key={`${file.name}-${file.lastModified}-${i}`} className="border border-hairline rounded-md p-3 flex items-center gap-3">
          {previews[i] ? (
            <img src={previews[i]!} alt="Receipt preview" className="w-16 h-16 object-cover rounded-md border border-hairline shrink-0" />
          ) : (
            <span className="w-16 h-16 rounded-md border border-hairline bg-paper flex items-center justify-center text-2xl shrink-0">
              📄
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-base text-ink truncate">{file.name}</p>
            <p className="text-sm text-ink-soft">{(file.size / 1024).toFixed(0)} KB</p>
          </div>
          <button
            type="button"
            onClick={() => onRemoveFile(i)}
            className="text-sm text-rust border border-rust rounded-full px-2.5 py-1 shrink-0"
          >
            Remove
          </button>
        </div>
      ))}

      <label
        onDragOver={(e) => {
          e.preventDefault()
          setDragActive(true)
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragActive(false)
          pick(e.dataTransfer.files)
        }}
        className={`flex items-center justify-center gap-2 border rounded-sm px-3 py-3 cursor-pointer text-center transition-colors ${
          dragActive ? "border-dashed border-gold bg-gold/5" : error ? "border-rust" : "border-dashed border-hairline"
        }`}
      >
        <span className="text-base shrink-0">{hasAny ? "＋" : "📎"}</span>
        {hasAny ? (
          <span className="text-sm text-ink-soft">{addLabel}</span>
        ) : (
          <span className="text-left">
            <span className="block text-sm text-ink-soft">{emptyLabel}</span>
            <span className="block text-[11px] text-ink-soft/70">{emptyHint}</span>
          </span>
        )}
        <input
          type="file"
          accept={accept}
          multiple
          className="hidden"
          onChange={(e) => {
            pick(e.target.files)
            // Reset so picking the same file again still fires onChange.
            e.target.value = ""
          }}
        />
      </label>
      {error && <FieldError message={error} className="px-1 mt-1.5" />}
    </div>
  )
}

function SavedReceiptPreview({ path }: { path: string }) {
  const isPdf = path.toLowerCase().endsWith(".pdf")
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (isPdf) return
    let cancelled = false
    getReceiptSignedUrl(path).then((signed) => {
      if (!cancelled) setUrl(signed)
    })
    return () => {
      cancelled = true
    }
  }, [path, isPdf])

  if (isPdf || !url) {
    return (
      <span
        className={`w-16 h-16 rounded-md border border-hairline bg-paper flex items-center justify-center text-2xl shrink-0 ${
          isPdf ? "" : "animate-pulse"
        }`}
      >
        {isPdf ? "📄" : ""}
      </span>
    )
  }
  return <img src={url} alt="Current receipt" className="w-16 h-16 object-cover rounded-md border border-hairline shrink-0" />
}

// Groups a set of related fields into their own bordered card with a
// small uppercase title -- e.g. "Details", "Proof" -- instead of every
// field on the form living in one continuous card. Matches the card-per-
// concern convention already used elsewhere (Admin's pending lists,
// Breakdown's panels) rather than a single long enclosing box.
export function FieldGroup({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      {label && <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-4">{label}</p>}
      {children}
    </div>
  )
}

// Required fields aren't marked up front -- nearly every field is required,
// so only the optional ones say so ("Additional notes (optional)"). Instead,
// tapping Submit with something missing highlights every missing field at
// once: a red edge on its row (invalidRowClass) and a short message under
// it (FieldError). Both clear on their own as soon as the field is filled.
export const invalidRowClass = "shadow-[inset_3px_0_0_var(--color-rust)]"

export function FieldError({ message, className = "" }: { message: string; className?: string }) {
  return (
    <span role="alert" className={`block text-[12px] text-rust ${className}`}>
      {message}
    </span>
  )
}

// Plain metadata icons for the compact FieldRow layout below -- matching
// how budget-tracker's own TransactionModal treats its Note/Date/
// Recurrence rows: a bare muted icon inline, no colored circle (that's
// reserved for TypeDropdown/FlowBadge's flow-tone badge, the one row with
// real per-value styling to show). Shared by New and Edit's Details/Loan
// Terms cards, which use the same row shape for the same fields.
function RowIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-5 h-5 text-ink-soft flex-shrink-0">
      {children}
    </svg>
  )
}

export function BankIcon() {
  return (
    <RowIcon>
      <path d="M3 10l9-6 9 6M4 10v9M20 10v9M8 10v9M16 10v9M2 21h20" strokeLinecap="round" strokeLinejoin="round" />
    </RowIcon>
  )
}

export function NoteIcon() {
  return (
    <RowIcon>
      <path d="M6 3h9l5 5v13a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 12h6M9 16h6" strokeLinecap="round" />
    </RowIcon>
  )
}

export function MailIcon() {
  return (
    <RowIcon>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" strokeLinecap="round" strokeLinejoin="round" />
    </RowIcon>
  )
}

export function PersonIcon() {
  return (
    <RowIcon>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20c1.5-4 4.5-6 7.5-6s6 2 7.5 6" strokeLinecap="round" strokeLinejoin="round" />
    </RowIcon>
  )
}

// A growth/trend icon rather than a literal "%" glyph -- the interest row
// already has its own % / ₱ toggle right in it, and a percent-shaped icon
// right next to a percent-labeled button read as two competing %s instead
// of an icon plus a control.
export function InterestIcon() {
  return (
    <RowIcon>
      <path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 7h6v6" strokeLinecap="round" strokeLinejoin="round" />
    </RowIcon>
  )
}

// Generic status/flag icon -- used where a row lets you change a
// transaction's lifecycle state directly (Support's Fix Transaction), not
// just view it via a badge.
export function StatusIcon() {
  return (
    <RowIcon>
      <path d="M5 21V4a1 1 0 011-1h10.5L15 6.5 16.5 10H6" strokeLinecap="round" strokeLinejoin="round" />
    </RowIcon>
  )
}

export function ClockIcon() {
  return (
    <RowIcon>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3.5 2" strokeLinecap="round" strokeLinejoin="round" />
    </RowIcon>
  )
}

export function CalendarIcon() {
  return (
    <RowIcon>
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3.5 10h17" strokeLinecap="round" />
    </RowIcon>
  )
}

// Same shape as Dashboard's "Repay Loan" shortcut icon.
export function RepeatIcon() {
  return (
    <RowIcon>
      <path d="M4 12a8 8 0 0113.66-5.66M20 12a8 8 0 01-13.66 5.66" strokeLinecap="round" />
      <path d="M17.5 3.5v3h-3M6.5 20.5v-3h3" strokeLinecap="round" strokeLinejoin="round" />
    </RowIcon>
  )
}

// One row of a compact Details/Loan Terms card -- icon + inline content,
// divided from its siblings by the card's own divide-y rather than its own
// border.
export function FieldRow({ icon, children, error }: { icon: React.ReactNode; children: React.ReactNode; error?: string }) {
  if (!error) {
    return (
      <div className="flex items-center gap-3 px-4 py-3.5">
        {icon}
        {children}
      </div>
    )
  }
  return (
    <div className={`flex items-center gap-3 px-4 py-3.5 ${invalidRowClass}`}>
      {icon}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3">{children}</div>
        <FieldError message={error} className="mt-1" />
      </div>
    </div>
  )
}

export const rowSelectClass = "flex-1 min-w-0 bg-transparent text-sm text-ink outline-none"
export const rowInputClass = "flex-1 min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-soft"

function formatFull(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric"
  })
}

// Transparent native date input layered over a styled div -- the native
// input still handles the actual tap-to-open-picker interaction (including
// iOS's wheel picker) and stays reachable everywhere in the box, but the
// visible text is entirely ours: a real calendar icon, a formatted date
// once one's picked, and an actual visible placeholder when empty. A bare
// `<input type="date">` styled directly (border/padding classes like every
// other field) looks fine on desktop but renders taller than its siblings
// on iOS Safari -- the native date control there ignores the same padding
// a text input respects, so the box grows to fit its own UA chrome instead
// of the one we asked for. Layering it under a div we fully control sidesteps
// that entirely instead of fighting WebKit's internal layout for it.
export function DateField({
  value,
  onChange,
  placeholder,
  bare,
  error
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  error?: string
  // Icon-row layout (e.g. NewTransactionSheet's Details card) -- no border/
  // background of its own, sized by its own row padding instead of a fixed
  // height, and matches the plain text weight of its row siblings instead
  // of standing out with font-mono/a gold border once a date's picked.
  bare?: boolean
}) {
  return (
    <div className={`relative ${bare ? "" : "h-11"}`}>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer [color-scheme:dark]"
      />
      <div
        className={
          bare
            ? `pointer-events-none flex items-center gap-3 px-4 py-3.5 text-sm text-ink ${error ? invalidRowClass : ""}`
            : `pointer-events-none h-full flex items-center gap-2 border rounded-md px-3 text-sm font-mono ${
                value ? "border-gold text-ink" : "border-hairline text-ink-soft"
              }`
        }
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          className={bare ? "w-5 h-5 shrink-0 text-ink-soft" : "w-[15px] h-[15px] shrink-0 text-ink-soft"}
        >
          <rect x="3.5" y="5" width="17" height="16" rx="2" />
          <path d="M8 3v4M16 3v4M3.5 10h17" strokeLinecap="round" />
        </svg>
        <div className="flex-1 min-w-0">
          <span className="block truncate">{value ? formatFull(value) : placeholder}</span>
          {error && <FieldError message={error} className="mt-1" />}
        </div>
      </div>
    </div>
  )
}
