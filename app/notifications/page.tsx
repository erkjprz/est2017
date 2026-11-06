"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import BorrowerHeader from "@/app/components/BorrowerHeader"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"
import { PushNotificationsCard } from "@/app/components/PushNotificationsCard"
import { readCache, writeCache } from "@/lib/cache"

type Notification = {
  id: string
  type: string
  title: string
  body: string
  link: string | null
  read: boolean
  created_at: string
}

export default function NotificationsPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()
  const cacheKey = member ? `notifications:${member.member_id}` : null
  const cached = cacheKey ? readCache<Notification[]>(cacheKey) : undefined

  // Paints instantly from the last time this member's notifications loaded,
  // before the browser ever shows a frame -- load() below still runs right
  // after and replaces it with a fresh fetch, so a stale cache never
  // lingers past that first moment.
  const [dataLoading, setDataLoading] = useState(!cached)
  const [notifications, setNotifications] = useState<Notification[]>(cached ?? [])
  const [loadError, setLoadError] = useState("")
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    if (authLoading) return
    if (!member) {
      router.push("/login")
      return
    }
    if (member.status !== "approved") {
      router.push("/waiting")
      return
    }

    async function load() {
      const key = `notifications:${member!.member_id}`

      // Only show the blocking loader on a true cold start -- if we already
      // rendered cached data, refresh quietly behind it instead of flashing
      // back to a spinner on every navigation.
      if (!readCache(key)) setDataLoading(true)

      const { data, error } = await supabase
        .from("notifications")
        .select("id, type, title, body, link, read, created_at")
        .eq("member_id", member!.member_id)
        .order("created_at", { ascending: false })
        .limit(100)

      if (error) {
        setLoadError(error.message)
        setDataLoading(false)
        return
      }

      setNotifications(data ?? [])
      setDataLoading(false)
      writeCache(key, data ?? [])

      const unreadIds = (data ?? []).filter((n) => !n.read).map((n) => n.id)
      if (unreadIds.length > 0) {
        await supabase.from("notifications").update({ read: true }).in("id", unreadIds)
      }
    }

    load()
  }, [authLoading, member, router])

  function openNotification(n: Notification) {
    if (n.link) router.push(n.link)
  }

  async function clearAll() {
    if (clearing || !member) return
    setClearing(true)
    const { error } = await supabase.from("notifications").delete().eq("member_id", member.member_id)
    setClearing(false)
    if (!error) {
      setNotifications([])
      writeCache(`notifications:${member.member_id}`, [])
    }
  }

  const isBorrower = member?.role === "borrower"
  const Header = isBorrower ? BorrowerHeader : Navbar

  if (authLoading || !member || member.status !== "approved" || dataLoading) {
    return (
      <>
        <Header />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(3rem+var(--dock-h)+env(safe-area-inset-bottom))]">
            <SkeletonPanel />
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Header />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(3rem+var(--dock-h)+env(safe-area-inset-bottom))]">
          <button
            onClick={() => router.push(isBorrower ? "/borrower" : "/menu")}
            className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors"
          >
            {isBorrower ? "← Your Loan" : "← Menu"}
          </button>

          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">Activity</div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-1">Notifications</h1>
          <p className="text-[13px] text-ink-soft mb-6">Everything Est. 2017 has sent you, newest first.</p>

          <div className="mb-6">
            <PushNotificationsCard memberId={member.member_id} />
          </div>

          {loadError && <p className="text-sm text-rust mb-4">Couldn&apos;t load notifications: {loadError}</p>}

          {!loadError && notifications.length === 0 && (
            <p className="text-sm text-ink-soft text-center py-12 card">
              Nothing yet.
            </p>
          )}

          {notifications.length > 0 && (
            <div className="flex justify-end mb-2">
              <button
                onClick={clearAll}
                disabled={clearing}
                className="text-[13px] text-ink-soft hover:text-ink transition-colors disabled:opacity-60"
              >
                {clearing ? "Clearing..." : "Clear All"}
              </button>
            </div>
          )}

          {notifications.length > 0 && (
            <div className="card divide-y divide-hairline">
              {notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openNotification(n)}
                  disabled={!n.link}
                  className="w-full text-left px-5 py-3.5 flex items-start gap-3 disabled:cursor-default"
                >
                  {!n.read && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-gold shrink-0" />}
                  <div className={n.read ? "flex-1 min-w-0 ml-[18px]" : "flex-1 min-w-0"}>
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-ink truncate">{n.title}</p>
                      <span className="text-[11px] text-ink-soft font-mono shrink-0">
                        {new Date(n.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    </div>
                    <p className="text-[13px] text-ink-soft mt-0.5">{n.body}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  )
}
