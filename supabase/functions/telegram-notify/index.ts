import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")
const CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET")

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
)

const CLASSIFICATION_LABEL: Record<string, string> = {
  "Opening Balance": "Opening Balance",
  "Member Contribution": "Member Contribution",
  "Member Withdrawal": "Member Withdrawal",
  "Loan Release": "Loan Release",
  "Loan Repayment": "Loan Repayment",
  "Investment": "Investment",
  "Investment Return": "Investment Return",
  "Bank Interest": "Bank Interest",
  "Tax": "Tax",
  "Internal Transfer": "Internal Transfer",
  "Expense": "Expense",
  "Gain Allocation": "Gain Allocation",
  "Bank Write-off": "Bank Write-off"
}

function formatAmount(amount: number) {
  const abs = Math.abs(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
  return `${amount < 0 ? "-" : ""}₱${abs}`
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

async function describeTransaction(record: Record<string, unknown>) {
  const parts: string[] = []

  if (record.member_id) {
    const { data } = await supabase
      .from("members")
      .select("name")
      .eq("member_id", record.member_id)
      .maybeSingle()
    if (data?.name) parts.push(`Member: ${escapeHtml(data.name)}`)
  }

  if (record.bank_account_id) {
    const { data } = await supabase
      .from("bank_accounts")
      .select("bank_name, account_name")
      .eq("id", record.bank_account_id)
      .maybeSingle()
    if (data) parts.push(`Bank: ${escapeHtml(data.account_name ? `${data.bank_name} (${data.account_name})` : data.bank_name)}`)
  }

  if (record.to_bank_account_id) {
    const { data } = await supabase
      .from("bank_accounts")
      .select("bank_name, account_name")
      .eq("id", record.to_bank_account_id)
      .maybeSingle()
    if (data) parts.push(`To bank: ${escapeHtml(data.account_name ? `${data.bank_name} (${data.account_name})` : data.bank_name)}`)
  }

  if (record.loan_id) {
    const { data } = await supabase
      .from("loans")
      .select("name")
      .eq("loan_id", record.loan_id)
      .maybeSingle()
    if (data?.name) parts.push(`Loan: ${escapeHtml(data.name)}`)
  }

  if (record.investment_id) {
    const { data } = await supabase
      .from("investments")
      .select("name")
      .eq("investment_id", record.investment_id)
      .maybeSingle()
    if (data?.name) parts.push(`Investment: ${escapeHtml(data.name)}`)
  }

  // Who actually recorded the entry -- distinct from record.member_id
  // (whose money/account this is), matching the app's own "Recorded by
  // {name}" on the transaction list. Null for a member's own pending
  // submission (nothing to add there), set for anything an admin entered
  // -- on someone's behalf, or a fund-level entry with no member at all.
  if (record.submitted_by) {
    const { data } = await supabase
      .from("members")
      .select("name")
      .eq("member_id", record.submitted_by)
      .maybeSingle()
    if (data?.name) parts.push(`Recorded by: ${escapeHtml(data.name)}`)
  }

  return parts
}

// The DB triggers send 'submitted' for a freshly-pending row awaiting a
// decision, 'recorded' for an admin fund-bookkeeping entry (Bank
// Interest/Expense/Investment) that's approved the moment it's created --
// see notify_telegram_transaction -- and 'released' when a Loan Release is
// approved (notify_telegram_loan_released). Separate headline for each so
// a recorded or released entry doesn't read as something waiting on review.
const EVENT_HEADLINE: Record<string, string> = {
  submitted: "🔔 <b>New Transaction</b>",
  recorded: "📒 <b>Recorded</b>",
  released: "✅ <b>Loan Released</b>"
}

// A pending Loan Release is still only a request -- nothing has been
// disbursed until it's approved -- so say so in the first message.
function labelFor(classification: string, event: string) {
  if (classification === "Loan Release" && event === "submitted") return "Loan Request"
  return CLASSIFICATION_LABEL[classification] ?? classification
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 })
  }

  if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 })
  }

  if (!BOT_TOKEN || !CHAT_ID) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID secret")
    return new Response("Not configured", { status: 500 })
  }

  const payload = await req.json().catch(() => null)
  const record = payload?.record as Record<string, unknown> | undefined
  const event = typeof payload?.event === "string" ? payload.event : "submitted"

  if (!record) {
    return new Response("Bad request", { status: 400 })
  }

  const classification = labelFor(String(record.classification), event)
  const amount = formatAmount(Number(record.amount))

  const headline = EVENT_HEADLINE[event] ?? EVENT_HEADLINE.submitted
  const lines = [headline, `${escapeHtml(classification)} — ${amount}`]

  const details = await describeTransaction(record)
  lines.push(...details)

  if (record.description) lines.push(`Note: ${escapeHtml(String(record.description))}`)

  const text = lines.join("\n")

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true
    })
  })

  if (!res.ok) {
    const body = await res.text()
    console.error("Telegram API error", res.status, body)
    return new Response("Telegram send failed", { status: 502 })
  }

  return new Response("ok", { status: 200 })
})
