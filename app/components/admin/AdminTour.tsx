"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import { useRouter } from "next/navigation"
import { Portal } from "@/app/components/Portal"
import { useAuth } from "@/app/auth-context"
import { ADMIN_TOUR_CHANGE_EVENT, getAdminTourStep, setAdminTourStep } from "@/lib/adminTour"

// Guided tour for a new admin. It walks across the pages an admin works in,
// dims each one, spotlights the real control, and puts a short caption next
// to it. Where the real list is empty (nothing waiting for approval, no
// interest to distribute, no loan needing action), the page itself shows
// an example item while the tour runs -- see TourExamples.tsx.
//
// Mounted once in the root layout; the current step lives in
// sessionStorage (lib/adminTour.ts) so it survives each page change.
// Targets are data-tour="..." attributes on those pages. Each step lists
// them in order of preference; if none shows up the caption is centred.

type Step = {
  id: string
  path: string
  targets?: string[]
  title: string
  text: string
}

// Written as "when this happens, here's what you do" rather than rules.
const STEPS: Step[] = [
  {
    id: "welcome",
    path: "/admin",
    title: "Welcome, admin",
    text: "Here's how things flow once you're an admin. What members send in only counts once an admin approves it."
  },
  {
    id: "queue",
    path: "/admin",
    targets: ["queue-count"],
    title: "Your approval queue",
    text: "When a member sends something in or someone signs up, it lands here and you get a notification."
  },
  {
    id: "review",
    path: "/admin",
    targets: ["queue-item", "queue-count"],
    title: "When something comes in",
    text: "Tap it and match it with the bank app. If it checks out, approve it. Red labels mean look twice. If something's off, reject it with a reason so the member can fix it."
  },
  {
    id: "signup",
    path: "/admin",
    targets: ["queue-signup", "queue-count"],
    title: "When someone signs up",
    text: "They show up under New signups. Once you know who they are, approve them."
  },
  {
    id: "fix",
    path: "/admin",
    targets: ["search-fix"],
    title: "When something was recorded wrong",
    text: "Find it here, correct it, and let the member know what changed."
  },
  {
    id: "export",
    path: "/admin",
    targets: ["export"],
    title: "At the end of each month",
    text: "Download the full ledger here to keep a backup."
  },
  {
    id: "members",
    path: "/admin/members",
    targets: ["members-add"],
    title: "When someone joins or leaves",
    text: "Add them here. To edit or deactivate someone, tap their name in the list."
  },
  {
    id: "lending",
    path: "/admin/lending",
    targets: ["lending-limits"],
    title: "When a loan is requested",
    text: "It's checked against these limits before you release it. They only change when the admins agree."
  },
  {
    id: "messages",
    path: "/messages",
    targets: ["messages-list", "messages-title"],
    title: "When a member asks a question",
    text: "You get a notification and the question shows up here. Reply right in the thread."
  },
  {
    id: "interest-monthly",
    path: "/dashboard",
    targets: ["new-fab"],
    title: "When a bank credits interest",
    text: "Record it here with + → Bank Interest, and attach the bank statement."
  },
  {
    id: "interest-yearly",
    path: "/fund-breakdown?tab=banks",
    targets: ["bank-interest-due", "bank-total"],
    title: "At year end",
    text: "All bank interest is distributed at year end. Once December's interest is in, the year's total shows up here. Open each bank and tap Review & distribute."
  },
  {
    id: "loans",
    path: "/fund-breakdown?tab=loans",
    targets: ["loans-attention", "loans-total"],
    title: "When a loan is overdue or paid off",
    text: "It shows up here. Follow up with the borrower if it's overdue. If it's paid off, close it so the gain is shared."
  },
  {
    id: "done",
    path: "/admin",
    title: "You're all set",
    text: "You can replay this tour any time from Help → Admin."
  }
]

const PAD = 6
const GAP = 12
const MARGIN = 16
// How long to wait for a page to load its target before showing the
// caption centred in the meantime.
const TARGET_TIMEOUT_MS = 4000

function onStepPage(step: Step) {
  const [pathname, query] = step.path.split("?")
  if (window.location.pathname !== pathname) return false
  if (!query) return true
  const want = new URLSearchParams(query)
  const have = new URLSearchParams(window.location.search)
  return [...want.entries()].every(([k, v]) => have.get(k) === v)
}

function findTarget(step: Step): HTMLElement | null {
  for (const t of step.targets ?? []) {
    const el = document.querySelector<HTMLElement>(`[data-tour="${t}"]`)
    if (el && el.getClientRects().length > 0) return el
  }
  return null
}

type Spot = { top: number; left: number; width: number; height: number; radius: number }

// The id of the step the tour is on, or null when it isn't running -- for
// pages that show example items only on some steps (see TourExamples).
export function useAdminTourStepId(): string | null {
  const [index, setIndex] = useState<number | null>(null)
  useEffect(() => {
    const update = () => setIndex(getAdminTourStep())
    update()
    window.addEventListener(ADMIN_TOUR_CHANGE_EVENT, update)
    return () => window.removeEventListener(ADMIN_TOUR_CHANGE_EVENT, update)
  }, [])
  return index === null ? null : STEPS[index]?.id ?? null
}

export function AdminTourHost() {
  const { member } = useAuth()
  const isAdmin = member?.role === "admin"
  const [index, setIndex] = useState<number | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- picks up a tour already under way (sessionStorage is only readable after hydration)
    setIndex(getAdminTourStep())
    const onChange = () => setIndex(getAdminTourStep())
    window.addEventListener(ADMIN_TOUR_CHANGE_EVENT, onChange)
    return () => window.removeEventListener(ADMIN_TOUR_CHANGE_EVENT, onChange)
  }, [])

  // setAdminTourStep fires the change event, which updates index above.
  const go = useCallback((next: number | null) => setAdminTourStep(next), [])

  if (!isAdmin || index === null || !STEPS[index]) return null
  return <TourOverlay key={index} index={index} go={go} />
}

function TourOverlay({ index, go }: { index: number; go: (next: number | null) => void }) {
  const router = useRouter()
  const step = STEPS[index]
  const isLast = index === STEPS.length - 1
  const [ready, setReady] = useState(false)
  const [spot, setSpot] = useState<Spot | null>(null)
  const [viewport, setViewport] = useState({ w: 0, h: 0 })
  const target = useRef<HTMLElement | null>(null)

  const measure = useCallback(() => {
    setViewport({ w: window.innerWidth, h: window.innerHeight })
    const el = target.current
    if (!el || !el.isConnected) {
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
  }, [])

  // Go to the step's page if needed, then wait for its target to render.
  useEffect(() => {
    let pushed = false
    const started = Date.now()
    const timer = window.setInterval(() => {
      if (!onStepPage(step)) {
        if (!pushed) {
          pushed = true
          router.push(step.path)
        }
        return
      }
      const el = findTarget(step)
      if (el || !step.targets) {
        window.clearInterval(timer)
        target.current = el
        el?.scrollIntoView({ block: "center", behavior: "smooth" })
        measure()
        setReady(true)
        return
      }
      // A slow page: show the caption centred meanwhile, and keep watching
      // so the spotlight still moves onto the target once it renders.
      if (Date.now() - started > TARGET_TIMEOUT_MS) {
        measure()
        setReady(true)
      }
    }, 150)
    return () => window.clearInterval(timer)
  }, [step, router, measure])

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
      if (e.key === "Escape") go(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [go])

  // Keep the spotlight on the target while the page settles (smooth
  // scroll, images and late data shifting things around).
  useLayoutEffect(() => {
    if (!ready || !target.current) return
    const observer = new ResizeObserver(measure)
    observer.observe(target.current)
    observer.observe(document.body)
    return () => observer.disconnect()
  }, [ready, measure])

  // The caption goes on whichever side of the spotlight has more room, and
  // scrolls inside itself if even that isn't enough. Centred when there's
  // nothing to point at.
  const cardWidth = Math.min(340, viewport.w - MARGIN * 2)
  let cardStyle: CSSProperties
  if (spot && viewport.w) {
    const centre = spot.left + spot.width / 2
    const left = Math.min(Math.max(centre - cardWidth / 2, MARGIN), viewport.w - cardWidth - MARGIN)
    const roomBelow = viewport.h - (spot.top + spot.height) - GAP - MARGIN
    const roomAbove = spot.top - GAP - MARGIN
    cardStyle =
      roomBelow >= roomAbove
        ? { left, top: spot.top + spot.height + GAP, width: cardWidth, maxHeight: Math.max(roomBelow, 160) }
        : { left, bottom: viewport.h - spot.top + GAP, width: cardWidth, maxHeight: Math.max(roomAbove, 160) }
  } else {
    cardStyle = {
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      width: cardWidth || 340,
      maxHeight: viewport.h ? viewport.h - MARGIN * 2 : undefined
    }
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[60] font-sans" role="dialog" aria-modal="true" aria-label="Admin tour">
        {/* Swallows taps on the page underneath while the tour is open. */}
        <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

        {ready && spot ? (
          <div
            className="absolute pointer-events-none ring-2 ring-gold motion-safe:transition-all motion-safe:duration-300"
            style={{
              top: spot.top,
              left: spot.left,
              width: spot.width,
              height: spot.height,
              borderRadius: spot.radius,
              boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.45)"
            }}
          />
        ) : (
          <div className="absolute inset-0 bg-black/45 pointer-events-none" />
        )}

        {ready && (
          <div
            className="absolute overflow-y-auto overscroll-contain bg-paper text-ink border border-hairline rounded-2xl shadow-xl p-4"
            style={cardStyle}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="font-display font-semibold text-base leading-snug">{step.title}</p>
              <span className="shrink-0 text-[11px] font-mono text-ink-soft mt-0.5">
                {index + 1}/{STEPS.length}
              </span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-ink-soft">{step.text}</p>

            <div className="mt-3 flex items-center gap-2">
              {isLast ? (
                <span className="mr-auto" />
              ) : (
                <button type="button" onClick={() => go(null)} className="text-xs text-ink-soft px-1 py-2 mr-auto">
                  Skip tour
                </button>
              )}
              {index > 0 && (
                <button
                  type="button"
                  onClick={() => go(index - 1)}
                  className="border border-hairline text-ink-soft px-4 py-2 rounded-full text-sm font-semibold"
                >
                  Back
                </button>
              )}
              <button
                type="button"
                onClick={() => go(isLast ? null : index + 1)}
                className="bg-ink text-paper px-5 py-2 rounded-full text-sm font-bold"
              >
                {isLast ? "Done" : index === 0 ? "Start" : "Next"}
              </button>
            </div>
          </div>
        )}
      </div>
    </Portal>
  )
}
