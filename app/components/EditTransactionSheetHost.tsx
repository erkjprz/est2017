"use client"

import { Suspense, useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useAuth } from "@/app/auth-context"
import { whenIdle } from "@/lib/whenIdle"

// Loaded on demand: this host sits in the root layout, so a static import
// would ship the whole edit form to every page (/login included) even
// though it only renders once a "?editTransaction=" link is followed. Once
// someone is signed in, the host preloads it at idle (see below) so the
// first Edit tap doesn't wait on the download.
const loadEditTransactionSheet = () =>
  import("@/app/components/EditTransactionSheet").then((mod) => mod.EditTransactionSheet)
const EditTransactionSheet = dynamic(loadEditTransactionSheet)

// Mounted once at the root layout so any page can open the edit sheet --
// LoanCards (used on /borrower, which has no Navbar/FAB) and the
// Transactions list both need this, and the FAB's own NewTransactionSheet
// only lives in Navbar, which borrowers never see.
export function EditTransactionSheetHost() {
  const { member } = useAuth()
  const signedIn = !!member

  useEffect(() => {
    if (!signedIn) return
    return whenIdle(() => void loadEditTransactionSheet())
  }, [signedIn])

  return (
    <Suspense fallback={null}>
      <EditTransactionSheetWatcher />
    </Suspense>
  )
}

// Query-param watching needs useSearchParams(), not a plain
// window.location read in a pathname-keyed effect -- router.push to the
// *same* pathname with only a different query string doesn't change what
// usePathname() returns, so a pathname-keyed effect never re-fires on an
// in-place "?editTransaction=..." click (only on a genuinely fresh page
// load). useSearchParams() is the one that's actually reactive to
// query-only changes. It needs a Suspense boundary, kept local to this
// small watcher (see the wrapper above) rather than pushed onto every
// page that renders this host.
function EditTransactionSheetWatcher() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const requestedId = searchParams.get("editTransaction")
  const [transactionId, setTransactionId] = useState<string | null>(null)

  useEffect(() => {
    if (!requestedId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- copies the ?editTransaction= param into state, then clears it from the URL
    setTransactionId(requestedId)
    router.replace(pathname, { scroll: false })
  }, [requestedId, pathname, router])

  if (!transactionId) return null

  return <EditTransactionSheet transactionId={transactionId} onClose={() => setTransactionId(null)} />
}
