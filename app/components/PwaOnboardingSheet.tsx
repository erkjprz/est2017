"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { Sheet } from "@/app/components/Sheet"
import { useAuth } from "@/app/auth-context"
import { hasSeenAdminTour } from "@/lib/adminTour"
import { isPushSupported, subscribeToPush } from "@/lib/push"
import {
  type OnboardingStep,
  clearDeferredPrompt,
  getDeferredPrompt,
  isIOS,
  isSnoozed,
  isStandalone,
  snooze,
  subscribeToInstallState,
  wasInstalledThisSession
} from "@/lib/pwa"

// Pages where a member isn't really "in" the app yet (or /install, which is
// already the long-form version of this same walkthrough).
const HIDDEN_ON = ["/", "/login", "/signup", "/install", "/waiting", "/forgot-password", "/reset-password"]

// Long enough that the sheet never lands on top of the page's own first
// paint/skeleton -- it's an aside, not the first thing anyone sees.
const SHOW_DELAY_MS = 3000

function isInstalled() {
  return isStandalone() || wasInstalledThisSession()
}

function canOfferNotifications() {
  return (
    isPushSupported() &&
    typeof Notification !== "undefined" &&
    Notification.permission === "default" &&
    (isInstalled() || browserCannotInstall())
  )
}

// A plain browser tab only gets the notifications step where install isn't
// a thing at all (Firefox, desktop Safari). Chromium fires
// beforeinstallprompt whenever it decides to -- often well after the
// sheet's own delay -- so "no prompt yet" there doesn't mean "can't
// install", and offering notifications in the meantime would skip the
// install step. iOS is excluded too: it only exposes Web Push to the
// installed home-screen app.
function browserCannotInstall() {
  return !isIOS() && !("onbeforeinstallprompt" in window)
}

function canOfferInstall() {
  return !isInstalled() && (getDeferredPrompt() !== null || isIOS())
}

function pickStep(): OnboardingStep | null {
  // While install is still on the table, it's the only thing offered --
  // notifications come after it, so snoozing install snoozes the whole
  // sheet rather than skipping ahead.
  if (canOfferInstall()) return isSnoozed("install") ? null : "install"
  if (canOfferNotifications() && !isSnoozed("notify")) return "notify"
  return null
}

function IconShare() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="inline w-4 h-4 -mt-0.5 text-gold" aria-hidden="true">
      <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6" />
    </svg>
  )
}

export function PwaOnboardingSheet() {
  const { loading, member } = useAuth()
  const pathname = usePathname()
  const [step, setStep] = useState<OnboardingStep | null>(null)
  // Whether this run of the sheet began on the install step -- the progress
  // dots only mean something when there's more than one step to show.
  const [startedAtInstall, setStartedAtInstall] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const eligible = !loading && member?.status === "approved" && !HIDDEN_ON.includes(pathname)

  useEffect(() => {
    if (!eligible || step) return

    function evaluate() {
      // A new admin's first /admin visit opens the admin tour sheet --
      // don't stack this one on top of it.
      if (pathname === "/admin" && !hasSeenAdminTour()) return
      const next = pickStep()
      if (!next) return
      setStartedAtInstall(next === "install")
      setStep(next)
    }

    const timer = setTimeout(evaluate, SHOW_DELAY_MS)
    // beforeinstallprompt can arrive well after load (Chrome waits on its
    // own engagement checks), so re-check whenever install state changes.
    const unsubscribe = subscribeToInstallState(evaluate)
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [eligible, step, pathname])

  // A successful install (from this sheet's own button, or Chrome's own
  // omnibox/menu entry) moves straight on to notifications.
  useEffect(() => {
    if (step !== "install") return
    return subscribeToInstallState(() => {
      if (!wasInstalledThisSession()) return
      setStep(canOfferNotifications() ? "notify" : null)
    })
  }, [step])

  if (!eligible || !step || !member) return null

  const showIOSInstructions = step === "install" && !getDeferredPrompt() && isIOS()

  function dismiss() {
    if (step) snooze(step)
    setStep(null)
    setError("")
  }

  async function handlePrimary() {
    if (step === "install") {
      const prompt = getDeferredPrompt()
      if (!prompt) {
        // iOS: nothing to trigger -- the instructions were the whole step.
        dismiss()
        return
      }
      await prompt.prompt()
      const { outcome } = await prompt.userChoice
      clearDeferredPrompt()
      if (outcome === "accepted") {
        // appinstalled usually lands after userChoice resolves, and the
        // effect above advances the step when it does -- but it can also
        // land first, in which case that listener already missed it.
        if (wasInstalledThisSession()) setStep(canOfferNotifications() ? "notify" : null)
        return
      }
      dismiss()
      return
    }

    setBusy(true)
    setError("")
    try {
      await subscribeToPush(member!.member_id)
      setStep(null)
      const registration = await navigator.serviceWorker.ready
      registration.showNotification("You're all set", {
        body: "Alerts are on for this device.",
        icon: "/icons/icon-192.png"
      })
    } catch (err) {
      if (typeof Notification !== "undefined" && Notification.permission === "denied") {
        // Declined at the browser prompt -- nothing left for this sheet to
        // offer; the Notifications page explains how to undo it.
        setStep(null)
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong.")
      }
    } finally {
      setBusy(false)
    }
  }

  const title = step === "install" ? "Install Est. 2017" : "Stay in the loop"
  const primaryLabel = step === "notify" ? (busy ? "Turning on…" : "Turn on alerts") : showIOSInstructions ? "Got it" : "Install app"

  return (
    <Sheet
      title={title}
      onClose={dismiss}
      footer={
        <>
          {error && <p className="text-sm text-rust mb-3">{error}</p>}
          <div className="flex items-center gap-3 font-sans">
            <button
              type="button"
              onClick={dismiss}
              className="shrink-0 border border-hairline text-ink-soft px-5 py-3.5 rounded-full text-base font-semibold"
            >
              Not now
            </button>
            <button
              type="button"
              onClick={handlePrimary}
              disabled={busy}
              className="flex-1 whitespace-nowrap bg-ink text-paper px-6 py-3.5 rounded-full text-base font-bold shadow-lg motion-safe:transition-transform motion-safe:active:scale-[0.97] disabled:opacity-50 disabled:shadow-none"
            >
              {primaryLabel}
            </button>
          </div>
        </>
      }
    >
      {/* Sheet portals into <body>, outside any page's own font-sans. */}
      <div className="font-sans">
        {startedAtInstall && (
          <div className="flex justify-center gap-1.5 mb-4" aria-hidden="true">
            <span className={`w-1.5 h-1.5 rounded-full ${step === "install" ? "bg-gold" : "bg-hairline"}`} />
            <span className={`w-1.5 h-1.5 rounded-full ${step === "notify" ? "bg-gold" : "bg-hairline"}`} />
          </div>
        )}

        <p className="text-[15px] leading-relaxed text-ink-soft text-center">
          {step === "install"
            ? "Open it straight from your home screen, full-screen, like any other app."
            : "Get an alert on this device when something needs your attention, like a transaction being reviewed. You can change this any time in Notifications."}
        </p>

        {showIOSInstructions && (
          <ol className="mt-4 bg-paper border border-hairline rounded-md px-4 py-3 space-y-1.5 text-[15px] text-ink list-decimal list-inside">
            <li>
              Tap <IconShare /> <span className="font-semibold">Share</span>{" "}
              in Safari&apos;s toolbar
            </li>
            <li>
              Choose <span className="font-semibold">Add to Home Screen</span>
            </li>
            <li>Open Est. 2017 from your home screen</li>
          </ol>
        )}
      </div>
    </Sheet>
  )
}
