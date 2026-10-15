import { supabase } from "@/lib/supabase"

// What each member can still withdraw: v_member_performance.withdrawable_now
// (Breakdown's "Available Balance") less any withdrawals they already have
// waiting in the queue. Same rule the database enforces on new withdrawals
// (validate_member_transaction), so the form can say it before Submit and
// the admin queue can show it next to the request.
export type Withdrawable = { withdrawableNow: number; pendingOut: number }

export async function fetchWithdrawable(memberIds: string[]): Promise<Record<string, Withdrawable>> {
  const ids = Array.from(new Set(memberIds.filter(Boolean)))
  if (ids.length === 0) return {}

  const [perf, pending] = await Promise.all([
    supabase.from("v_member_performance").select("member_id, withdrawable_now").in("member_id", ids),
    supabase
      .from("transactions")
      .select("member_id, amount")
      .in("member_id", ids)
      .eq("classification", "Member Withdrawal")
      .eq("status", "pending")
  ])
  if (perf.error) throw perf.error
  if (pending.error) throw pending.error

  const result: Record<string, Withdrawable> = {}
  ids.forEach((id) => (result[id] = { withdrawableNow: 0, pendingOut: 0 }))
  ;(perf.data ?? []).forEach((r) => (result[r.member_id].withdrawableNow = Number(r.withdrawable_now ?? 0)))
  ;(pending.data ?? []).forEach((r) => (result[r.member_id].pendingOut += -Number(r.amount)))
  return result
}
