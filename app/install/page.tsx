"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"

type Platform = "ios" | "android"

// Only used for the illustrative browser-bar mockups below -- a fixed
// label is fine there since it's just showing what a browser address bar
// looks like, not a real link. The real Copy Link/Share URLs are always
// built from window.location so they stay correct if this app is ever
// served from a different domain (a custom domain, a renamed Vercel
// project, etc.) instead of silently pointing at a stale hardcoded one.
const INSTALL_HOST = "est2017.vercel.app"
// APP_PATH is where the walkthrough tells people to actually be (in their
// browser, not this page) when they do the OS-level "Add to Home
// Screen"/"Install app" step -- that's what becomes the installed icon's
// launch URL, especially on iOS Safari, which has no way to set a
// different one after the fact. SHARE_PATH is this page itself: what
// Copy Link/Share hand out, so a first-time recipient sees the
// walkthrough before landing on a bare sign-in form.
const APP_PATH = "/login"
const SHARE_PATH = "/install"

function BrandMark({ size }: { size: "lg" | "md" | "icon" }) {
  if (size === "icon") {
    return <span className="font-display font-bold text-[15px] text-gold">17</span>
  }
  const est = size === "lg" ? "text-[10px]" : "text-[8px]"
  const yr = size === "lg" ? "text-[22px]" : "text-base"
  return (
    <div className="flex flex-col items-center leading-none text-gold">
      <span className={`font-mono uppercase tracking-[0.16em] opacity-80 ${est}`}>Est.</span>
      <span className={`font-display font-bold mt-[3px] ${yr}`}>2017</span>
    </div>
  )
}

function IconBack() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px]">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}
function IconForward() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px]">
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}
function IconShare() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px]">
      <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6" />
    </svg>
  )
}
function IconTabs() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px]">
      <rect x="4" y="4" width="16" height="16" rx="3" />
    </svg>
  )
}
function IconDotsVertical() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  )
}
function IconHome() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px]">
      <path d="M4 11l8-7 8 7v8a2 2 0 01-2 2H6a2 2 0 01-2-2v-8z" />
    </svg>
  )
}

function Phone({ children, notch = true }: { children: React.ReactNode; notch?: boolean }) {
  return (
    <div className="relative w-[200px] h-[408px] rounded-[30px] border-[3px] border-ink bg-paper overflow-hidden shadow-[0_12px_32px_-12px_rgba(0,0,0,0.35)] shrink-0 flex flex-col">
      {notch && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[76px] h-[18px] bg-ink rounded-b-xl z-10" />
      )}
      {children}
    </div>
  )
}

function BrowserBar({
  label,
  action,
  topGap
}: {
  label: string
  action?: React.ReactNode
  topGap?: boolean
}) {
  return (
    <div className={`h-[34px] ${topGap ? "mt-[18px]" : ""} shrink-0 bg-paper-2 border-b border-hairline flex items-center px-2.5 gap-1.5`}>
      <div className="flex-1 h-[18px] bg-paper border border-hairline rounded-[5px] flex items-center px-1.5 text-[8px] text-ink-soft font-mono overflow-hidden whitespace-nowrap">
        {label}
      </div>
      {action}
    </div>
  )
}

const screenVariants = {
  center: "flex flex-col items-center justify-center gap-2.5",
  top: "flex flex-col items-center justify-start pt-7 gap-3.5",
  grid: "grid grid-cols-3 items-start content-start gap-3.5 pt-8"
}

function Screen({
  children,
  variant = "center"
}: {
  children: React.ReactNode
  variant?: keyof typeof screenVariants
}) {
  return (
    <div className={`relative flex-1 bg-paper p-3 ${screenVariants[variant]}`}>
      {children}
    </div>
  )
}

function ToolbarRow({ children, end }: { children: React.ReactNode; end?: boolean }) {
  return (
    <div className={`h-10 shrink-0 border-t border-hairline bg-paper-2 flex items-center ${end ? "justify-end gap-3.5 px-3" : "justify-around px-2"}`}>
      {children}
    </div>
  )
}

function IconSlot({ children, highlight }: { children: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`w-[26px] h-[26px] flex items-center justify-center text-ink ${highlight ? "ring-2 ring-gold rounded-lg animate-pulse" : ""}`}>
      {children}
    </div>
  )
}

function AppCard({
  w,
  h,
  rounded = "rounded-lg",
  highlight,
  children
}: {
  w: number
  h: number
  rounded?: string
  highlight?: boolean
  children?: React.ReactNode
}) {
  return (
    <div
      style={{ width: w, height: h }}
      className={`${rounded} bg-paper-2 border border-hairline flex items-center justify-center ${highlight ? "ring-2 ring-gold animate-pulse" : ""}`}
    >
      {children}
    </div>
  )
}

type Step = { caption: React.ReactNode; render: () => React.ReactNode }

function iosSteps(): Step[] {
  return [
    {
      caption: (
        <>
          Open your Est. 2017 link in <strong className="text-ink">Safari</strong>, then tap the{" "}
          <strong className="text-ink">Share</strong> icon in the bottom toolbar.
        </>
      ),
      render: () => (
        <Phone>
          <BrowserBar topGap label={`${INSTALL_HOST}${APP_PATH}`} />
          <Screen>
            <AppCard w={120} h={74}>
              <BrandMark size="lg" />
            </AppCard>
          </Screen>
          <ToolbarRow>
            <IconSlot><IconBack /></IconSlot>
            <IconSlot><IconForward /></IconSlot>
            <IconSlot highlight><IconShare /></IconSlot>
            <IconSlot><IconTabs /></IconSlot>
          </ToolbarRow>
        </Phone>
      )
    },
    {
      caption: (
        <>
          Scroll the share sheet down and tap <strong className="text-ink">Add to Home Screen</strong>.
        </>
      ),
      render: () => (
        <Phone>
          <BrowserBar topGap label={`${INSTALL_HOST}${APP_PATH}`} />
          <Screen>
            <AppCard w={120} h={74}>
              <BrandMark size="lg" />
            </AppCard>
          </Screen>
          <div className="absolute left-2 right-2 bottom-2 bg-paper border border-hairline rounded-[10px] shadow-[0_-6px_20px_rgba(0,0,0,0.18)] p-2 text-[9px]">
            <div className="flex items-center gap-2 py-[7px] px-1.5 rounded-md text-ink">
              <span className="w-3.5 h-3.5 rounded-[4px] bg-paper-2 border border-hairline shrink-0" />
              Copy
            </div>
            <div className="flex items-center gap-2 py-[7px] px-1.5 rounded-md text-ink">
              <span className="w-3.5 h-3.5 rounded-[4px] bg-paper-2 border border-hairline shrink-0" />
              Add to Reading List
            </div>
            <div className="flex items-center gap-2 py-[7px] px-1.5 rounded-md text-ink bg-gold/15 ring-2 ring-gold animate-pulse">
              <span className="w-3.5 h-3.5 rounded-[4px] bg-paper-2 border border-hairline shrink-0" />
              Add to Home Screen
            </div>
            <div className="flex items-center gap-2 py-[7px] px-1.5 rounded-md text-ink">
              <span className="w-3.5 h-3.5 rounded-[4px] bg-paper-2 border border-hairline shrink-0" />
              Add to Bookmarks
            </div>
          </div>
        </Phone>
      )
    },
    {
      caption: (
        <>
          Keep the name as <strong className="text-ink">Est. 2017</strong> (or rename it), then tap{" "}
          <strong className="text-ink">Add</strong> in the top-right corner.
        </>
      ),
      render: () => (
        <Phone>
          <BrowserBar topGap label="Add to Home Screen" />
          <Screen variant="top">
            <AppCard w={56} h={56}>
              <BrandMark size="md" />
            </AppCard>
            <div className="text-[11px] text-ink-soft">will be added to your home screen.</div>
          </Screen>
          <ToolbarRow end>
            <span className="text-[10px] text-ink-soft">Cancel</span>
            <span className="text-[10px] font-bold text-gold px-2 py-1 ring-2 ring-gold rounded animate-pulse">Add</span>
          </ToolbarRow>
        </Phone>
      )
    },
    {
      caption: (
        <>
          Done. Tap the new <strong className="text-ink">Est. 2017</strong> icon any time — it opens full-screen, no
          browser bar.
        </>
      ),
      render: () => (
        <Phone>
          <Screen variant="grid">
            <AppCard w={44} h={44} rounded="rounded-[11px]" />
            <AppCard w={44} h={44} rounded="rounded-[11px]" highlight>
              <BrandMark size="icon" />
            </AppCard>
            <AppCard w={44} h={44} rounded="rounded-[11px]" />
            <AppCard w={44} h={44} rounded="rounded-[11px]" />
            <AppCard w={44} h={44} rounded="rounded-[11px]" />
            <AppCard w={44} h={44} rounded="rounded-[11px]" />
          </Screen>
        </Phone>
      )
    }
  ]
}

function androidSteps(): Step[] {
  return [
    {
      caption: (
        <>
          Open your Est. 2017 link in <strong className="text-ink">Chrome</strong>, then tap the{" "}
          <strong className="text-ink">⋮ menu</strong> in the top-right corner.
        </>
      ),
      render: () => (
        <Phone notch={false}>
          <BrowserBar label={`${INSTALL_HOST}${APP_PATH}`} action={<IconSlot highlight><IconDotsVertical /></IconSlot>} />
          <Screen>
            <AppCard w={120} h={74}>
              <BrandMark size="lg" />
            </AppCard>
          </Screen>
          <ToolbarRow>
            <IconSlot><IconBack /></IconSlot>
            <IconSlot><IconForward /></IconSlot>
            <IconSlot><IconHome /></IconSlot>
          </ToolbarRow>
        </Phone>
      )
    },
    {
      caption: (
        <>
          Tap <strong className="text-ink">Install app</strong> (some phones say{" "}
          <strong className="text-ink">Add to Home screen</strong>).
        </>
      ),
      render: () => (
        <Phone notch={false}>
          <BrowserBar
            label={`${INSTALL_HOST}${APP_PATH}`}
            action={<IconSlot highlight><IconDotsVertical /></IconSlot>}
          />
          <Screen>
            <AppCard w={120} h={74}>
              <BrandMark size="lg" />
            </AppCard>
          </Screen>
          <div className="absolute top-[26px] right-2 w-[118px] bg-paper border border-hairline rounded-lg shadow-[0_6px_18px_rgba(0,0,0,0.18)] p-[5px] text-[9px]">
            <div className="px-[7px] py-1.5 rounded text-ink">New tab</div>
            <div className="px-[7px] py-1.5 rounded text-ink">Bookmark</div>
            <div className="px-[7px] py-1.5 rounded text-ink font-semibold bg-gold/15 ring-2 ring-gold animate-pulse">Install app</div>
            <div className="px-[7px] py-1.5 rounded text-ink">Share</div>
          </div>
        </Phone>
      )
    },
    {
      caption: (
        <>
          Confirm by tapping <strong className="text-ink">Install</strong> (or <strong className="text-ink">Add</strong>)
          in the pop-up.
        </>
      ),
      render: () => (
        <Phone notch={false}>
          <BrowserBar label="Install app?" />
          <Screen>
            <AppCard w={56} h={56}>
              <BrandMark size="md" />
            </AppCard>
            <div className="text-[11px] text-ink-soft text-center px-2.5">Install this site as an app?</div>
            <div className="flex gap-2.5">
              <span className="text-[10px] text-ink-soft px-2.5 py-1.5">Cancel</span>
              <span className="text-[10px] font-bold text-gold px-2.5 py-1.5 bg-paper-2 rounded-md ring-2 ring-gold animate-pulse">
                Install
              </span>
            </div>
          </Screen>
        </Phone>
      )
    },
    {
      caption: <>Done. Est. 2017 now sits on your home screen and app drawer, opening full-screen.</>,
      render: () => (
        <Phone notch={false}>
          <Screen variant="grid">
            <AppCard w={44} h={44} rounded="rounded-[11px]" />
            <AppCard w={44} h={44} rounded="rounded-[11px]" />
            <AppCard w={44} h={44} rounded="rounded-[11px]" highlight>
              <BrandMark size="icon" />
            </AppCard>
            <AppCard w={44} h={44} rounded="rounded-[11px]" />
            <AppCard w={44} h={44} rounded="rounded-[11px]" />
            <AppCard w={44} h={44} rounded="rounded-[11px]" />
          </Screen>
        </Phone>
      )
    }
  ]
}

const AUTOPLAY_MS = 2600

// Shared by both the top (getting yourself set up) and bottom (bringing
// someone else in) sections, so the two never drift out of sync.
function ShareBar({
  host,
  copied,
  canShare,
  onCopy,
  onShare
}: {
  host: string
  copied: boolean
  canShare: boolean
  onCopy: () => void
  onShare: () => void
}) {
  return (
    <div className="flex items-center gap-2 card pl-3.5 pr-1.5 py-1.5">
      <span className="flex-1 font-mono text-[13px] overflow-x-auto whitespace-nowrap">
        {host}
        {SHARE_PATH}
      </span>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={onCopy}
          className={`shrink-0 border rounded-md text-[12.5px] font-semibold px-3.5 py-2 min-h-10 transition-colors ${
            copied ? "text-gold border-gold" : "text-ink border-hairline bg-paper"
          }`}
        >
          {copied ? "Copied" : "Copy link"}
        </button>
        {canShare && (
          <button
            onClick={onShare}
            aria-label="Share link"
            className="shrink-0 border border-hairline bg-paper text-ink rounded-md px-3 py-2 min-h-10 flex items-center justify-center"
          >
            <IconShare />
          </button>
        )}
      </div>
    </div>
  )
}

export default function InstallPage() {
  const [platform, setPlatform] = useState<Platform>("ios")
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [copied, setCopied] = useState(false)
  const [canShare, setCanShare] = useState(false)
  // Defaults to INSTALL_HOST for the first paint (matches the illustrative
  // mockups) and corrects to the real host once mounted -- window.location
  // isn't available during SSR.
  const [host, setHost] = useState(INSTALL_HOST)
  const touchStartX = useRef<number | null>(null)

  const steps = platform === "ios" ? iosSteps() : androidSteps()

  useEffect(() => {
    const ua = navigator.userAgent || ""
    // eslint-disable-next-line react-hooks/set-state-in-effect -- navigator and window.location are only readable after hydration
    setPlatform(/android/i.test(ua) ? "android" : "ios")
    setCanShare(typeof navigator.share === "function")
    setHost(window.location.host)
  }, [])

  useEffect(() => {
    if (!playing) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const id = setInterval(() => {
      setStep((i) => (i + 1) % steps.length)
    }, AUTOPLAY_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, platform])

  function choosePlatform(p: Platform) {
    setPlatform(p)
    setStep(0)
  }

  function goTo(i: number) {
    setPlaying(false)
    setStep(Math.max(0, Math.min(steps.length - 1, i)))
  }

  async function copyLink() {
    const text = `${window.location.origin}${SHARE_PATH}`
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement("textarea")
      ta.value = text
      ta.style.position = "fixed"
      ta.style.opacity = "0"
      document.body.appendChild(ta)
      ta.select()
      document.execCommand("copy")
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  async function shareLink() {
    const url = `${window.location.origin}${SHARE_PATH}`
    try {
      await navigator.share({
        title: "Est. 2017",
        text: "Join Est. 2017 -- tap to sign up and add it to your home screen.",
        url
      })
    } catch {
      // User cancelled the share sheet, or the browser rejected it -- either
      // way there's nothing to recover, "Copy link" is right there instead.
    }
  }

  return (
    <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
      <div className="max-w-xl mx-auto px-5 pt-10 pb-24">
        <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">Getting set up</div>
        <h1 className="font-display text-4xl font-semibold text-balance">Add Est. 2017 to your home screen</h1>
        <p className="text-sm text-ink-soft mt-3 max-w-md">
          Est. 2017 isn&apos;t in the App Store — it installs straight from the link, in a few taps. Once it&apos;s
          added, it opens full-screen like any other app, with its own icon.
        </p>

        <div className="mt-6 flex card p-[3px]">
          {(["ios", "android"] as Platform[]).map((p) => (
            <button
              key={p}
              onClick={() => choosePlatform(p)}
              className={`flex-1 py-2.5 rounded-[6px] text-sm font-semibold transition-colors ${
                platform === p ? "bg-paper text-ink shadow-sm" : "text-ink-soft"
              }`}
            >
              {p === "ios" ? "iPhone · Safari" : "Android · Chrome"}
            </button>
          ))}
        </div>

        <div
          className="mt-2 overflow-hidden rounded-2xl"
          onTouchStart={(e) => {
            touchStartX.current = e.touches[0].clientX
          }}
          onTouchEnd={(e) => {
            if (touchStartX.current === null) return
            const dx = e.changedTouches[0].clientX - touchStartX.current
            touchStartX.current = null
            if (Math.abs(dx) < 32) return
            setPlaying(false)
            setStep((i) => Math.max(0, Math.min(steps.length - 1, dx < 0 ? i + 1 : i - 1)))
          }}
        >
          <div
            className="flex transition-transform duration-500 ease-[cubic-bezier(0.65,0.05,0.24,1)] will-change-transform motion-reduce:transition-none"
            style={{ transform: `translateX(-${step * 100}%)` }}
          >
            {steps.map((s, i) => (
              <div key={i} className="flex-none w-full flex flex-col items-center px-4 pt-7 pb-5">
                {s.render()}
                <div className="mt-[18px] text-center max-w-[280px]">
                  <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-gold mb-1.5">
                    Step {i + 1} of {steps.length}
                  </div>
                  <p className="text-[14.5px] leading-relaxed">{s.caption}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-center gap-[18px] mt-5">
          <button
            onClick={() => goTo(step - 1)}
            disabled={step === 0}
            aria-label="Previous step"
            className="w-12 h-12 rounded-full border border-hairline bg-paper-2 text-ink text-lg flex items-center justify-center disabled:opacity-35"
          >
            ‹
          </button>
          <div className="flex gap-1">
            {steps.map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                aria-label={`Go to step ${i + 1}`}
                className="w-8 h-8 flex items-center justify-center"
              >
                <span className={`block rounded-full transition-all ${i === step ? "w-4 h-1.5 rounded-[3px] bg-gold" : "w-1.5 h-1.5 bg-hairline"}`} />
              </button>
            ))}
          </div>
          <button
            onClick={() => goTo(step + 1)}
            disabled={step === steps.length - 1}
            aria-label="Next step"
            className="w-12 h-12 rounded-full border border-hairline bg-paper-2 text-ink text-lg flex items-center justify-center disabled:opacity-35"
          >
            ›
          </button>
        </div>

        <button
          onClick={() => setPlaying((p) => !p)}
          className="block mx-auto mt-[18px] text-[12px] font-mono tracking-wide text-ink-soft underline underline-offset-[3px]"
        >
          {playing ? "❚❚ pause" : "▶ play steps automatically"}
        </button>

        {/* Now that they've seen how, send them to the page the steps
            actually walk through -- also where "Add to Home Screen" needs
            to happen from, since that's what becomes the installed icon's
            launch URL. */}
        <Link
          href={APP_PATH}
          className="block text-center mt-8 bg-gold-soft text-ink rounded-md py-3.5 text-sm font-bold"
        >
          Continue to Sign In →
        </Link>

        <div className="mt-10 border-t border-hairline pt-6">
          <h2 className="font-display text-lg font-semibold">Bringing someone else in?</h2>
          <p className="text-sm text-ink-soft leading-relaxed mt-2 mb-4 max-w-[52ch]">
            Send them this same link so they see this walkthrough too, instead of landing cold on the sign-in
            screen.
          </p>
          <ShareBar host={host} copied={copied} canShare={canShare} onCopy={copyLink} onShare={shareLink} />
        </div>
      </div>
    </main>
  )
}
