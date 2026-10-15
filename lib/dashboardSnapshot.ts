import { supabase } from "@/lib/supabase"
import { writeCache } from "@/lib/cache"

export type RecentTransaction = {
  transaction_id: string
  date: string
  classification: string
  amount: number
  status: string
}

export type DashboardSnapshot = {
  fundCash: number | null
  myBalance: number | null
  pendingCount: number
  // The member's own entries still waiting on an admin -- optional so
  // snapshots cached before this field existed still read cleanly.
  myPendingCount?: number
  recentTransactions: RecentTransaction[]
  asOf: string
}

// A field comes back `undefined` (not `null`) when its own query errored --
// dashboard/page.tsx falls back to whatever it already had on screen rather
// than blanking a value the member was just looking at over a transient
// error; `null`/`[]` would erase that distinction. warmDashboardCache below
// has no prior value to fall back to, so it treats `undefined` as "not
// available yet" instead.
export type DashboardFields = {
  fundCash?: number
  myBalance?: number
  pendingCount: number
  myPendingCount?: number
  recentTransactions?: RecentTransaction[]
  error: string | null
}

// The six queries dashboard/page.tsx needs, factored out so app/page.tsx's
// splash can run the exact same fetch to warm the `dashboard:${member_id}`
// cache before ever navigating there -- see warmDashboardCache below.
export async function fetchDashboardFields(member: { member_id: string; role: string }): Promise<DashboardFields> {
  // v_fund_summary.total_cash is the same figure the Breakdown hub's
  // Fund tab shows as "Fund Total Cash" -- reuse it rather than
  // recomputing from bank balances.
  const fundPromise = supabase.from("v_fund_summary").select("total_cash").single()

  // v_member_performance.withdrawable_now is the same figure Breakdown's
  // You tab shows as "Available Balance."
  const minePromise = supabase
    .from("v_member_performance")
    .select("withdrawable_now")
    .eq("member_id", member.member_id)
    .single()

  const pendingPromise =
    member.role === "admin"
      ? supabase.from("transactions").select("transaction_id", { count: "exact", head: true }).eq("status", "pending")
      : Promise.resolve({ count: 0, error: null })

  // Mirrors Admin's own "entries awaiting approval" total -- transactions,
  // pending member signups, and pending borrower signups. Distribution
  // groups are deliberately left out (getPendingBankInterestGroups()
  // does real aggregation work, not a cheap count, and isn't worth
  // paying for on every dashboard load). role='borrower' is excluded
  // from the members count the same way Admin's Members tab excludes
  // it -- pending borrowers are counted once, not double-counted
  // across both.
  const pendingMembersPromise =
    member.role === "admin"
      ? supabase
          .from("members")
          .select("member_id", { count: "exact", head: true })
          .eq("status", "pending")
          .neq("role", "borrower")
      : Promise.resolve({ count: 0, error: null })

  const pendingBorrowersPromise =
    member.role === "admin"
      ? supabase
          .from("members")
          .select("member_id", { count: "exact", head: true })
          .eq("status", "pending")
          .eq("role", "borrower")
      : Promise.resolve({ count: 0, error: null })

  const myPendingPromise = supabase
    .from("transactions")
    .select("transaction_id", { count: "exact", head: true })
    .eq("member_id", member.member_id)
    .eq("status", "pending")

  const recentTransactionsPromise = supabase
    .from("transactions")
    .select("transaction_id, txn_date, created_at, classification, amount, status")
    .eq("member_id", member.member_id)
    .neq("status", "cancelled")
    .order("txn_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(5)

  const [fundResult, mineResult, pendingResult, pendingMembersResult, pendingBorrowersResult, recentTransactionsResult, myPendingResult] =
    await Promise.all([
      fundPromise,
      minePromise,
      pendingPromise,
      pendingMembersPromise,
      pendingBorrowersPromise,
      recentTransactionsPromise,
      myPendingPromise
    ])

  const firstError =
    fundResult.error ||
    mineResult.error ||
    pendingResult.error ||
    pendingMembersResult.error ||
    pendingBorrowersResult.error ||
    recentTransactionsResult.error

  return {
    fundCash: !fundResult.error && fundResult.data ? Number(fundResult.data.total_cash) : undefined,
    myBalance: !mineResult.error && mineResult.data ? Number(mineResult.data.withdrawable_now) : undefined,
    pendingCount: (pendingResult.count ?? 0) + (pendingMembersResult.count ?? 0) + (pendingBorrowersResult.count ?? 0),
    myPendingCount: myPendingResult.error ? undefined : myPendingResult.count ?? 0,
    recentTransactions:
      !recentTransactionsResult.error && recentTransactionsResult.data
        ? recentTransactionsResult.data.map((r) => ({
            transaction_id: r.transaction_id,
            date: r.txn_date ?? r.created_at,
            classification: r.classification,
            amount: Number(r.amount),
            status: r.status
          }))
        : undefined,
    error: firstError?.message ?? null
  }
}

// Called from the splash at / to get the dashboard's cache warm before it
// ever mounts -- best-effort, since there's no on-screen value here to
// protect the way dashboard/page.tsx protects its own state on a partial
// error. A failed field just doesn't warm; dashboard's own fetch on mount
// covers it a moment later same as any other cache miss.
export async function warmDashboardCache(member: { member_id: string; role: string }): Promise<void> {
  const fields = await fetchDashboardFields(member)
  const snapshot: DashboardSnapshot = {
    fundCash: fields.fundCash ?? null,
    myBalance: fields.myBalance ?? null,
    pendingCount: fields.pendingCount,
    myPendingCount: fields.myPendingCount ?? 0,
    recentTransactions: fields.recentTransactions ?? [],
    asOf: new Date().toISOString()
  }
  writeCache(`dashboard:${member.member_id}`, snapshot)
}
