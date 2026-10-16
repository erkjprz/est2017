import { supabase } from "@/lib/supabase"
import { writeCache } from "@/lib/cache"

// Not scoped per member -- every approved non-borrower member sees the same
// full transaction list (filtering happens entirely client-side on
// /transactions), so one shared cache entry covers everyone.
export const TRANSACTIONS_CACHE_KEY = "transactions:list"

export type TransactionsSnapshot = {
  transactions: any[]
  totalCount: number
  members: any[]
}

// Each legacy (migrated) bank transfer is stored as two rows (a
// negative-amount leg on the source bank, a positive-amount leg on the
// destination bank, same date, same absolute amount, identified via the
// plain `bank` text column) rather than one row with a from/to pair. New
// transfers created through the app are a single row instead, with both
// ends on bank_account_id / to_bank_account_id.
function findTransferPair(transaction: any, allTransactions: any[]): any | null {
  return (
    allTransactions.find(
      (other) =>
        other.transaction_id !== transaction.transaction_id &&
        other.classification === "Internal Transfer" &&
        other.txn_date === transaction.txn_date &&
        Number(other.amount) === -Number(transaction.amount)
    ) ?? null
  )
}

// Exported for /transactions' own rendering (bank pills, transfer labels),
// which needs it independently of the fetch below.
export function bankAccountLabel(account: any): string | null {
  if (!account) return null
  return account.account_name || account.bank_name || null
}

function transferDirectionLabel(transaction: any, allTransactions: any[]): string | null {
  const fromAccount = bankAccountLabel(transaction.from_bank_account)
  const toAccount = bankAccountLabel(transaction.to_bank_account)
  if (fromAccount && toAccount) {
    return `${fromAccount} → ${toAccount}`
  }

  const pair = findTransferPair(transaction, allTransactions)
  if (!pair || !transaction.bank || !pair.bank) return null

  const fromLeg = Number(transaction.amount) < 0 ? transaction : pair
  const toLeg = Number(transaction.amount) < 0 ? pair : transaction

  return `${fromLeg.bank} → ${toLeg.bank}`
}

// Legacy transfers are two separate DB rows -- correct as source-of-truth
// data, but showing both as separate cards duplicates the same real-world
// event. Collapse each pair down to one card: keep the negative ("from")
// leg since Math.abs() at render time already turns it into a plain
// magnitude, drop its paired positive ("to") leg. New single-row transfers
// never match this and pass through untouched. Nothing in the database
// changes -- both original rows still exist exactly as migrated.
function dedupeLegacyTransferPairs(rows: any[]): any[] {
  const skipIds = new Set<string>()

  for (const row of rows) {
    if (row.classification !== "Internal Transfer") continue
    if (row.bank_account_id || row.to_bank_account_id) continue
    if (Number(row.amount) <= 0) continue

    const pair = findTransferPair(row, rows)
    if (pair) skipIds.add(row.transaction_id)
  }

  return rows.filter((row) => !skipIds.has(row.transaction_id))
}

// The transactions list and the members list, factored out of
// transactions/page.tsx so the splash at / can run the exact same fetch to
// warm TRANSACTIONS_CACHE_KEY before ever navigating there. Each half fails
// independently, same as the two parallel loads it replaces -- a members
// error doesn't blank out a successful transactions fetch or vice versa.
export async function fetchTransactionsFields() {
  // members needs an explicit FK hint: transactions has two FKs into
  // members (member_id, submitted_by), so a bare `members(...)` embed is
  // ambiguous and PostgREST errors on it.
  //
  // bank_accounts is joined twice (aliased from_bank_account /
  // to_bank_account) for the new single-row Internal Transfer shape --
  // legacy migrated transfers instead used two separate rows with the
  // plain `bank` text column and null bank_account_id/to_bank_account_id.
  //
  // Columns are listed rather than `*`: the table still carries spreadsheet-
  // import leftovers (reason, source_sheet, source_row, legacy_id,
  // confidence, original_date) that nothing in the app reads, and they were
  // ~15% of this payload -- which is downloaded whole and also kept in
  // localStorage. Add a column here if a list, filter, detail sheet, or
  // EditTransactionSheet (seeded from these rows via transactionRowCache)
  // starts reading one.
  //
  // .range() is required: without an explicit range, PostgREST applies its
  // own default row cap (1000), which silently truncates the result. 4999
  // comfortably covers current volume; if the table keeps growing, switch
  // this to real server-side pagination instead of raising the number
  // again. totalCount is derived from the deduped row count below rather
  // than a separate exact-count query, since we already fetch every row
  // within that range.
  const transactionsPromise = (async () => {
    const { data, error } = await supabase
      .from("transactions")
      .select(
        `
        transaction_id, txn_date, created_at, description, amount, bank, member_id, loan_id,
        investment_id, classification, affects_cash, status, submitted_by, receipt_url, receipt_urls,
        bank_account_id, to_bank_account_id, interest_distributed, is_closing_distribution,
        rejection_reason, payout_details, payout_qr_path, resubmitted_at, previous_amount,
        members!transactions_member_id_fkey (
          name
        ),
        submitted_by_member:members!transactions_submitted_by_fkey (
          name
        ),
        loans!transactions_loan_id_fkey (
          name,
          borrowers!loans_borrower_id_fkey (
            name,
            member_id
          )
        ),
        investments!transactions_investment_id_fkey (
          name
        ),
        from_bank_account:bank_accounts!transactions_bank_account_id_fkey (
          bank_name,
          account_name
        ),
        to_bank_account:bank_accounts!transactions_to_bank_account_id_fkey (
          bank_name,
          account_name
        )
      `
      )
      .neq("status", "cancelled")
      .order("txn_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(0, 4999)

    if (error) return { rows: [], error: error.message }

    const rawRows = data ?? []

    // Compute each transfer's from->to label while both legacy legs are
    // still present (dedupeLegacyTransferPairs below removes one of them,
    // and findTransferPair can't locate a partner that's already gone).
    const withTransferLabels = rawRows.map((row) =>
      row.classification === "Internal Transfer"
        ? { ...row, _transferLabel: transferDirectionLabel(row, rawRows) }
        : row
    )

    return { rows: dedupeLegacyTransferPairs(withTransferLabels), error: null }
  })()

  const membersPromise = (async () => {
    const { data, error } = await supabase.from("members").select("member_id, name").order("name")
    return { rows: data ?? [], error: error?.message ?? null }
  })()

  const [txResult, membersResult] = await Promise.all([transactionsPromise, membersPromise])

  return {
    transactions: txResult.rows,
    members: membersResult.rows,
    error: txResult.error || membersResult.error
  }
}

// Called from the splash at / -- best-effort, same as warmDashboardCache: on
// error, just don't warm the cache and let /transactions's own fetch on
// mount cover it.
export async function warmTransactionsCache(): Promise<void> {
  const { transactions, members, error } = await fetchTransactionsFields()
  if (error) return
  writeCache<TransactionsSnapshot>(TRANSACTIONS_CACHE_KEY, {
    transactions,
    totalCount: transactions.length,
    members
  })
}
