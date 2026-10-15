import { supabase } from "@/lib/supabase"
import { computeCurrentValueByMember } from "@/lib/currentValue"

interface ApproveLoanReleaseParams {
  loanId: string
  bankAccountId: string
  receiptUrls: string[]
  releaseDate: string
}

/**
 * Approves a loan's disbursement in one atomic step: verifies a pending
 * Loan Release transaction actually exists for this loan (refusing to
 * activate a loan whose request was rejected or otherwise has nothing real
 * to disburse), marks it approved with the disbursing bank/receipt,
 * activates the loan, and freezes each eligible member's pool share for
 * this loan's hold -- all via approve_loan_release in one DB transaction,
 * so a failure partway through can't leave the loan active with its
 * disbursement still pending, or approved with no hold ever snapshotted.
 *
 * The borrower shares in their own loan's hold like any other member,
 * provided they're linked to a member account with a net contribution
 * above 0 as of the release date -- same eligibility rule as the loan's
 * eventual gain split in closeLoan.ts, so a member's hold and gain-share
 * standing on their own loan stay consistent with each other.
 *
 * Replaces two near-duplicate client-side implementations (the Txns review
 * card in admin/page.tsx and the loan's own "Approve & Activate" in
 * LoanDetailPanel) that each did the same three writes separately with no
 * rollback between them, plus the old snapshotLoanHold helper, which never
 * checked its own delete/insert errors -- a failed hold write looked
 * identical to a successful one.
 */
export async function approveLoanRelease(params: ApproveLoanReleaseParams) {
  const currentValueByMember = await computeCurrentValueByMember(params.releaseDate)
  const totalValue = Array.from(currentValueByMember.values()).reduce((sum, v) => sum + v, 0)

  const holds =
    totalValue > 0
      ? Array.from(currentValueByMember.entries()).map(([member_id, currentValue]) => ({
          member_id,
          share: currentValue / totalValue
        }))
      : []

  // The RPC only takes one receipt, so the full list goes onto the still-
  // pending row first. The RPC then sets receipt_url to that same first
  // file, which the database's receipt sync treats as no change, keeping
  // the whole list. A Loan Release carries no receipt until it's approved,
  // so if the RPC fails the list is simply cleared again -- leaving the
  // caller free to delete the uploaded files.
  const { error: attachError } = await supabase
    .from("transactions")
    .update({ receipt_urls: params.receiptUrls })
    .eq("loan_id", params.loanId)
    .eq("classification", "Loan Release")
    .eq("status", "pending")
  if (attachError) throw new Error(attachError.message)

  const { error } = await supabase.rpc("approve_loan_release", {
    p_loan_id: params.loanId,
    p_bank_account_id: params.bankAccountId,
    p_receipt_url: params.receiptUrls[0] ?? null,
    p_release_date: params.releaseDate,
    p_holds: holds
  })

  if (error) {
    await supabase
      .from("transactions")
      .update({ receipt_urls: [] })
      .eq("loan_id", params.loanId)
      .eq("classification", "Loan Release")
      .eq("status", "pending")
    throw new Error(error.message)
  }
}
