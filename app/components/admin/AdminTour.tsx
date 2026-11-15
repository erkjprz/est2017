"use client"

import { useCallback, useEffect, useLayoutEffect, useState } from "react"
import { Portal } from "@/app/components/Portal"

// Guided tour of /admin for a new admin: dims the page, spotlights the real
// control, and puts a one- or two-line caption next to it. Targets are
// marked with data-tour="..." on the page (and on Navbar's dock buttons as
// data-tour="nav-<label>"). Each step lists targets in order of preference;
// a step whose targets aren't on screen (e.g. an empty queue) falls back to
// the next one, or is skipped.
type Step = { targets?: string[]; title: string; text: string }

const STEPS: Step[] = [
  {
    title: "Welcome, admin",
    text: "A quick look at what you'll do. Nothing members submit counts until an admin approves it."
  },
  {
    targets: ["queue-count"],
    title: "Your to-do list",
    text: "Check it daily. Aim for “All caught up”."
  },
  {
    targets: ["queue-item", "queue-count"],
    title: "Review before approving",
    text: "Match it with the bank app first. Red labels mean check twice. Rejecting? Say why."
  },
  { targets: ["members"], title: "Members", text: "Add, edit, or deactivate people." },
  { targets: ["lending"], title: "Lending limits", text: "Every loan is checked against these." },
  { targets: ["messages"], title: "Member questions", text: "Reply within a day or two." },
  { targets: ["export"], title: "Backup", text: "Download the full ledger once a month." },
  {
    targets: ["nav-breakdown"],
    title: "Bank interest",
    text: "Monthly: + New → Bank Interest. Every January: Breakdown → Banks → Review & distribute last year's."
  },
  { targets: ["search-fix"], title: "Fix a mistake", text: "Find and correct any entry, then tell the member." },
  { title: "You're all set", text: "Replay this tour any time from Help → Admin." }
]

const PAD = 6
const GAP = 12
const MARGIN = 16

function findTarget(step: Step): HTMLElement | null {
  for (const t of step.targets ?? []) {
    const el = document.querySelector<HTMLElement>(`[data-tour="${t}"]`)
    if (el && el.getClientRects().length > 0) return el
  }
  return null
}

// Next step index in `dir` that has something to point at (or needs nothing).
function nextShowable(from: number, dir: 1 | -1): number {
  for (let i = from; i >= 0 && i < STEPS.length; i += dir) {
    if (!STEPS[i].targets || findTarget(STEPS[i])) return i
  }
  return -1
}

type Spot = { top: number; left: number; width: number; height: number; radius: number }

export function AdminTour({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0)
  const [spot, setSpot] = useState<Spot | null>(null)
  const [viewport, setViewport] = useState({ w: 0, h: 0 })
  const step = STEPS[index]

  const measure = useCallback(() => {
    setViewport({ w: window.innerWidth, h: window.innerHeight })
    const el = findTarget(STEPS[index])
    if (!el) {
      setSpot(null)
      return
    }
    const r = el.getBoundingClientRect()
    const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 8
    setSpot({
      top: r.top - PAD,
      left: r.left - PAD,
      width: r.width + PAD * 2,
      height: r.height + PAD * 2,
      radius: radius >= r.height / 2 ? 9999 : radius + PAD
    })
  }, [index])

  useLayoutEffect(() => {
    findTarget(STEPS[index])?.scrollIntoView({ block: "center", behavior: "smooth" })
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the spotlight's position is read from the DOM after each step renders
    measure()
  }, [index, measure])

  useEffect(() => {
    window.addEventListener("resize", measure)
    window.addEventListener("scroll", measure, true)
    return () => {
      window.removeEventListener("resize", measure)
      window.removeEventListener("scroll", measure, true)
    }
  }, [measure])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const prev = nextShowable(index - 1, -1)
  const next = nextShowable(index + 1, 1)
  const isLast = next === -1
  // Counted over the steps this queue can actually show.
  const shown = STEPS.map((_, i) => i).filter((i) => !STEPS[i].targets || (typeof document !== "undefined" && findTarget(STEPS[i])))
  const position = shown.indexOf(index) + 1

  // Caption goes below the spotlight when it's in the top half, above it
  // otherwise; centred when there's nothing to point at.
  const cardWidth = Math.min(320, viewport.w - MARGIN * 2)
  let cardStyle: React.CSSProperties
  if (spot && viewport.w) {
    const centre = spot.left + spot.width / 2
    const left = Math.min(Math.max(centre - cardWidth / 2, MARGIN), viewport.w - cardWidth - MARGIN)
    cardStyle =
      spot.top + spot.height / 2 < viewport.h / 2
        ? { left, top: spot.top + spot.height + GAP, width: cardWidth }
        : { left, bottom: viewport.h - spot.top + GAP, width: cardWidth }
  } else {
    cardStyle = { left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: cardWidth || 320 }
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[60] font-sans" role="dialog" aria-modal="true" aria-label="Admin tour">
        {/* Swallows taps on the page underneath while the tour is open. */}
        <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

        {spot ? (
          <div
            className="absolute pointer-events-none ring-2 ring-gold motion-safe:transition-all motion-safe:duration-300"
            style={{
              top: spot.top,
              left: spot.left,
              width: spot.width,
              height: spot.height,
              borderRadius: spot.radius,
              boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.6)"
            }}
          />
        ) : (
          <div className="absolute inset-0 bg-black/60 pointer-events-none" />
        )}

        <div
          className="absolute bg-paper text-ink border border-hairline rounded-2xl shadow-xl p-4 motion-safe:transition-all motion-safe:duration-300"
          style={cardStyle}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="font-display font-semibold text-base leading-snug">{step.title}</p>
            <span className="shrink-0 text-[11px] font-mono text-ink-soft mt-0.5">
              {position}/{shown.length}
            </span>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">{step.text}</p>
          <div className="mt-3 flex items-center gap-2">
            {!isLast && (
              <button type="button" onClick={onClose} className="text-xs text-ink-soft px-1 py-2 mr-auto">
                Skip tour
              </button>
            )}
            {isLast && <span className="mr-auto" />}
            {prev !== -1 && (
              <button
                type="button"
                onClick={() => setIndex(prev)}
                className="border border-hairline text-ink-soft px-4 py-2 rounded-full text-sm font-semibold"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={() => (isLast ? onClose() : setIndex(next))}
              className="bg-ink text-paper px-5 py-2 rounded-full text-sm font-bold"
            >
              {isLast ? "Done" : index === 0 ? "Start" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  )
}
