"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/app/auth-context"
import { supabase } from "@/lib/supabase"
import { listConversations } from "@/lib/conversations"
import { readCache, writeCache } from "@/lib/cache"
import { useHydrated } from "@/lib/useHydrated"

// Header shortcut to /messages, sitting beside NotificationBell -- chat was
// otherwise only reachable from the Menu page / dropdown, which made it
// easy to miss. Badged with the number of unread conversations, cached the
// same way the bell's count is so it doesn't flicker on every navigation
// (the header remounts per page). The bell leaves 'message' notifications
// out of its own count so a new message isn't badged twice.
export function ChatButton() {
  const router = useRouter()
  const pathname = usePathname()
  const { member } = useAuth()
  const cacheKey = member ? `chat-badge:${member.member_id}` : null
  // member comes from a browser-only cache, so the server never renders
  // this button -- wait for hydration (like NotificationBell) so the first
  // client render matches the server HTML instead of tripping React #418.
  const hydrated = useHydrated()
  const [unreadCount, setUnreadCount] = useState(() => (cacheKey ? readCache<number>(cacheKey) ?? 0 : 0))

  useEffect(() => {
    if (!member || member.status !== "approved") return
    const memberId = member.member_id
    let cancelled = false

    function loadCount() {
      listConversations().then(({ data }) => {
        if (cancelled || !data) return
        const next = data.filter((c) => c.unread).length
        setUnreadCount(next)
        writeCache(`chat-badge:${memberId}`, next)
      })
    }

    loadCount()

    // Every new chat message also creates a 'message' notification for its
    // recipients, so listening there keeps this badge live (e.g. an admin
    // replies while you're on another page) without a separate realtime
    // feed on the conversation tables.
    const channel = supabase
      .channel(`chat-badge-${memberId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `member_id=eq.${memberId}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as { type?: string } | undefined
          if (!row?.type || row.type === "message") loadCount()
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
    // pathname: re-count after leaving a thread, which marks it read.
  }, [member, pathname])

  if (!member || !hydrated) return null

  return (
    <button
      onClick={() => router.push("/messages")}
      aria-label={unreadCount > 0 ? `Chat (${unreadCount} unread)` : "Chat"}
      className="relative w-9 h-9 flex items-center justify-center text-ink-soft hover:text-ink transition-colors"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-[21px] h-[21px]">
        <path
          d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {unreadCount > 0 && (
        <span className="absolute top-0.5 right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-rust text-paper text-[10px] font-mono font-bold flex items-center justify-center">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </button>
  )
}
