"use client"

import { useEffect, useState } from "react"

// The admin tour (app/components/admin/AdminTour.tsx) opens by itself the
// first time someone opens /admin on this device, the same per-device
// approach as the lending limits "New" badge (see lib/lendingLimits.ts).
// Help → Admin can replay it any time via /admin?tour=1.
//
// The tour moves across pages, so the step it's on lives in sessionStorage
// and its host is mounted once in the root layout. Browser storage can be
// missing or blocked; then the tour simply offers itself again next visit.
const ADMIN_TOUR_SEEN_KEY = "admin:tour-seen"
const ADMIN_TOUR_STEP_KEY = "admin:tour-step"
// Fired whenever the tour starts, moves, or ends.
export const ADMIN_TOUR_CHANGE_EVENT = "admin-tour:change"

export const ADMIN_TOUR_REPLAY_PATH = "/admin?tour=1"

export function hasSeenAdminTour(): boolean {
  try {
    return localStorage.getItem(ADMIN_TOUR_SEEN_KEY) === "1"
  } catch {
    return false
  }
}

function markAdminTourSeen() {
  try {
    localStorage.setItem(ADMIN_TOUR_SEEN_KEY, "1")
  } catch {
    // Nothing to do -- the tour just offers itself again next time.
  }
}

export function getAdminTourStep(): number | null {
  try {
    const raw = sessionStorage.getItem(ADMIN_TOUR_STEP_KEY)
    return raw === null ? null : Number(raw)
  } catch {
    return null
  }
}

export function setAdminTourStep(step: number | null) {
  try {
    if (step === null) sessionStorage.removeItem(ADMIN_TOUR_STEP_KEY)
    else sessionStorage.setItem(ADMIN_TOUR_STEP_KEY, String(step))
  } catch {
    // The tour still runs on this page; it just won't survive a reload.
  }
  window.dispatchEvent(new Event(ADMIN_TOUR_CHANGE_EVENT))
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
  window.dispatchEvent(new Event(ADMIN_TOUR_CHANGE_EVENT))
}

export function isAdminTourActive(): boolean {
  return getAdminTourStep() !== null
}

// Counts as seen as soon as it starts, so coming back to /admin mid-tour
// (or skipping it) never starts it over.
export function startAdminTour() {
  markAdminTourSeen()
  setAdminTourStep(0)
}

// Whether the tour is running, for pages that put example items in place
// while it is (see TourExamples) -- so the spotlight has something real-
// looking to land on when, say, nothing is waiting for approval.
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
