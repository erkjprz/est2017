"use client"

import { Sheet } from "@/app/components/Sheet"

type Tone = "in" | "out" | "neutral"
type TypeOption = { key: string; label: string; arrow: string; tone: Tone; adminOnly: boolean }

// Bold solid-fill badge, local to the type picker and its trigger row --
// distinct from the shared FlowBadge (a faint /10 tint tuned for the dense
// transactions list) because a picker sheet is a much emptier canvas and
// needs real color to not read as dead against the near-black dark theme.
export function TypeBadge({ arrow, tone, selected }: { arrow: string; tone: Tone; selected?: boolean }) {
  const toneClass = tone === "in" ? "bg-sage" : tone === "out" ? "bg-rust" : "bg-gold"
  return (
    <span
      className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm text-paper shrink-0 ${toneClass} ${
        selected ? "ring-2 ring-offset-2 ring-offset-paper-2 ring-ink/30" : ""
      }`}
    >
      {arrow}
    </span>
  )
}

// Same picker-sheet pattern as LoanPickerSheet, for the same reason
// budget-tracker opens one for Category rather than an inline dropdown --
// this is the row people tap first and most often, so it earns a real
// picker instead of a cramped expanding list.
export function TypePickerSheet({
  options,
  value,
  onSelect,
  onClose
}: {
  options: TypeOption[]
  value?: string
  onSelect: (key: string) => void
  onClose: () => void
}) {
  function renderList(items: TypeOption[]) {
    return (
      <div className="card divide-y divide-hairline overflow-hidden">
        {items.map((o) => (
          <button
            key={o.key}
            data-tour={`type-${o.key}`}
            onClick={() => onSelect(o.key)}
            className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors ${
              o.key === value ? "bg-(--selected-bg)" : ""
            }`}
          >
            <TypeBadge arrow={o.arrow} tone={o.tone} selected={o.key === value} />
            <span className="flex-1 text-sm font-semibold text-ink">{o.label}</span>
          </button>
        ))}
      </div>
    )
  }

  const memberOptions = options.filter((o) => !o.adminOnly)
  const adminOptions = options.filter((o) => o.adminOnly)
  // A section header only earns its keep when there's a second section to
  // separate it from -- a member never sees the admin-only group at all
  // (filtered out before this even renders), so their list stays a plain
  // flat list exactly as before instead of a lone, pointless "Member"
  // header over the only group present.
  const grouped = memberOptions.length > 0 && adminOptions.length > 0

  return (
    <Sheet title="Transaction type" onClose={onClose}>
      {grouped ? (
        <div className="space-y-5">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">Member</p>
            {renderList(memberOptions)}
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">Admin</p>
            {renderList(adminOptions)}
          </div>
        </div>
      ) : (
        renderList(options)
      )}
    </Sheet>
  )
}
