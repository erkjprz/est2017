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
// shows when the real queue is empty) -- don't wait long for it. `hint`: an
// extra line under the title, when the title alone isn't enough.
type Via = { path?: string; target: string; title: string; hint?: string; optional?: boolean }

// Captions name the app's buttons and labels in [brackets]; they show as a
// small button-style label, without the brackets.
function Caption({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[[^\]]+\])/).map((part, i) =>
        part.startsWith("[") && part.endsWith("]") ? (
          <span
            key={i}
            className="inline-block rounded-md border border-hairline bg-paper-2 px-1.5 py-px text-[0.92em] font-semibold text-ink leading-snug"
          >
            {part.slice(1, -1)}
          </span>
        ) : (
          part
        )
      )}
    </>
  )
}

type Step = {
  id: string
  path: string
  targets?: string[]
  // More of the page to light up along with the target, when it's there --
  // e.g. a form's "bank balance after" box, which sits in the sheet's footer.
  alsoShow?: string[]
  via?: Via[]
  title: string
  text: string
  // Starts a topic in the caption's "Go to" list.
  topic?: string
  // A chapter card: a short divider that opens a group of topics (Every
  // day, Every month, ...). No page of its own -- it shows over whichever
  // page the tour is on.
  chapter?: string
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
    text: "Here's how things flow once you're an admin. Your approval moves the money. Tap [⋯] any time to jump to a subject.",
    topic: "Welcome"
  },
  {
    id: "chapter-daily",
    path: "",
    title: "Every day",
    text: "The approval queue: what lands in it, and how to clear it.",
    chapter: "Every day"
  },
  {
    id: "queue",
    path: "/admin",
    targets: ["queue-count"],
    title: "Your approval queue",
    text: "Everything waiting for an admin lands here: money members send in, money they ask for, and new signups.",
    notify: "You get “Pending Approval” when a member sends something in, and “New Signup” when someone signs up.",
    topic: "Your queue"
  },
  {
    id: "review-in",
    path: "/admin",
    targets: ["queue-confirmed", "queue-decision", "queue-count"],
    title: "When something comes in",
    text: "Contributions and loan payments are money already in the bank, so they only need confirming. When there’s more than one, you can bulk approve. [Reject] is one at a time. Red labels flag something to look at twice.",
    topic: "Approving money in"
  },
  {
    id: "form-contribution",
    path: "/admin",
    targets: ["review-form"],
    alsoShow: ["review-impact"],
    via: [{ path: "/admin", target: "example-contribution", title: "Tap Maria's contribution", optional: true }],
    title: "Contribution",
    text: "Check the amount, date and bank against the bank app and the member's receipt below. Above [Approve] you'll see the balance movements.",
    notify: "Approving sends the member “Contribution Approved”. Rejecting sends “Contribution Not Approved” with your reason."
  },
  {
    id: "form-loan-payment",
    path: "/admin",
    targets: ["review-form"],
    alsoShow: ["review-impact"],
    via: [{ path: "/admin", target: "example-loan-payment", title: "Tap Ana's loan payment", optional: true }],
    title: "Loan payment",
    text: "The line at the top shows what's left on the loan. Check the amount against the bank and the member's receipt, then [Approve]. It comes off what's owed.",
    notify: "The member gets “Loan Payment Approved”, and payment reminders for that due date stop."
  },
  {
    id: "review-out",
    path: "/admin",
    targets: ["queue-decision-top", "queue-decision", "queue-confirmed", "queue-count"],
    title: "When money goes out",
    text: "Withdrawals, loan releases and investment returns are reviewed one at a time. For withdrawals and loans, send the money first, then [Approve].",
    notify: "After you reject something, the member can fix it and resend it, and you're notified again.",
    topic: "Approving money out"
  },
  {
    id: "form-withdrawal",
    path: "/admin",
    targets: ["review-form"],
    alsoShow: ["review-impact"],
    via: [{ path: "/admin", target: "example-withdrawal", title: "Tap Jose's withdrawal", optional: true }],
    title: "Withdrawal",
    text: "Check the amount against what's available at the top. Send it to the account under Send to, then pick the bank it left from and attach the transfer screenshot. [Approve] once both are in.",
    notify: "The member gets “Withdrawal Approved”."
  },
  {
    id: "form-loan-release",
    path: "/admin",
    targets: ["review-terms", "review-form"],
    via: [{ path: "/admin", target: "example-loan-release", title: "Tap Ben's loan request", optional: true }],
    title: "Loan request: the terms",
    text: "Check the interest, term and first payment date. You can change them and [Save]. The fund check below shows if it fits the lending limits."
  },
  {
    id: "form-loan-release-send",
    path: "/admin",
    targets: ["review-details", "review-form"],
    alsoShow: ["review-impact"],
    title: "Loan request: sending it",
    text: "Send the money to the account under Send to, pick the bank it left from and attach the transfer screenshot. [Approve & activate] starts the loan today.",
    notify: "Whoever sent the request gets “Loan Release Approved”. The borrower then gets reminders: “Due Soon” 3 days before each due date, “Due Today”, and “Overdue” every 10 days until paid. It's also posted to Telegram."
  },
  {
    id: "form-investment-return",
    path: "/admin",
    targets: ["review-form"],
    alsoShow: ["review-impact"],
    via: [{ path: "/admin", target: "example-investment-return", title: "Tap the investment return", optional: true }],
    title: "Investment return",
    text: "Check the investment and the amount against the bank shown and the receipt. Then [Approve].",
    notify: "If a member sent it in, they get “Investment Return Approved”."
  },
  {
    id: "signup",
    path: "/admin",
    targets: ["queue-signup", "queue-count"],
    title: "When someone signs up",
    text: "Members show up under New signups, borrowers under Borrower requests. Once you know who they are, [Approve] them.",
    topic: "Signups"
  },
  {
    id: "messages",
    path: "/messages",
    targets: ["messages-list", "messages-title"],
    via: [{ path: "/admin", target: "messages", title: "Tap the Messages icon" }],
    title: "When you or a member asks a question",
    text: "It's a chat: members can message the admins, and you can message a member. Every conversation is here, and you reply right in the thread.",
    notify: "A member's message notifies every admin. Your reply notifies the member: “Message from the admins”.",
    topic: "Member questions"
  },
  {
    id: "chapter-monthly",
    path: "",
    title: "Every month",
    text: "Recording bank interest and keeping a backup.",
    chapter: "Every month"
  },
  {
    id: "interest-monthly",
    path: "/dashboard",
    targets: ["type-bank_interest"],
    via: [
      { path: "/dashboard", target: "new-fab", title: "Tap +" },
      { target: "tx-type", title: "Tap Type" }
    ],
    title: "When a bank credits interest",
    text: "Pick [Bank Interest], choose the bank and attach a screenshot of the statement.",
    topic: "Bank interest"
  },
  {
    id: "export",
    path: "/admin",
    targets: ["export"],
    title: "At the end of each month",
    text: "Download the full ledger here to keep a backup.",
    topic: "Backups"
  },
  {
    id: "chapter-sometimes",
    path: "",
    title: "Now and then",
    text: "Fixing mistakes, closing loans, sharing investment gains and the year’s bank interest.",
    chapter: "Now and then"
  },
  {
    id: "fix",
    path: "/admin",
    targets: ["search-fix"],
    title: "When something was recorded wrong",
    text: "Find it here, correct it, and let the member know what changed.",
    topic: "Fixing mistakes"
  },
  {
    id: "loans",
    path: "/fund-breakdown?tab=loans",
    targets: ["loans-attention", "loans-total"],
    via: [
      { path: "/admin", target: "nav-breakdown", title: "Tap Breakdown" },
      { target: "tab-loans", title: "Tap the Loans tab" }
    ],
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
    via: [{ path: "/fund-breakdown", target: "tab-investments", title: "Tap the Investments tab" }],
    title: "When an investment makes or loses money",
    text: "Open it and tap [Review & distribute]. The gain or loss is split by what each member had in the fund on the date you pick. You can distribute more than once as returns come in.",
    notify: "Each member gets “Investment Gain Distributed” or “Investment Loss Allocated”.",
    topic: "Investments"
  },
  {
    id: "interest-yearly",
    path: "/fund-breakdown?tab=banks",
    targets: ["bank-interest-due", "bank-total"],
    via: [{ path: "/fund-breakdown", target: "tab-banks", title: "Tap the Banks tab" }],
    title: "At year end",
    text: "Bank interest is shared out once a year. In January, once December's interest is in for every bank, last year's total shows up here. Open each bank and tap [Review & distribute].",
    topic: "Year-end interest"
  },
  {
    id: "interest-share",
    path: "/fund-breakdown?tab=banks",
    targets: ["example-split"],
    title: "How bank interest is shared",
    text: "Nothing to do here, the app works it out. Each member's share follows what they had in the fund on Dec 31: more in the fund, bigger share. Borrower accounts and anyone with [Shares in gains] turned off get none.",
    notify: "When you confirm, each member gets “Bank Interest Distributed”."
  },
  {
    id: "chapter-settings",
    path: "",
    title: "Settings",
    text: "Who’s in the fund, and how much it can lend.",
    chapter: "Settings"
  },
  {
    id: "members",
    path: "/admin/members",
    targets: ["members-add"],
    via: [{ path: "/admin", target: "members", title: "Tap the Members icon" }],
    title: "When someone joins or leaves",
    text: "Add them with [+ Add]. To edit or deactivate someone, tap their name in the list.",
    topic: "Members"
  },
  {
    id: "lending-available",
    path: "/admin/lending",
    targets: ["lending-available"],
    via: [{ path: "/admin", target: "lending", title: "Tap the Lending limits icon" }],
    title: "Available to lend",
    text: "How much more can go out on loan: the Total loans limit's share of the fund, minus what's already out. The bar fills as loans go out.",
    topic: "Lending limits"
  },
  {
    id: "lending",
    path: "/admin/lending",
    targets: ["lending-limits"],
    title: "When a loan is requested",
    text: "Each request is checked against these limits. Going over shows a warning on the request but doesn't block it. Change the limits only when everyone agrees."
  },
  {
    id: "lending-borrowers",
    path: "/admin/lending",
    targets: ["lending-borrowers"],
    title: "Borrowers",
    text: "Each borrower's unpaid loans plus any pending request, as a share of the fund. A share in red is over the Per borrower limit."
  },
  {
    id: "lending-holds",
    path: "/admin/lending",
    targets: ["lending-holds"],
    title: "Member holds",
    text: "When a loan goes out, each member's share of it is on hold until it's repaid. The same goes for money in investments. Money on hold can't be withdrawn. The Member hold limit warns when a loan would tie up too much of anyone's money."
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

// The chapter cards, and the ⋯ menu: topics grouped under their chapter.
const CHAPTERS = STEPS.flatMap((step, index) => (step.chapter ? [{ name: step.chapter, index }] : []))
const MENU = TOPICS.reduce<{ chapter: string | null; topics: typeof TOPICS }[]>((groups, topic) => {
  const chapter = [...CHAPTERS].reverse().find((c) => c.index <= topic.index)?.name ?? null
  const last = groups[groups.length - 1]
  if (last && last.chapter === chapter) last.topics.push(topic)
  else groups.push({ chapter, topics: [topic] })
  return groups
}, [])

const PAD = 6
// The card's height before it's first measured.
const MIN_CARD_ROOM = 200
const GAP = 12
const HAND_GAP = 52
const MARGIN = 16
// The caption card: widest it gets, its side gap, its progress bar.
const CARD_MAX_W = 440
const CARD_SIDE = 12
const PROGRESS_H = 3

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

// Every visible match for these targets (for a step's alsoShow).
function findAll(targets: string[]): HTMLElement[] {
  return targets.flatMap((t) =>
    Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${t}"]`)).filter((el) => el.getClientRects().length > 0)
  )
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

// The target's box on screen (plus padding), whether it sits in a sheet
// (a review form) and whether it's fixed in place (the bottom bar, +,
// Search & Fix) -- which scrolling the page can't move.
type Spot = {
  top: number
  left: number
  width: number
  height: number
  radius: number
  inSheet: boolean
  fixed: boolean
}

function isFixed(el: HTMLElement) {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (getComputedStyle(node).position === "fixed") return true
  }
  return false
}

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
  // The screen: its size, the safe edges a card stays inside of (status
  // bar, home indicator), where the sticky top bar ends and where the
  // bottom bar starts.
  // scrollRoom: how much further down the page can still scroll.
  const [viewport, setViewport] = useState({ w: 0, h: 0, top: MARGIN, bottom: MARGIN, header: 0, dock: 0, scrollRoom: 0 })
  const target = useRef<HTMLElement | null>(null)
  // The step's alsoShow targets, while it's showing (not during a tap).
  const alsoShow = useRef<string[]>([])
  // While the tour is asking for a tap: its caption, how to resume once
  // tapped, and whether the press animation is playing.
  const [via, setVia] = useState<Via | null>(null)
  const tapped = useRef<(() => void) | null>(null)
  const [tapping, setTapping] = useState(false)
  const tap = useCallback(() => tapped.current?.(), [])
  // The ⋯ menu (topics by chapter, End tour), open in place of the text.
  const [showMenu, setShowMenu] = useState(false)
  // A step's notification note, folded into one line until tapped.
  const [showNotify, setShowNotify] = useState(false)
  // The card's natural height (text plus buttons), measured after each
  // render, so the page can be scrolled to leave room for it.
  const bodyRef = useRef<HTMLDivElement>(null)
  const footRef = useRef<HTMLDivElement>(null)
  const [need, setNeed] = useState(MIN_CARD_ROOM)
  useLayoutEffect(() => {
    const natural = (bodyRef.current?.scrollHeight ?? 0) + (footRef.current?.offsetHeight ?? 0) + PROGRESS_H
    if (natural > PROGRESS_H && Math.abs(natural - need) > 1) setNeed(natural)
  }, [need, ready, via, showMenu, showNotify, viewport.w])

  const measure = useCallback(() => {
    const insets = safeInsets()
    const h = window.innerHeight
    const header = document.querySelector("nav")
    const dock = document.querySelector("nav.fixed")
    const dockRect = dock && !dock.hasAttribute("hidden") ? dock.getBoundingClientRect() : null
    setViewport({
      w: window.innerWidth,
      h,
      top: insets.top + MARGIN,
      bottom: insets.bottom + MARGIN,
      header: header ? header.getBoundingClientRect().bottom : 0,
      dock: dockRect && dockRect.height > 0 ? dockRect.top : h - insets.bottom,
      scrollRoom: Math.max(0, document.documentElement.scrollHeight - (window.scrollY + h))
    })
    const el = target.current
    if (!el || !el.isConnected) {
      setSpot(null)
      return
    }
    const own = el.getBoundingClientRect()
    let r = { top: own.top, left: own.left, right: own.right, bottom: own.bottom }
    for (const extra of findAll(alsoShow.current)) {
      const e = extra.getBoundingClientRect()
      r = {
        top: Math.min(r.top, e.top),
        left: Math.min(r.left, e.left),
        right: Math.max(r.right, e.right),
        bottom: Math.max(r.bottom, e.bottom)
      }
    }
    const height = r.bottom - r.top
    const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 8
    setSpot({
      top: r.top - PAD,
      left: r.left - PAD,
      width: r.right - r.left + PAD * 2,
      height: height + PAD * 2,
      radius: radius >= height / 2 ? 9999 : radius + PAD,
      inSheet: !!el.closest("[data-sheet]"),
      fixed: isFixed(el)
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
          // A page that's still loading (Admin's header icons wait for its
          // queue) gets longer before the tap is skipped.
          const el = await waitFor(() => findTarget([v.target]), v.optional ? 1500 : 10000)
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
      alsoShow.current = step.alsoShow ?? []
      setAdminTourPhase("show")
      // A chapter card has no page of its own: it shows over whichever
      // page the tour is on.
      if (step.path) await ensurePage(step.path)
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

  // ---- Where the card sits ----
  // "bottom": docked just above the bottom bar -- the usual place, so the
  // card never jumps around. "top": under the status bar, when the bottom
  // is taken: a review form fills it (its Approve button and balance must
  // stay in view), or the thing to tap is fixed down there (+, Search &
  // Fix) and can't be scrolled out from under the card. "center": nothing
  // to point at (welcome, chapter cards, the end).
  const cardWidth = Math.min(CARD_MAX_W, viewport.w - CARD_SIDE * 2)
  const cardLeft = (viewport.w - cardWidth) / 2
  const maxCardH = Math.round(viewport.h * 0.5)
  const cardH = Math.min(need, maxCardH)
  const bottomCardBottom = viewport.dock - CARD_SIDE
  const bottomCardTop = bottomCardBottom - cardH
  const topCardBottom = viewport.top + cardH
  const handRoom = via ? HAND_GAP : GAP
  // The page between the top bar and the docked card: where a page target
  // is scrolled to -- centred there when it fits, else its top just under
  // the top bar (a long list shows its first rows).
  const roomTop = Math.max(viewport.top, viewport.header + GAP)
  const roomBottom = bottomCardTop - handRoom
  const scrollWanted = spot
    ? spot.height <= roomBottom - roomTop
      ? spot.top - (roomTop + (roomBottom - roomTop - spot.height) / 2)
      : spot.top - roomTop
    : 0
  const underBottomCard = !!spot && spot.top < bottomCardBottom && spot.top + spot.height > bottomCardTop - handRoom
  const mode: "bottom" | "top" | "center" = !spot
    ? "center"
    : spot.inSheet ||
        // Fixed down there (+, Search & Fix), or at the foot of a page that
        // can't scroll it up out from under the card.
        (underBottomCard && (spot.fixed || scrollWanted > viewport.scrollRoom + 4))
      ? "top"
      : "bottom"

  // Scroll a page target into the room above the docked card: centred
  // there when it fits, else its top just under the top bar (a long list
  // shows its first rows). At most a couple of tries a step, so it can't
  // fight a page that won't scroll that far.
  const autoScrolls = useRef(0)
  useEffect(() => {
    if (!ready || !spot || mode !== "bottom" || spot.fixed || !viewport.h || autoScrolls.current >= 2) return
    if (spot.top >= roomTop && spot.top + spot.height <= roomBottom) return
    if (Math.abs(scrollWanted) < 4) return
    autoScrolls.current += 1
    window.scrollBy({ top: scrollWanted, behavior: "smooth" })
  }, [ready, spot, mode, roomTop, roomBottom, scrollWanted, viewport.h])

  let cardStyle: CSSProperties
  if (mode === "bottom") cardStyle = { left: cardLeft, width: cardWidth, bottom: viewport.h - bottomCardBottom, maxHeight: maxCardH }
  else if (mode === "top") cardStyle = { left: cardLeft, width: cardWidth, top: viewport.top, maxHeight: maxCardH }
  else
    cardStyle = {
      left: cardLeft,
      width: cardWidth,
      top: "50%",
      transform: "translateY(-50%)",
      maxHeight: viewport.h ? viewport.h - viewport.top - viewport.bottom : undefined
    }

  // The lit area as drawn: the spot, cut to what's visible -- between the
  // top bar and the card, so a long list doesn't light up under either.
  // A control fixed in place (the bottom bar, +) keeps its outline.
  let lit = spot
  if (spot && !spot.fixed) {
    const top = Math.max(spot.top, mode === "top" ? topCardBottom + GAP : spot.inSheet ? spot.top : viewport.header)
    const bottom = Math.min(spot.top + spot.height, mode === "bottom" ? bottomCardTop - GAP : viewport.h)
    if (bottom - top > 24) lit = { ...spot, top, height: bottom - top }
  }

  // A dark page barely changes under a light dim, so dark mode dims harder
  // for the spotlight to stand out. (The overlay only renders client-side,
  // after the theme class is on <html>.)
  const dim = document.documentElement.classList.contains("dark") ? "rgba(0, 0, 0, 0.72)" : "rgba(0, 0, 0, 0.45)"

  // The pointing hand goes on whichever side of the control has more room
  // (away from the card).
  const handAbove =
    !!spot &&
    (mode === "bottom" ? bottomCardTop : viewport.h) - (spot.top + spot.height) <
      spot.top - (mode === "top" ? topCardBottom : viewport.header)

  const chapterIndex = CHAPTERS.findIndex((c) => c.index === index)
  const eyebrow = step.chapter ? `Chapter ${chapterIndex + 1} of ${CHAPTERS.length}` : isLast ? "All done" : topicOf(index)
  const caption = via ? via.hint : step.text
  const primaryLabel = index === 0 ? "Start" : isLast ? "Done" : step.chapter ? "Let's go" : "Next"
  const progress = ((index + 1) / STEPS.length) * 100

  return (
    <Portal>
      <div className="fixed inset-0 z-[60] font-sans" role="dialog" aria-modal="true" aria-label="Admin tour">
        {/* Swallows taps on the page underneath while the tour is open. */}
        <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

        {ready && lit ? (
          <div
            // Only the press animates. Position and size follow the page
            // as it scrolls; animating them too made the spotlight trail
            // behind its target and land late.
            className={`absolute ring-2 ring-gold motion-safe:transition-[transform,scale,background-color] motion-safe:duration-300 ${
              via ? "ring-4 cursor-pointer" : "pointer-events-none"
            } ${tapping ? "bg-gold/30 motion-safe:scale-90" : ""}`}
            style={{
              top: lit.top,
              left: lit.left,
              width: lit.width,
              height: lit.height,
              borderRadius: lit.radius,
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
                style={{ borderRadius: lit.radius }}
              />
            )}
          </div>
        ) : (
          <div className="absolute inset-0 pointer-events-none" style={{ background: dim }} />
        )}

        {/* Pointing hand on the control to tap, on its side away from the
            card. */}
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
          <div
            className="absolute flex flex-col overflow-hidden rounded-3xl border border-hairline dark:border-white/15 bg-paper text-ink shadow-2xl"
            style={cardStyle}
          >
            {/* How far through the tour. */}
            <div className="shrink-0 bg-hairline/70" style={{ height: PROGRESS_H }}>
              <div className="h-full bg-gold motion-safe:transition-[width] motion-safe:duration-500" style={{ width: `${progress}%` }} />
            </div>

            {/* Text scrolls in its own area if it ever has to; the buttons
                sit in a fixed row underneath, always in view. */}
            <div ref={bodyRef} className="min-h-0 overflow-y-auto overscroll-contain px-5 pt-3.5">
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-[11px] font-mono uppercase tracking-[0.16em] text-gold">
                  {showMenu ? "Jump to" : eyebrow}
                </p>
                <button
                  type="button"
                  onClick={() => setShowMenu((v) => !v)}
                  aria-expanded={showMenu}
                  aria-label={showMenu ? "Close the tour menu" : "Tour menu"}
                  className="-mr-2 shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-ink-soft hover:bg-paper-2 hover:text-ink transition-colors"
                >
                  {showMenu ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5" aria-hidden="true">
                      <circle cx="5" cy="12" r="1.8" />
                      <circle cx="12" cy="12" r="1.8" />
                      <circle cx="19" cy="12" r="1.8" />
                    </svg>
                  )}
                </button>
              </div>

              {showMenu ? (
                <div className="pb-4">
                  {MENU.map((group) => (
                    <div key={group.chapter ?? "start"} className="mt-2">
                      {group.chapter && (
                        <p className="px-1 pt-2 pb-1 text-[10px] font-mono uppercase tracking-[0.16em] text-ink-soft">{group.chapter}</p>
                      )}
                      <ul>
                        {group.topics.map((t) => {
                          const current = topicOf(index) === t.name
                          return (
                            <li key={t.name}>
                              <button
                                type="button"
                                onClick={() => {
                                  setShowMenu(false)
                                  if (t.index !== index) go(t.index)
                                }}
                                className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl text-left text-[15px] ${
                                  current ? "bg-gold/15 font-semibold" : "hover:bg-paper-2"
                                }`}
                              >
                                <span>{t.name}</span>
                                {current && <span className="text-[11px] font-mono text-gold">Here</span>}
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => go(null)}
                    className="mt-3 w-full rounded-xl border border-hairline py-2.5 text-sm font-semibold text-ink-soft hover:text-ink"
                  >
                    End tour
                  </button>
                </div>
              ) : (
                <>
                  <h2
                    className={`font-display font-semibold leading-snug ${
                      step.chapter && !via ? "mt-2 text-[26px]" : "mt-1 text-[19px]"
                    }`}
                  >
                    {via ? via.title : step.title}
                  </h2>
                  {caption && (
                    <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">
                      <Caption text={caption} />
                    </p>
                  )}
                  {!via && step.notify && (
                    <div className="mt-2.5">
                      <button
                        type="button"
                        onClick={() => setShowNotify((v) => !v)}
                        aria-expanded={showNotify}
                        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-gold"
                      >
                        <span aria-hidden="true">🔔</span>
                        Who gets notified
                        <span aria-hidden="true" className={`text-[9px] transition-transform ${showNotify ? "rotate-90" : ""}`}>
                          ▶
                        </span>
                      </button>
                      {showNotify && (
                        <p className="mt-1.5 rounded-xl bg-gold/10 px-3 py-2 text-[13px] leading-snug text-ink">{step.notify}</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {!showMenu && (
              <div ref={footRef} className="shrink-0 flex items-center gap-3 px-5 pb-5 pt-4">
                {index > 0 && (
                  <button
                    type="button"
                    onClick={() => go(index - 1)}
                    aria-label="Back"
                    className="shrink-0 w-11 h-11 rounded-full border border-hairline flex items-center justify-center text-ink-soft hover:text-ink transition-colors"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
                      <path d="M15 18l-6-6 6-6" />
                    </svg>
                  </button>
                )}
                {via ? (
                  <button
                    type="button"
                    onClick={tap}
                    disabled={tapping}
                    className="ml-auto bg-gold text-paper px-7 h-11 rounded-full text-[15px] font-bold shadow-md"
                  >
                    Tap it
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => go(isLast ? null : index + 1)}
                    className="ml-auto bg-ink text-paper px-7 h-11 rounded-full text-[15px] font-bold shadow-md"
                  >
                    {primaryLabel}
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
