"use client"

import { useEffect, useState } from "react"

// The admin tour (app/components/admin/AdminTour.tsx) is a checklist of
// short mini-tours ("Learn the ropes" on /admin). Each mini-tour -- a run
// -- is a few steps; the checklist ticks it off once finished. Which runs
// are done, and whether the checklist was hidden, are remembered per
// device (localStorage). Help → Admin brings the checklist back.
//
// A run moves across pages, so the step it's on (and which run) lives in
// sessionStorage and its host is mounted once in the root layout. Browser
// storage can be missing or blocked; then the checklist simply shows
// everything as not done yet.
const DONE_KEY = "admin:tour-done"
const HIDDEN_KEY = "admin:tour-hidden"
const STEP_KEY = "admin:tour-step"
const RUN_KEY = "admin:tour-run"
// Fired whenever a run starts, moves or ends, or the checklist changes.
export const ADMIN_TOUR_CHANGE_EVENT = "admin-tour:change"

function changed() {
  window.dispatchEvent(new Event(ADMIN_TOUR_CHANGE_EVENT))
}

export function getDoneRuns(): string[] {
  try {
    const raw = localStorage.getItem(DONE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

export function markRunDone(run: string) {
  try {
    const done = getDoneRuns()
    if (!done.includes(run)) localStorage.setItem(DONE_KEY, JSON.stringify([...done, run]))
  } catch {
    // Nothing to do -- it just shows as not done yet.
  }
  changed()
}

export function isTourChecklistHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === "1"
  } catch {
    return false
  }
}

export function setTourChecklistHidden(hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(HIDDEN_KEY, "1")
    else localStorage.removeItem(HIDDEN_KEY)
  } catch {
    // Nothing to do -- it shows again next visit.
  }
  changed()
}

export function getAdminTourStep(): number | null {
  try {
    const raw = sessionStorage.getItem(STEP_KEY)
    return raw === null ? null : Number(raw)
  } catch {
    return null
  }
}

export function getAdminTourRun(): string | null {
  try {
    return sessionStorage.getItem(RUN_KEY)
  } catch {
    return null
  }
}

export function setAdminTourStep(step: number | null) {
  try {
    if (step === null) {
      sessionStorage.removeItem(STEP_KEY)
      sessionStorage.removeItem(RUN_KEY)
    } else sessionStorage.setItem(STEP_KEY, String(step))
  } catch {
    // The run still goes on on this page; it just won't survive a reload.
  }
  changed()
}

// Starts a run at its first step (the step's index in the tour's list).
export function startAdminTourRun(run: string, firstStep: number) {
  try {
    sessionStorage.setItem(RUN_KEY, run)
  } catch {
    // As above.
  }
  setAdminTourStep(firstStep)
}

// Whether the current step is still waiting for the admin to tap the
// control that leads to it ("via"), or showing the step itself ("show").
// Lets a page hold off what the step reveals -- the tour's review forms --
// until that tap.
let phase: "via" | "show" = "show"

export function getAdminTourPhase() {
  return phase
}

export function setAdminTourPhase(next: "via" | "show") {
  if (next === phase) return
  phase = next
  changed()
}

export function isAdminTourActive(): boolean {
  return getAdminTourStep() !== null
}

// Whether a run is going, for pages that put example items in place while
// it is (see TourExamples) -- so the spotlight has something real-looking
// to land on when, say, nothing is waiting for approval.
export function useAdminTourActive(): boolean {
  const [active, setActive] = useState(false)
  useEffect(() => {
    const update = () => setActive(isAdminTourActive())
    update()
    window.addEventListener(ADMIN_TOUR_CHANGE_EVENT, update)
    return () => window.removeEventListener(ADMIN_TOUR_CHANGE_EVENT, update)
  }, [])
  return active
}
