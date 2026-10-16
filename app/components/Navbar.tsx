"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useAuth } from "@/app/auth-context"
import { NotificationBell } from "@/app/components/NotificationBell"
import { ChatButton } from "@/app/components/ChatButton"
import { useHydrated } from "@/lib/useHydrated"
import { Toast } from "@/app/components/Toast"
import { notifyTransactionsChanged } from "@/lib/transactionEvents"
import { loadTransactionFormData } from "@/lib/transactionFormPrefetch"
import { whenIdle } from "@/lib/whenIdle"

// --dock-h: the distance from the bottom edge to the top of whichever of
// the dock's floating parts sticks up furthest (see the measuring effect).
function setDockHeight(...els: (Element | null)[]) {
  const tops = els.filter((el): el is Element => !!el).map((el) => el.getBoundingClientRect().top)
  if (tops.length === 0) return
  document.documentElement.style.setProperty("--dock-h", `${window.innerHeight - Math.min(...tops)}px`)
}

// Split out of the shared bundle -- it's only rendered once the FAB is
// tapped, so there's no reason for every page to download it up front.
// Navbar preloads it in the background once a member is signed in (see
// below), so the first tap doesn't wait on the download either.
const loadNewTransactionSheet = () =>
  import("@/app/components/NewTransactionSheet").then((mod) => mod.NewTransactionSheet)
const NewTransactionSheet = dynamic(loadNewTransactionSheet)

// Same reduced fraction budget-tracker's BottomNav uses -- a floating pill
// inset from the edge only needs a little clearance from the home
// indicator, not the device's full safe-area inset (which is sized for an
// edge-to-edge bar).
const DOCK_OFFSET = "calc(env(safe-area-inset-bottom) * 0.4)"

function IconHome({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.25 : 1.75} className="w-[22px] h-[22px]">
      <path d="M4 11l8-7 8 7v8a2 2 0 01-2 2H6a2 2 0 01-2-2v-8z" />
    </svg>
  )
}

function IconTransactions({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.25 : 1.75} className="w-[22px] h-[22px]">
      <path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" />
    </svg>
  )
}

function IconBreakdown({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.25 : 1.75} className="w-[22px] h-[22px]">
      <path d="M12 2a10 10 0 100 20 10 10 0 000-20z" />
      <path d="M12 2v10l7 7" />
    </svg>
  )
}

function IconAdmin({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.25 : 1.75} className="w-[22px] h-[22px]">
      <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z" />
    </svg>
  )
}

function IconMenu({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.25 : 1.75} className="w-[22px] h-[22px]">
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </svg>
  )
}

type DockItem = {
  label: string
  path: string
  icon: (props: { active: boolean }) => React.ReactNode
  // Highlights this tab for any page "owned" by it, not just an exact
  // match -- e.g. Transactions stays highlighted on its own detail pages.
  activeWhen?: (pathname: string) => boolean
}

// The FAB's own open/close state is local to Navbar, so a page that isn't
// Navbar itself (Admin > Members' "New Transaction" link) has no direct
// way to trigger it -- this is that hook, a `?newTransaction=1` query
// param this watches for and clears once handled.
//
// Needs useSearchParams(), not a plain window.location read in a
// pathname-keyed effect -- router.push to the *same* pathname with only a
// different query string doesn't change what usePathname() returns, so a
// pathname-keyed effect never re-fires on an in-place
// "?newTransaction=1" click (only on a genuinely fresh page load).
// useSearchParams() is the one that's actually reactive to query-only
// changes. It needs a Suspense boundary, kept local to this small watcher
// (wrapped where it's rendered below) rather than pushed onto every page
// that renders Navbar. onOpen is React's own setSheetOpen, so its
// identity is stable across renders and doesn't need excluding from the
// dependency array.
function NewTransactionQueryWatcher({ onOpen }: { onOpen: (open: boolean) => void }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { member } = useAuth()
  const requested = searchParams.get("newTransaction")

  useEffect(() => {
    if (!member || !requested) return
    onOpen(true)
    router.replace(pathname, { scroll: false })
  }, [member, requested, pathname, router, onOpen])

  return null
}

export default function Navbar() {
  const router = useRouter()
  const pathname = usePathname()
  const { member } = useAuth()
  // The cached member can say "admin" on the client's first render, but
  // the server rendered without one -- hold the Admin tab back until
  // hydration so both sides agree.
  const hydrated = useHydrated()
  const isAdmin = hydrated && member?.role === "admin"
  const navRef = useRef<HTMLElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const fabRef = useRef<HTMLButtonElement>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  // True while the on-screen keyboard is up (a text field is focused on a
  // touch device). iOS lifts fixed elements above the keyboard, so the dock
  // would otherwise ride up with it and squeeze whatever's being typed
  // into -- e.g. the chat reply box, which sits on top of the dock.
  const [typing, setTyping] = useState(false)

  // Warms NewTransactionSheet's data cache the moment this page has a
  // signed-in member, well before the FAB is ever tapped -- without
  // this, the sheet only starts fetching banks/loans/investments/etc.
  // once it mounts on tap, showing a "Loading..." state every single
  // time. Fire-and-forget: the sheet itself still awaits the same
  // function as a fallback if it gets opened before this finishes (e.g.
  // tapping the FAB within the first instant of a page load).
  useEffect(() => {
    if (!member) return
    loadTransactionFormData(member.member_id, member.role === "admin")
    // Same idea for the sheet's code, but at idle time so it never
    // competes with the page's own first render.
    return whenIdle(() => void loadNewTransactionSheet())
  }, [member])

  // Pages reserve bottom padding (--dock-h) to clear whichever floating
  // element sticks up furthest from the bottom edge -- the FAB floats above
  // the pill (see its own `bottom` below) and is taller than the pill
  // overall, so it -- not the pill -- is what a page needs to clear, on the
  // pages that actually show it (see showFab below). Measured (not
  // hardcoded) so existing pages' padding stays correct without every one
  // of them needing its own update, and so it naturally shrinks back down
  // to just the pill's own height on a page with no FAB. The dock itself
  // is still a permanent fixture, so this only needs to run once on mount.
  useEffect(() => {
    // Measures actual rendered box edges rather than re-deriving the pill's
    // safe-area padding/gap/height arithmetic by hand -- correct regardless
    // of how any of those are expressed (env(), calc(), rem) and however
    // they change.
    function update() {
      // Hidden while typing (see below), when --dock-h is pinned to 0.
      if (navRef.current?.hidden) return
      setDockHeight(barRef.current, fabRef.current)
    }
    update()
    const observers = [barRef.current, fabRef.current]
      .filter((el): el is HTMLDivElement | HTMLButtonElement => !!el)
      .map((el) => {
        const o = new ResizeObserver(update)
        o.observe(el)
        return o
      })
    window.addEventListener("resize", update)
    return () => {
      observers.forEach((o) => o.disconnect())
      window.removeEventListener("resize", update)
    }
  }, [])

  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) return
    const isTextField = (el: Element | null) =>
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLElement && el.isContentEditable) ||
      (el instanceof HTMLInputElement && !["button", "checkbox", "radio", "range", "file", "submit", "reset", "color"].includes(el.type))
    // focusout fires before focus lands on the next field, so check where
    // focus ended up on the next frame rather than hiding/showing on every
    // hop between two fields.
    let frame = 0
    const sync = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setTyping(isTextField(document.activeElement)))
    }
    document.addEventListener("focusin", sync)
    document.addEventListener("focusout", sync)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener("focusin", sync)
      document.removeEventListener("focusout", sync)
    }
  }, [])

  // Pages clear the dock with --dock-h, so it drops to 0 while the dock is
  // hidden and is re-measured once it's back.
  useEffect(() => {
    if (typing) document.documentElement.style.setProperty("--dock-h", "0px")
    else setDockHeight(barRef.current, fabRef.current)
  }, [typing])

  // iOS can leave a `position: fixed` element positioned against a stale
  // layout viewport on a page too short to ever scroll on its own (a
  // loading screen, a short list) -- WebKit only recomputes fixed-position
  // layout in response to an actual scroll event, which a non-scrollable
  // page never fires. Nudging the scroll position by a pixel and
  // immediately back forces that recompute regardless of whether this
  // particular page happens to be tall enough to scroll by itself (see
  // layout.tsx's spacer div, which guarantees it always has somewhere to
  // nudge into). Fires on every navigation (below), and also on resuming
  // from the background (screen lock, app switch, home-screen icon
  // relaunch without a full process kill) -- a case with no route change
  // at all, but the same layout can just as easily go stale across it.
  useEffect(() => {
    function nudge() {
      window.scrollTo(0, 1)
      requestAnimationFrame(() => window.scrollTo(0, 0))
    }
    function onVisible() {
      if (document.visibilityState === "visible") nudge()
    }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("pageshow", nudge)
    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("pageshow", nudge)
    }
  }, [])

  useEffect(() => {
    window.scrollTo(0, 1)
    requestAnimationFrame(() => window.scrollTo(0, 0))
  }, [pathname])

  // The FAB only makes sense where "add a transaction" is actually the
  // page's own task -- Dashboard and Transactions. Breakdown/Admin/Menu
  // still reach it via Admin > Members' own "New Transaction" link (the
  // ?newTransaction query-param watcher below stays mounted regardless of
  // this, so that link keeps working even though the button itself is
  // hidden on that page).
  const showFab = pathname === "/dashboard" || pathname === "/transactions"

  // Everything that doesn't get its own docked tab still lives somewhere
  // -- on the Menu page -- so Menu reads as "active" while browsing any of
  // it, the same way Transactions stays active on a transaction's own
  // pages even though there's no separate "Transactions" sub-route tab.
  const MENU_OWNED_PREFIXES = ["/menu", "/account", "/notifications", "/help", ...(isAdmin ? [] : ["/messages"])]

  const dockItems: DockItem[] = [
    { label: "Dashboard", path: "/dashboard", icon: IconHome },
    { label: "Transactions", path: "/transactions", icon: IconTransactions },
    { label: "Breakdown", path: "/fund-breakdown", icon: IconBreakdown },
    ...(isAdmin
      ? [
          {
            label: "Admin",
            path: "/admin",
            icon: IconAdmin,
            activeWhen: (p: string) => ["/admin", "/messages"].some((prefix) => p === prefix || p.startsWith(prefix + "/"))
          } as DockItem
        ]
      : []),
    {
      label: "Menu",
      path: "/menu",
      icon: IconMenu,
      activeWhen: (p) => MENU_OWNED_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix + "/"))
    }
  ]

  function isActive(item: DockItem) {
    if (item.activeWhen) return item.activeWhen(pathname)
    return pathname === item.path || pathname.startsWith(item.path + "/")
  }

  return (
    <>
      {/* Installed on iOS with statusBarStyle "black-translucent" (see
          layout.tsx), the status bar overlays web content instead of
          reserving its own space -- without this top safe-area padding,
          the clock/signal/battery icons render on top of this bar's own
          content instead of above it. */}
      <nav className="border-b border-hairline bg-paper sticky top-0 z-40" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="flex items-center justify-between px-5 py-4 max-w-3xl mx-auto">
          <button
            onClick={() => router.push("/dashboard")}
            className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono"
          >
            Est. 2017
          </button>
          <div className="flex items-center gap-1">
            <ChatButton />
            <NotificationBell />
          </div>
        </div>
      </nav>

      <nav ref={navRef} hidden={typing} className="fixed inset-x-0 bottom-0 z-40" style={{ paddingBottom: DOCK_OFFSET }}>
          <div className="relative max-w-3xl mx-auto px-4">
            <div
              ref={barRef}
              // No backdrop-blur here -- `backdrop-filter` combined with
              // `position: fixed` is a known WebKit bug on iOS where the
              // element visually detaches and lags behind during momentum
              // scrolling, snapping back into place once scrolling settles.
              // --dock-bg is opaque enough on its own that the blur wasn't
              // adding much.
              className="flex items-stretch bg-(--dock-bg) border border-(--dock-border) rounded-full shadow-(--dock-shadow) p-1.5 dark:px-1.5 dark:py-1"
              // iOS Safari can flicker/hide a `fixed` element mid-touch-drag
              // (e.g. swiping Fund Breakdown's member carousel while this
              // dock sits over a scrollable page) unless it's promoted to
              // its own GPU compositing layer -- translateZ(0) forces that.
              style={{ transform: "translateZ(0)", willChange: "transform" }}
            >
              {dockItems.map((item) => {
                const active = isActive(item)
                const Icon = item.icon
                return (
                  <button
                    key={item.label}
                    onClick={() => router.push(item.path)}
                    className={`flex-1 flex flex-col items-center gap-0.5 py-2 dark:py-1.5 rounded-full transition-colors ${
                      active ? "bg-(--dock-active-bg) text-(--dock-icon-active)" : "text-(--dock-icon)"
                    }`}
                  >
                    <Icon active={active} />
                    <span
                      className={`text-[10px] font-mono ${
                        active ? "text-(--dock-label-active) font-semibold" : "text-(--dock-label)"
                      }`}
                    >
                      {item.label}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Replaces the old header "+ New" button -- floats above the
                pill (rather than beside it) so it reads as the one
                emphasized action, not just another dock tab. Gold is
                already this page's everywhere-accent (active tab, filter
                border, chips), so a gold FAB read as just one more gold
                thing instead of standing out -- bg-ink/text-paper (no gold
                glow or ring, so it stays neutral) mirrors the "primary action" look
                of submit buttons elsewhere in the app. Every entry
                type, admin-only ones included, is reachable from here now --
                Admin > Members' own "New Transaction" link opens this same
                sheet (see the ?newTransaction query-param effect above)
                instead of a separate full-page form. Only rendered on
                Dashboard/Transactions -- see showFab above. */}
            {showFab && (
              <button
                ref={fabRef}
                onClick={() => setSheetOpen(true)}
                aria-label="New Transaction"
                className="absolute right-4 w-14 h-14 rounded-full bg-ink text-paper flex items-center justify-center shadow-lg"
                style={{ bottom: "calc(100% + 0.5rem)", transform: "translateZ(0)", willChange: "transform" }}
              >
                <span className="text-3xl leading-none font-light">+</span>
              </button>
            )}
          </div>
        </nav>

      <Suspense fallback={null}>
        <NewTransactionQueryWatcher onOpen={setSheetOpen} />
      </Suspense>

      {sheetOpen && (
        <NewTransactionSheet
          onClose={() => setSheetOpen(false)}
          onSaved={(saveMessage) => {
            setSheetOpen(false)
            setToast(saveMessage)
            notifyTransactionsChanged()
          }}
        />
      )}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </>
  )
}
