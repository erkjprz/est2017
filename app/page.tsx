"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/app/auth-context"
import { SplashScreen } from "@/app/components/SplashScreen"
import { warmDashboardCache } from "@/lib/dashboardSnapshot"
import { warmLoansCache } from "@/lib/useLoansSummary"
import { warmTransactionsCache } from "@/lib/transactionsSnapshot"
import { warmGroupBreakdownCache } from "@/lib/fundBreakdownGroup"

// A slow connection shouldn't strand anyone on the splash indefinitely --
// give the destination's data this long to warm, then move on regardless.
// The destination page's own stale-while-revalidate cache/fetch takes it
// from there either way, warm or not.
const WARM_UP_TIMEOUT_MS = 4000

// ServiceWorkerRegister's deploy-refresh sends the member here with the page
// they were on as ?next=, so the update shows this splash instead of a blank
// reload and still lands them back where they were. Only same-origin paths
// are honored -- never "//host" or a full URL.
function nextPath(): string | null {
  const next = new URLSearchParams(window.location.search).get("next")
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null
  return next
}

export default function Home() {
  const router = useRouter()
  const { loading, user, member } = useAuth()
  const started = useRef(false)

  useEffect(() => {
    if (loading || started.current) return
    started.current = true

    // A signup confirmation link that failed (expired, already used) lands
    // here with the reason in the hash -- carry it to /login, which explains
    // it, instead of dropping it on a silent redirect.
    if (window.location.hash.includes("error_code=")) {
      router.replace("/login" + window.location.hash)
      return
    }

    if (!user || !member) {
      router.replace("/login")
      return
    }

    if (member.status !== "approved") {
      router.replace("/waiting")
      return
    }

    if (member.role === "borrower") {
      const warm = warmLoansCache(member.member_id).catch(() => {})
      const timeout = new Promise((resolve) => setTimeout(resolve, WARM_UP_TIMEOUT_MS))
      Promise.race([warm, timeout]).then(() => router.replace(nextPath() ?? "/borrower"))
      return
    }

    // Dashboard is the landing page, so it goes first -- but /transactions
    // and /fund-breakdown's default (group) view are common next stops, so
    // their caches get warmed the same way, all in parallel rather than
    // one after another.
    const warm = Promise.all([
      warmDashboardCache(member),
      warmLoansCache(member.member_id),
      warmTransactionsCache(),
      warmGroupBreakdownCache()
    ]).catch(() => {})
    const timeout = new Promise((resolve) => setTimeout(resolve, WARM_UP_TIMEOUT_MS))
    Promise.race([warm, timeout]).then(() => router.replace(nextPath() ?? "/dashboard"))
  }, [loading, user, member, router])

  return <SplashScreen />
}
