"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import { useRouter } from "next/navigation"
import { Portal } from "@/app/components/Portal"
import { useAuth } from "@/app/auth-context"
import { ADMIN_TOUR_CHANGE_EVENT, getAdminTourPhase, getAdminTourStep, setAdminTourPhase, setAdminTourStep } from "@/lib/adminTour"

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

// A tap the tour asks for before a step, so the admin sees how they'd get
// there: it spotlights `target` (on `path`, if given) with a pointing hand
// and waits -- as long as they like -- for them to tap it (or the caption's
// button). Then it clicks it for real: an icon opening its page, + opening
// the entry sheet, a tab switching. Only asked when moving forward.
// `optional`: the target may well not be there (an example card that only
// shows when the real queue is empty) -- don't wait long for it.
type Via = { path?: string; target: string; title: string; hint: string; optional?: boolean }

type Step = {
  id: string
  path: string
  targets?: string[]
  via?: Via[]
  title: string
  text: string
  // Starts a topic in the caption's "Go to" list.
  topic?: string
  // The in-app notification this step leads to, and who gets it -- taken
  // from the database's notification triggers and the loan-payment-
  // reminders job, so keep it in step with them.
  notify?: string
}

// Written as "when this happens, here's what you do" rather than rules.
const STEPS: Step[] = [
  {
    id: "welcome",
    path: "/admin",
    title: "Welcome, admin",
    text: "Here's how things flow once you're an admin. Note that your approval moves the money. Tap Topics any time to jump to a subject.",
    topic: "Welcome"
  },
  {
    id: "queue",
    path: "/admin",
    targets: ["queue-count"],
    title: "Your approval queue",
    text: "When a member sends something in or someone signs up, it lands here and you get an app notification.",
    notify: "You get “Pending Approval” when a member sends something in, and “New Signup” when someone signs up."
  },
  {
    id: "review-in",
    path: "/admin",
    targets: ["queue-confirmed", "queue-decision", "queue-count"],
    title: "When something comes in",
    text: "Tap it and match it with the bank app. If it checks out, approve it. Red labels mean look twice.",
    topic: "Approving money in"
  },
  {
    id: "form-contribution",
    path: "/admin",
    targets: ["review-form"],
    via: [{ path: "/admin", target: "example-contribution", title: "Tap Maria's contribution", hint: "Every item opens a form to check before you approve.", optional: true }],
    title: "Contribution",
    text: "Check the amount, date and bank against the bank app and the member's receipt below. No receipt? Ask for one first. Above Approve you'll see the bank's balance after.",
    notify: "When you approve, the member gets “Contribution Approved”. If you reject, they get “Contribution Not Approved” with your reason."
  },
  {
    id: "form-loan-payment",
    path: "/admin",
    targets: ["review-form"],
    via: [{ path: "/admin", target: "example-loan-payment", title: "Tap Ana's loan payment", hint: "Every item opens a form to check before you approve.", optional: true }],
    title: "Loan payment",
    text: "The line at the top shows what's left on the loan. Check the amount landed in the bank shown and matches the member's receipt, then approve. It comes off what's owed.",
    notify: "The member gets “Loan Payment Approved”, and payment reminders for that due date stop."
  },
  {
    id: "review-out",
    path: "/admin",
    targets: ["queue-decision", "queue-confirmed", "queue-count"],
    title: "When money goes out",
    text: "Withdrawals, loan releases and investment returns are reviewed one at a time: pick the bank the money left from and attach proof. If something's off, reject it with a reason so the member can fix it.",
    topic: "Approving money out",
    notify: "Rejecting sends “Not Approved” with your reason. When they fix it and resend, you're notified again."
  },
  {
    id: "form-withdrawal",
    path: "/admin",
    targets: ["review-form"],
    via: [{ path: "/admin", target: "example-withdrawal", title: "Tap Jose's withdrawal", hint: "Every item opens a form to check before you approve.", optional: true }],
    title: "Withdrawal",
    text: "Check the amount and that they have enough available. Send it to the account under Send to, then pick the bank it left from here and attach the transfer screenshot. Approve once both are in.",
    notify: "The member gets “Withdrawal Approved” once you approve."
  },
  {
    id: "form-loan-release",
    path: "/admin",
    targets: ["review-terms", "review-form"],
    via: [{ path: "/admin", target: "example-loan-release", title: "Tap Ben's loan request", hint: "Every item opens a form to check before you approve.", optional: true }],
    title: "Loan request: the terms",
    text: "Check the interest, term and first payment date. You can change them and Save. The fund check below shows if it fits the lending limits."
  },
  {
    id: "form-loan-release-send",
    path: "/admin",
    targets: ["review-details", "review-form"],
    title: "Loan request: sending it",
    text: "Send the money to the account under Send to, pick the bank it left from and attach the transfer screenshot. Approve & activate starts the loan today.",
    notify: "Whoever sent the request gets “Loan Release Approved”. The borrower then gets reminders: “Due Soon” 3 days before each due date, “Due Today”, and “Overdue” every 10 days until paid. It's also posted to Telegram."
  },
  {
    id: "form-investment-return",
    path: "/admin",
    targets: ["review-form"],
    via: [{ path: "/admin", target: "example-investment-return", title: "Tap the investment return", hint: "Every item opens a form to check before you approve.", optional: true }],
    title: "Investment return",
    text: "Check the investment and the amount against the bank shown and the receipt. Then approve.",
    notify: "If a member sent it in, they get “Investment Return Approved”."
  },
  {
    id: "signup",
    path: "/admin",
    targets: ["queue-signup", "queue-count"],
    title: "When someone signs up",
    text: "They show up under New signups. Once you know who they are, approve them.",
    topic: "Signups"
  },
  {
    id: "fix",
    path: "/admin",
    targets: ["search-fix"],
    title: "When something was recorded wrong",
    text: "Find it here, correct it, and let the member know what changed.",
    topic: "Fixes and backups"
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
    via: [{ path: "/admin", target: "members", title: "Tap the Members icon", hint: "The people icon at the top of Admin opens everyone's details." }],
    title: "When someone joins or leaves",
    text: "Add them here. To edit or deactivate someone, tap their name in the list.",
    topic: "Members"
  },
  {
    id: "lending",
    path: "/admin/lending",
    targets: ["lending-limits"],
    via: [{ path: "/admin", target: "lending", title: "Tap the Lending limits icon", hint: "The bar-chart icon, next to Members." }],
    title: "When a loan is requested",
    text: "It's checked against these limits before you release it. They only change when everyone agrees.",
    topic: "Lending limits"
  },
  {
    id: "messages",
    path: "/messages",
    targets: ["messages-list", "messages-title"],
    via: [{ path: "/admin", target: "messages", title: "Tap the Messages icon", hint: "The chat bubble at the top of Admin opens every conversation." }],
    title: "When you or a member asks a question",
    text: "It's a chat: a member can message the admins, and you can message a member. You get a notification, the conversation shows up here, and you reply right in the thread.",
    topic: "Member questions",
    notify: "A member's message notifies every admin. Your reply notifies the member: “Message from the admins”."
  },
  {
    id: "interest-monthly",
    path: "/dashboard",
    targets: ["type-bank_interest"],
    via: [
      { path: "/dashboard", target: "new-fab", title: "Tap +", hint: "Everything you record starts here, on the Dashboard." },
      { target: "tx-type", title: "Tap Type", hint: "Choose what you're recording." }
    ],
    title: "When a bank credits interest",
    text: "Record it here with + → Bank Interest, and attach a screenshot.",
    topic: "Bank interest"
  },
  {
    id: "interest-yearly",
    path: "/fund-breakdown?tab=banks",
    targets: ["bank-interest-due", "bank-total"],
    via: [
      { path: "/admin", target: "nav-breakdown", title: "Tap Breakdown", hint: "In the bottom bar. Bank interest lives here." },
      { target: "tab-banks", title: "Tap the Banks tab", hint: "Each bank's balance and interest." }
    ],
    title: "At year end",
    text: "All bank interest is distributed at year end. Once December's interest is in, the year's total shows up here. Open each bank and tap Review & distribute."
  },
  {
    id: "interest-share",
    path: "/fund-breakdown?tab=banks",
    targets: ["example-split"],
    title: "How bank interest is shared",
    text: "Nothing to do here, the app works it out. Each member's share follows what they had in the fund on Dec 31: more in the fund, bigger share. Borrower accounts and anyone with Shares in gains turned off get none.",
    notify: "When you confirm, each member gets “Bank Interest Distributed”."
  },
  {
    id: "loans",
    path: "/fund-breakdown?tab=loans",
    targets: ["loans-attention", "loans-total"],
    via: [{ path: "/fund-breakdown", target: "tab-loans", title: "Tap the Loans tab", hint: "Every loan the fund has released." }],
    title: "When a loan is overdue or paid off",
    text: "It shows up here. Follow up with the borrower if it's overdue. If it's paid off, close it so the gain is shared.",
    topic: "Loans"
  },
  {
    id: "loans-share",
    path: "/fund-breakdown?tab=loans",
    targets: ["example-split"],
    title: "How a loan's gain is shared",
    text: "Nothing to do beyond closing the loan. The interest it earned is split the same way: by what each member had in the fund on the day it closes. A member who borrowed shares too, if they had money in the fund.",
    notify: "When you close it, each member gets “Loan Gain Distributed” (or “Loan Loss Allocated”)."
  },
  {
    id: "investments-share",
    path: "/fund-breakdown?tab=investments",
    targets: ["example-split"],
    via: [{ path: "/fund-breakdown", target: "tab-investments", title: "Tap the Investments tab", hint: "Every venture the fund has put money into." }],
    title: "When an investment makes or loses money",
    text: "Open it and tap Review & distribute. The gain, or loss, is split by what each member had in the fund on the date you pick. You can distribute more than once as returns come in.",
    topic: "Investments",
    notify: "Each member gets “Investment Gain Distributed” or “Investment Loss Allocated”."
  },
  {
    id: "done",
    path: "/admin",
    title: "You're all set",
    text: "You can replay this tour any time from Help → Admin."
  }
]

// The caption's "Go to" list: each topic and the step it starts on.
const TOPICS = STEPS.flatMap((step, index) => (step.topic ? [{ name: step.topic, index }] : []))

function topicOf(index: number) {
  return [...TOPICS].reverse().find((t) => t.index <= index)?.name ?? null
}

const PAD = 6
// Least room beside the spotlight the caption needs, before it's pinned to
// the bottom of the screen instead.
const MIN_CARD_ROOM = 200
const GAP = 12
const HAND_GAP = 52
const MARGIN = 16

// The phone's safe-area insets (status bar, home indicator). The installed
// app draws under the iOS status bar, so a caption at the very top of the
// screen would sit behind the clock. env() is CSS-only, so read it off a
// probe element.
function safeInsets() {
  const probe = document.createElement("div")
  probe.style.cssText =
    "position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)"
  document.body.appendChild(probe)
  const style = getComputedStyle(probe)
  const insets = { top: parseFloat(style.paddingTop) || 0, bottom: parseFloat(style.paddingBottom) || 0 }
  probe.remove()
  return insets
}
// How long to wait for a page to load its target before showing the
// caption centred in the meantime (the spotlight still moves onto it later).
const TARGET_TIMEOUT_MS = 4000

function onPage(path: string) {
  const [pathname, query] = path.split("?")
  if (window.location.pathname !== pathname) return false
  if (!query) return true
  const want = new URLSearchParams(query)
  const have = new URLSearchParams(window.location.search)
  return [...want.entries()].every(([k, v]) => have.get(k) === v)
}

function findTarget(targets: string[] | undefined): HTMLElement | null {
  for (const t of targets ?? []) {
    // Last match wins: a sheet opened on top (the type picker over the
    // entry sheet) comes later in the document than what it covers.
    const all = document.querySelectorAll<HTMLElement>(`[data-tour="${t}"]`)
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].getClientRects().length > 0) return all[i]
    }
  }
  return null
}

// Brings the target into view: centred, or for something taller than half
// the screen, its top just under the sticky header so the caption still
// has room below it.
function reveal(el: HTMLElement) {
  const r = el.getBoundingClientRect()
  if (r.height > window.innerHeight * 0.45) {
    // Works inside a scrolling sheet too, unlike scrolling the window.
    el.style.scrollMarginTop = "72px"
    el.scrollIntoView({ block: "start", behavior: "smooth" })
  } else el.scrollIntoView({ block: "center", behavior: "smooth" })
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type Spot = { top: number; left: number; width: number; height: number; radius: number; inSheet: boolean }

// The step the tour is on (null id when it isn't running), and whether
// it's past the tap that leads to it -- for pages that show example items
// or open example forms on some steps (see TourExamples).
export function useAdminTourStep(): { id: string | null; showing: boolean } {
  const [state, setState] = useState<{ index: number | null; phase: "via" | "show" }>({ index: null, phase: "show" })
  useEffect(() => {
    const update = () => setState({ index: getAdminTourStep(), phase: getAdminTourPhase() })
    update()
    window.addEventListener(ADMIN_TOUR_CHANGE_EVENT, update)
    return () => window.removeEventListener(ADMIN_TOUR_CHANGE_EVENT, update)
  }, [])
  const id = state.index === null ? null : STEPS[state.index]?.id ?? null
  return { id, showing: state.phase === "show" }
}

export function useAdminTourStepId(): string | null {
  return useAdminTourStep().id
}

export function AdminTourHost() {
  const { member } = useAuth()
  const isAdmin = member?.role === "admin"
  const [index, setIndex] = useState<number | null>(null)
  // Transitions only play when moving forward -- Back (or a reload mid-
  // tour) goes straight to the step.
  const [forward, setForward] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- picks up a tour already under way (sessionStorage is only readable after hydration)
    setIndex(getAdminTourStep())
    const onChange = () => setIndex(getAdminTourStep())
    window.addEventListener(ADMIN_TOUR_CHANGE_EVENT, onChange)
    return () => window.removeEventListener(ADMIN_TOUR_CHANGE_EVENT, onChange)
  }, [])

  // setAdminTourStep fires the change event, which updates index above.
  const go = useCallback(
    (next: number | null) => {
      setForward(next !== null && index !== null && next > index)
      setAdminTourStep(next)
    },
    [index]
  )

  if (!isAdmin || index === null || !STEPS[index]) return null
  return <TourOverlay key={index} index={index} playVia={forward} go={go} />
}

function TourOverlay({ index, playVia, go }: { index: number; playVia: boolean; go: (next: number | null) => void }) {
  const router = useRouter()
  const step = STEPS[index]
  const isLast = index === STEPS.length - 1
  const [ready, setReady] = useState(false)
  const [spot, setSpot] = useState<Spot | null>(null)
  // The screen, and the edges a caption must stay inside of.
  const [viewport, setViewport] = useState({ w: 0, h: 0, top: MARGIN, bottom: MARGIN })
  const target = useRef<HTMLElement | null>(null)
  // While the tour is asking for a tap: its caption, how to resume once
  // tapped, and whether the press animation is playing.
  const [via, setVia] = useState<Via | null>(null)
  const tapped = useRef<(() => void) | null>(null)
  const [tapping, setTapping] = useState(false)
  const tap = useCallback(() => tapped.current?.(), [])
  // The caption's topic list, open in place of the step text.
  const [showTopics, setShowTopics] = useState(false)
  // The caption's natural height (text plus buttons), measured after each
  // render, so it's only placed beside the spotlight where it fully fits.
  const bodyRef = useRef<HTMLDivElement>(null)
  const footRef = useRef<HTMLDivElement>(null)
  const [need, setNeed] = useState(MIN_CARD_ROOM)
  useLayoutEffect(() => {
    const natural = (bodyRef.current?.scrollHeight ?? 0) + (footRef.current?.offsetHeight ?? 0)
    if (natural > 0 && Math.abs(natural - need) > 1) setNeed(natural)
  }, [need, ready, via, showTopics, viewport.w])

  const measure = useCallback(() => {
    const insets = safeInsets()
    setViewport({ w: window.innerWidth, h: window.innerHeight, top: insets.top + MARGIN, bottom: insets.bottom + MARGIN })
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
      radius: radius >= r.height / 2 ? 9999 : radius + PAD,
      inSheet: !!el.closest("[data-sheet]")
    })
  }, [])

  // Play the step's transition (if any), go to its page if still needed,
  // then wait for its target to render.
  useEffect(() => {
    let cancelled = false

    async function waitFor<T>(get: () => T | null, timeoutMs: number): Promise<T | null> {
      const started = Date.now()
      while (!cancelled) {
        const value = get()
        if (value) return value
        if (Date.now() - started > timeoutMs) return null
        await sleep(150)
      }
      return null
    }

    async function ensurePage(path: string) {
      if (onPage(path)) return
      router.push(path)
      await waitFor(() => onPage(path) || null, 10000)
    }

    function point(el: HTMLElement | null) {
      target.current = el
      if (el) reveal(el)
      measure()
    }

    async function run() {
      setAdminTourPhase(playVia && step.via?.length ? "via" : "show")
      if (playVia) {
        for (const v of step.via ?? []) {
          if (v.path) await ensurePage(v.path)
          const el = await waitFor(() => findTarget([v.target]), v.optional ? 1500 : 5000)
          if (cancelled) return
          if (!el) break
          point(el)
          setVia(v)
          setReady(true)
          // Wait for the admin -- no timer, so there's time to read.
          await new Promise<void>((resolve) => {
            tapped.current = resolve
          })
          tapped.current = null
          if (cancelled) return
          setTapping(true)
          await sleep(450)
          if (cancelled) return
          const clickable = el.matches("button, a") ? el : el.querySelector<HTMLElement>("button, a") ?? el
          clickable.click()
          setTapping(false)
          setVia(null)
          setReady(false)
          point(null)
          await sleep(400)
        }
      }

      if (cancelled) return
      setAdminTourPhase("show")
      await ensurePage(step.path)
      if (!step.targets) {
        point(null)
        setReady(true)
        return
      }
      const el = await waitFor(() => findTarget(step.targets), TARGET_TIMEOUT_MS)
      if (cancelled) return
      point(el)
      setReady(true)
      if (el) return
      // A slow page: the caption shows centred meanwhile, and the spotlight
      // still moves onto the target once it renders.
      const late = await waitFor(() => findTarget(step.targets), 30000)
      if (!cancelled && late) point(late)
    }

    run()
    return () => {
      cancelled = true
      tapped.current = null
    }
  }, [step, playVia, router, measure])

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
    if (!ready || !spot) return
    const observer = new ResizeObserver(measure)
    if (target.current) observer.observe(target.current)
    observer.observe(document.body)
    return () => observer.disconnect()
    // Re-subscribe only when the spotlight appears or disappears, not on
    // every move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, !!spot, measure])

  // The caption goes on whichever side of the spotlight has more room, and
  // scrolls inside itself if even that isn't enough. Centred when there's
  // nothing to point at.
  const cardWidth = Math.min(340, viewport.w - MARGIN * 2)
  // Room for the pointing hand between a control to tap and its caption.
  const gap = via ? HAND_GAP : GAP
  let cardStyle: CSSProperties
  if (spot && viewport.w) {
    const centre = spot.left + spot.width / 2
    const left = Math.min(Math.max(centre - cardWidth / 2, MARGIN), viewport.w - cardWidth - MARGIN)
    const roomBelow = viewport.h - (spot.top + spot.height) - gap - viewport.bottom
    const roomAbove = spot.top - gap - viewport.top
    const fitsBelow = roomBelow >= need
    const fitsAbove = roomAbove >= need
    if (fitsBelow || fitsAbove) {
      cardStyle =
        fitsBelow && (roomBelow >= roomAbove || !fitsAbove)
          ? { left, top: spot.top + spot.height + gap, width: cardWidth, maxHeight: roomBelow }
          : { left, bottom: viewport.h - spot.top + gap, width: cardWidth, maxHeight: roomAbove }
    } else {
      // No room for the whole caption beside it: pin it to a screen edge. In a
      // sheet (the review forms) that's the top -- over the form's title --
      // so its Approve button and bank line stay in view; on a page (the
      // queue examples) whichever edge is further from the spotlight.
      // Tall enough for a step's text plus its notification note without
      // scrolling, while leaving the far end of the screen (a form's
      // Approve button) in view.
      const pinTop = spot.inSheet || spot.top + spot.height / 2 > viewport.h / 2
      cardStyle = {
        left: (viewport.w - cardWidth) / 2,
        ...(pinTop ? { top: viewport.top } : { bottom: viewport.bottom }),
        width: cardWidth,
        maxHeight: Math.min(viewport.h - viewport.top - viewport.bottom, Math.max(viewport.h * 0.62, 380))
      }
    }
  } else {
    cardStyle = {
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      width: cardWidth || 340,
      maxHeight: viewport.h ? viewport.h - viewport.top - viewport.bottom : undefined
    }
  }

  // A dark page barely changes under a light dim, so dark mode dims harder
  // for the spotlight to stand out. (The overlay only renders client-side,
  // after the theme class is on <html>.)
  const dim = document.documentElement.classList.contains("dark") ? "rgba(0, 0, 0, 0.72)" : "rgba(0, 0, 0, 0.45)"

  // The hand sits in the gap on the caption's side of the control.
  const handAbove = !!spot && viewport.h - (spot.top + spot.height) < spot.top

  return (
    <Portal>
      <div className="fixed inset-0 z-[60] font-sans" role="dialog" aria-modal="true" aria-label="Admin tour">
        {/* Swallows taps on the page underneath while the tour is open. */}
        <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

        {ready && spot ? (
          <div
            className={`absolute ring-2 ring-gold motion-safe:transition-all motion-safe:duration-300 ${
              via ? "ring-4 cursor-pointer" : "pointer-events-none"
            } ${tapping ? "bg-gold/30 motion-safe:scale-90" : ""}`}
            style={{
              top: spot.top,
              left: spot.left,
              width: spot.width,
              height: spot.height,
              borderRadius: spot.radius,
              // Gold glow around the cut-out, then the dim over the rest
              // of the page -- the glow is what makes it read as lit when
              // the control itself is dark (dark mode, the + button).
              boxShadow: `0 0 18px 4px color-mix(in srgb, var(--gold) ${via ? 85 : 60}%, transparent), 0 0 0 9999px ${dim}`
            }}
            // Tapping the highlighted control itself carries on the tour.
            onClick={via ? tap : undefined}
            role={via ? "button" : undefined}
            aria-label={via ? via.title : undefined}
          >
            {via && !tapping && (
              <span
                className="absolute inset-0 ring-4 ring-gold motion-safe:animate-ping pointer-events-none"
                style={{ borderRadius: spot.radius }}
              />
            )}
          </div>
        ) : (
          <div className="absolute inset-0 pointer-events-none" style={{ background: dim }} />
        )}

        {/* Pointing hand on the control to tap, in the gap between it and
            the caption -- below it, or above it near the bottom of the
            screen (+, the bottom bar). */}
        {ready && spot && via && !tapping && (
          <span
            aria-hidden="true"
            className="absolute pointer-events-none text-3xl leading-none drop-shadow-lg motion-safe:animate-bounce"
            style={
              handAbove
                ? { left: spot.left + spot.width / 2 - 15, top: spot.top - 42 }
                : { left: spot.left + spot.width / 2 - 15, top: spot.top + spot.height + 6 }
            }
          >
            {handAbove ? "👇" : "👆"}
          </span>
        )}

        {ready && (
          // Text scrolls in its own area if it ever has to; the buttons sit
          // in a fixed row underneath, so they're always in view.
          <div
            className="absolute flex flex-col overflow-hidden bg-paper text-ink border border-hairline dark:border-white/20 rounded-2xl shadow-xl"
            style={cardStyle}
          >
            <div ref={bodyRef} className="min-h-0 overflow-y-auto overscroll-contain px-4 pt-4 pb-1">
              <div className="flex items-start justify-between gap-3">
                <p className="font-display font-semibold text-base leading-snug">
                  {showTopics ? "Go to a topic" : via ? via.title : step.title}
                </p>
                <span className="shrink-0 flex items-center gap-2 mt-0.5">
                  <span className="text-[11px] font-mono text-ink-soft">
                    {index + 1}/{STEPS.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowTopics((v) => !v)}
                    aria-expanded={showTopics}
                    className="text-[11px] font-mono text-gold border border-gold/60 rounded-full px-2 py-0.5"
                  >
                    {showTopics ? "Close" : "Topics ▾"}
                  </button>
                </span>
              </div>

              {showTopics ? (
                <ul className="mt-2 mb-3 -mx-1">
                  {TOPICS.map((t) => {
                    const current = topicOf(index) === t.name
                    return (
                      <li key={t.name}>
                        <button
                          type="button"
                          onClick={() => {
                            setShowTopics(false)
                            if (t.index !== index) go(t.index)
                          }}
                          className={`w-full flex items-center justify-between gap-3 px-2 py-2 rounded-lg text-left text-sm ${
                            current ? "bg-gold/15 text-ink font-semibold" : "text-ink hover:bg-paper-2"
                          }`}
                        >
                          <span>{t.name}</span>
                          <span className="text-ink-soft">{current ? "You're here" : "→"}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <>
                  <p className="mt-1 text-sm leading-relaxed text-ink-soft">{via ? via.hint : step.text}</p>
                  {!via && step.notify && (
                    <p className="mt-2.5 flex gap-2 rounded-lg bg-gold/10 px-2.5 py-2 text-[13px] leading-snug text-ink">
                      <span aria-hidden="true">🔔</span>
                      <span>{step.notify}</span>
                    </p>
                  )}
                </>
              )}
            </div>

            {!showTopics && (
              <div ref={footRef} className="shrink-0 flex items-center gap-2 px-4 pb-4 pt-3">
                {isLast && !via ? (
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
                {via ? (
                  <button
                    type="button"
                    onClick={tap}
                    disabled={tapping}
                    className="bg-gold text-paper px-5 py-2 rounded-full text-sm font-bold"
                  >
                    Tap it
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => go(isLast ? null : index + 1)}
                    className="bg-ink text-paper px-5 py-2 rounded-full text-sm font-bold"
                  >
                    {isLast ? "Done" : index === 0 ? "Start" : "Next"}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Portal>
  )
}
