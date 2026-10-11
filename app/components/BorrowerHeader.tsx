"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { NotificationBell } from "@/app/components/NotificationBell"
import { ChatButton } from "@/app/components/ChatButton"
import { useTheme } from "@/app/components/ThemeProvider"

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-[21px] h-[21px]">
      <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
    </svg>
  )
}

const APPEARANCE_CYCLE = { system: "light", light: "dark", dark: "system" } as const
const APPEARANCE_LABEL = { system: "🌓 System", light: "☀️ Light", dark: "🌙 Dark" } as const

function MenuDropdown({ onAccount, onPreferences }: { onAccount: boolean; onPreferences: boolean }) {
  const router = useRouter()
  const { preference, setPreference } = useTheme()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handlePointerDown)
    document.addEventListener("touchstart", handlePointerDown)
    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
      document.removeEventListener("touchstart", handlePointerDown)
    }
  }, [open])

  async function logout() {
    await supabase.auth.signOut()
    router.push("/login")
  }

  function go(path: string) {
    setOpen(false)
    router.push(path)
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Menu"
        className="w-9 h-9 flex items-center justify-center text-ink-soft hover:text-ink transition-colors"
      >
        <MenuIcon />
      </button>

      {open && (
        <div className="absolute z-50 right-0 mt-1.5 w-48 border border-hairline rounded-sm bg-paper shadow-lg overflow-hidden">
          {!onAccount && (
            <button
              onClick={() => go("/account")}
              className="w-full text-left px-4 py-2.5 text-sm text-ink-soft hover:text-ink hover:bg-paper-2 transition-colors border-b border-hairline"
            >
              Account
            </button>
          )}
          {!onPreferences && (
            <button
              onClick={() => go("/account/preferences")}
              className="w-full text-left px-4 py-2.5 text-sm text-ink-soft hover:text-ink hover:bg-paper-2 transition-colors border-b border-hairline"
            >
              Preferences
            </button>
          )}
          <button
            onClick={() => go("/help")}
            className="w-full text-left px-4 py-2.5 text-sm text-ink-soft hover:text-ink hover:bg-paper-2 transition-colors border-b border-hairline"
          >
            Help
          </button>
          <button
            onClick={() => setPreference(APPEARANCE_CYCLE[preference])}
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-ink-soft hover:text-ink hover:bg-paper-2 transition-colors border-b border-hairline"
          >
            <span>Appearance</span>
            <span>{APPEARANCE_LABEL[preference]}</span>
          </button>
          <button
            onClick={logout}
            className="w-full text-left px-4 py-2.5 text-sm text-ink-soft hover:text-ink hover:bg-paper-2 transition-colors"
          >
            Sign Out
          </button>
        </div>
      )}
    </div>
  )
}

// Borrower accounts get this instead of the full Navbar -- no dashboard,
// loans list, or "+ New" transaction button, since none of those apply to
// a restricted borrower account. The wordmark goes home (/borrower) --
// previously there was no way back from a page like Help short of the
// browser's own back button. Account/Help/Appearance/Sign Out live behind
// a single Menu button rather than as separate top-bar links -- with the
// notification bell added, spelling all four out here wrapped onto two
// lines on narrow screens, and a fixed-width Menu button scales to however
// many items end up in here later without that happening again.
export default function BorrowerHeader() {
  const router = useRouter()
  const pathname = usePathname()
  const onAccount = pathname === "/account"
  const onPreferences = pathname === "/account/preferences"

  return (
    // Installed on iOS with statusBarStyle "black-translucent" (see
    // layout.tsx), the status bar overlays web content instead of
    // reserving its own space -- without this top safe-area padding, the
    // clock/signal/battery icons render on top of this bar's own content
    // instead of above it.
    <nav className="border-b border-hairline bg-paper sticky top-0 z-40" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="flex items-center justify-between px-5 py-4 max-w-3xl mx-auto">
        <button
          onClick={() => router.push("/borrower")}
          className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono"
        >
          Est. 2017
        </button>
        <div className="flex items-center gap-2">
          <ChatButton />
          <NotificationBell />
          <MenuDropdown onAccount={onAccount} onPreferences={onPreferences} />
        </div>
      </div>
    </nav>
  )
}
