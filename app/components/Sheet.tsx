"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Portal } from "@/app/components/Portal"

// Generic bottom sheet -- backdrop + slide-up panel, mounted closed and
// opened a tick later so the transform actually has a starting point to
// animate away from (otherwise the browser paints it already-open and
// there's nothing to transition). The × button plays the slide-down-then-
// unmount transition; a child's own action (e.g. a form's Submit) closes
// by calling onClose directly instead, so it just disappears immediately
// rather than replaying this animation.
//
// Backdrop tap-to-dismiss uses a pointerdown/pointerup distance guard,
// not a plain onClick -- a swipe-down that starts on the backdrop (or
// scroll-chains into it from this sheet's own content, see that div's
// own comment) can otherwise register as a "tap" on release even though
// real movement happened, silently closing the sheet and discarding
// whatever was filled in. Real belt-and-suspenders: iOS Safari's
// overscroll containment at a `position: fixed` overlay's edges still
// isn't reliable enough to trust blindly.
export function Sheet({
  title,
  onClose,
  children,
  footer
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  // Drives the panel's actual bottom offset and max-height off
  // visualViewport instead of trusting `bottom: 0` + `max-h-[92dvh]` alone
  // -- the "known remaining gap" the body-lock effect below used to just
  // document: iOS keeps a `position: fixed` element's `bottom: 0` pinned to
  // the LAYOUT viewport, which doesn't shrink when the on-screen keyboard
  // opens, so the panel's true bottom edge ends up under the keyboard
  // (invisible) while `dvh` doesn't reliably shrink to compensate either in
  // an installed home-screen app. visualViewport.height does shrink
  // correctly when the keyboard opens, and .offsetTop catches the rarer
  // case where the visual viewport itself has scrolled away from the
  // layout viewport's top. keyboardInset (in px) is how far up the panel's
  // bottom edge needs to lift to clear whatever's currently covering the
  // bottom of the screen; maxHeight is recomputed against the real visible
  // height so the panel's top edge never gets pushed up past it either.
  const [viewportMetrics, setViewportMetrics] = useState<{ height: number; keyboardInset: number } | null>(null)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    function update() {
      setViewportMetrics({
        height: vv!.height,
        keyboardInset: Math.max(0, window.innerHeight - vv!.height - vv!.offsetTop)
      })
    }

    update()
    vv.addEventListener("resize", update)
    vv.addEventListener("scroll", update)
    return () => {
      vv.removeEventListener("resize", update)
      vv.removeEventListener("scroll", update)
    }
  }, [])

  // A Sheet mounts fresh on every open, not behind a route change --
  // Navbar's own page-level scroll-nudge (see its file comment on the
  // same iOS bug) only fires on navigation/resume, so it doesn't
  // necessarily run again for a sheet opened via local state mid-session.
  // Nudging here too forces iOS to recompute this sheet's own
  // `position: fixed` layout against the real current viewport. Declared
  // (and so committed) before the visualViewport measurement below, so
  // that measurement reads the just-nudged layout instead of racing it.
  // Has to run before the body-lock effect further down sets `overflow:
  // hidden`, or there's nothing left to actually scroll.
  //
  // Nudges by 1px around wherever the page already was, not a hardcoded
  // (0, 0) -- unlike Navbar's own nudge, which only ever fires on a real
  // navigation (where jumping to the top is the expected behavior
  // anyway), a Sheet opens *in place* over whatever page is already
  // showing (tapping Edit three screens down a transaction list, say),
  // and has no business moving that page's scroll position at all -- it
  // just needs *an* actual scroll event to fire, wherever that happens.
  useEffect(() => {
    const y = window.scrollY
    window.scrollTo(0, y + 1)
    window.scrollTo(0, y)
  }, [])

  // Locks the page behind the sheet from scrolling while it's open --
  // overflow:hidden alone can still let a touch-drag on the backdrop
  // chain into scrolling the page underneath on iOS Safari, so
  // overscroll-behavior:none backs it up. Deliberately NOT `position:
  // fixed`: setting the page root to position:fixed while the sheet is
  // open (tried on both document.body and document.documentElement)
  // makes WebKit recompute a visualViewport ~59px shorter than the real
  // screen in the installed home-screen app -- confirmed on-device on
  // both elements. A sibling app's own sheet never touches the page
  // root's position at all and never had the bug.
  //
  // Known remaining gap: iOS's native "scroll the focused input into
  // view" behavior can still scroll the page behind the sheet when a
  // text field inside it gets focus -- overflow:hidden doesn't reliably
  // block that specific behavior the way position:fixed used to (as a
  // side effect, at the cost of the viewport bug above). Toast.tsx was
  // moved to a top anchor to keep that glitch from landing right where
  // a bottom-anchored toast used to appear; the underlying scroll-on-
  // focus behavior itself is still open.
  //
  // Each Sheet captures/restores whatever was already on body/html when
  // it mounted, not a hardcoded default, so this nests correctly when a
  // picker sheet (loan, type) opens on top of this one -- the inner
  // one's cleanup just hands back the outer one's own locked state.
  //
  // Locks <html> too, not just <body> -- reported still closing (and the
  // whole app appearing to reload) on a plain swipe-down even after the
  // backdrop lost every dismiss handler it had, which points at iOS
  // Safari's native pull-to-refresh firing instead of anything in this
  // component: that gesture is governed by the root scrolling element's
  // own overscroll behavior, and which element WebKit treats as "root"
  // for that purpose hasn't been consistent all session (the position:
  // fixed viewport bug above needed checking on both body and
  // documentElement too). globals.css already sets overscroll-behavior-y:
  // contain on body permanently; this locks both elements harder while a
  // sheet is open specifically, on top of that.
  useEffect(() => {
    const body = document.body
    const html = document.documentElement
    const previous = {
      bodyOverflow: body.style.overflow,
      bodyOverscrollBehavior: body.style.overscrollBehavior,
      htmlOverflow: html.style.overflow,
      htmlOverscrollBehavior: html.style.overscrollBehavior
    }

    body.style.overflow = "hidden"
    body.style.overscrollBehavior = "none"
    html.style.overflow = "hidden"
    html.style.overscrollBehavior = "none"

    return () => {
      body.style.overflow = previous.bodyOverflow
      body.style.overscrollBehavior = previous.bodyOverscrollBehavior
      html.style.overflow = previous.htmlOverflow
      html.style.overscrollBehavior = previous.htmlOverscrollBehavior
    }
  }, [])

  // Keeps whichever field was just tapped visible above the keyboard,
  // instead of making the user scroll down to find it. When the keyboard
  // opens, the panel above lifts and shrinks (viewportMetrics), which
  // leaves a lower field like Notes hidden under the footer's Submit
  // button. Scrolls only this sheet's own content div, by hand, rather
  // than calling scrollIntoView -- that also scrolls every ancestor,
  // including the locked page behind the sheet, which is exactly the
  // iOS scroll-on-focus glitch the body-lock comment below describes.
  // Reveals the field's wrapper when it's small (so a helper line under
  // an input stays in view too), else just the field itself.
  const scrollRef = useRef<HTMLDivElement>(null)

  function revealFocusedField() {
    const container = scrollRef.current
    const field = document.activeElement
    if (!container || !(field instanceof HTMLElement) || !container.contains(field)) return
    if (!field.matches("input, textarea, select, [contenteditable='true']")) return

    const box = container.getBoundingClientRect()
    const wrapper = field.parentElement
    const target =
      wrapper && wrapper !== container && wrapper.getBoundingClientRect().height < box.height / 2 ? wrapper : field
    const rect = target.getBoundingClientRect()
    const margin = 16

    let delta = 0
    if (rect.bottom > box.bottom - margin) delta = rect.bottom - box.bottom + margin
    else if (rect.top < box.top + margin) delta = rect.top - box.top - margin
    if (delta !== 0) container.scrollBy({ top: delta, behavior: "smooth" })
  }

  // Re-run once the keyboard has actually finished resizing the panel --
  // on the first tap the field's focus lands before visualViewport
  // shrinks, so measuring at focus time alone would see a panel that
  // still has room. The double rAF lets the new bottom/maxHeight commit
  // and lay out first.
  useEffect(() => {
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(revealFocusedField)
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [viewportMetrics])

  function handleClose() {
    setOpen(false)
    setTimeout(onClose, 200)
  }

  const backdropPointerStart = useRef<{ x: number; y: number } | null>(null)

  function handleBackdropPointerDown(e: React.PointerEvent) {
    backdropPointerStart.current = { x: e.clientX, y: e.clientY }
  }

  function handleBackdropPointerUp(e: React.PointerEvent) {
    const start = backdropPointerStart.current
    backdropPointerStart.current = null
    if (!start) return
    const movedTooFar = Math.abs(e.clientX - start.x) > 10 || Math.abs(e.clientY - start.y) > 10
    if (!movedTooFar) handleClose()
  }

  return (
    <Portal>
      {/* Its own full-screen fixed layer, not a wrapper the panel sits
          inside of -- a bottom sheet used to be structured as a full-
          height `fixed` wrapper with the panel `absolute bottom:0`
          inside it, but nesting it that way meant the panel's floor was
          always wherever the wrapper's own bottom edge landed, which was
          short of the real screen in the installed home-screen app. No
          backdrop-blur -- `backdrop-filter` combined with `position:
          fixed` is a known WebKit bug on iOS (confirmed on a sibling
          app's bottom nav, same combination) where the element's
          compositing goes wrong, independent of its actual DOM box --
          layout stays correct but the paint doesn't. bg-black/80 is opaque
          enough on its own. */}
      <div
        // pointer-events-none once closing: if the parent is slow to
        // unmount this sheet after onClose, an invisible backdrop must not
        // keep swallowing every tap on the page underneath.
        className={`fixed inset-0 z-50 bg-black/80 transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onPointerDown={handleBackdropPointerDown}
        onPointerUp={handleBackdropPointerUp}
      />
      {/* Its own independent `position: fixed; bottom: 0` element, not
          `absolute` inside a full-height wrapper -- see the comment on
          the backdrop above. */}
      {/* data-sheet: lets the admin tour tell a target inside a sheet. */}
      <div
        data-sheet=""
        className={`fixed left-0 right-0 bottom-0 z-50 max-h-[92dvh] flex flex-col bg-(--sheet-bg) border-t border-hairline rounded-t-2xl overflow-hidden shadow-xl transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
        style={
          viewportMetrics
            ? { bottom: viewportMetrics.keyboardInset, maxHeight: viewportMetrics.height * 0.92 }
            : undefined
        }
      >
        <div className="w-9 h-1 rounded-full bg-hairline mx-auto mt-2.5 flex-shrink-0" />
        <div className="relative flex items-center justify-center px-4 pt-3 pb-4 flex-shrink-0">
          <h2 className="font-display text-lg font-medium text-ink">{title}</h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="absolute right-4 w-8 h-8 rounded-full bg-ink text-paper flex items-center justify-center text-lg leading-none"
          >
            ×
          </button>
        </div>
        {/* overscroll-contain stops scroll chaining: without it, dragging
            past the top/bottom of this list on a touch device hands the
            rest of the gesture to whatever's behind it (the backdrop, the
            locked page), which iOS Safari doesn't always keep contained
            here even with this in place -- the backdrop's own pointer-
            distance guard is what actually keeps that from closing the
            sheet. min-h-0 is
            load-bearing here, not decorative -- a flex child with
            overflow-y-auto defaults its minimum height to its own
            content size (a WebKit quirk), not 0, which can push this
            panel's flex column past its own max-height cap and squeeze
            the footer below out from under `overflow-hidden` on the
            panel, clipping the Submit/Save button even though the
            numbers on paper say everything should fit. */}
        <div
          ref={scrollRef}
          onFocus={() => requestAnimationFrame(revealFocusedField)}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-4"
        >
          {children}
        </div>
        {footer && (
          <div
            className="px-4 pt-3 flex-shrink-0 border-t border-hairline"
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
            {footer}
          </div>
        )}
      </div>
    </Portal>
  )
}
