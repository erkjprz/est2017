"use client"

import { useEffect, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

// Full-screen overlays (sheets, toasts) are `position: fixed`, which only
// escapes the viewport correctly if nothing between them and <body> creates
// its own stacking context (e.g. Navbar's `sticky` + `z-index`). Rendering
// into <body> directly via a portal sidesteps that entirely, regardless of
// where in the tree the overlay is triggered from.
export function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect -- document.body only exists in the browser, so the portal renders after mount
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  return createPortal(children, document.body)
}
