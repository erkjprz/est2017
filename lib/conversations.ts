import { supabase } from "@/lib/supabase"

// Member <-> admin-team threads. See the 20261002000004 migration for the
// model: every conversation is one member and "the admins" as a group.

export type ConversationSummary = {
  id: string
  member_id: string
  member_name: string | null
  subject: string
  status: "open" | "closed"
  last_message_at: string
  last_message_body: string | null
  last_message_sender_id: string | null
  unread: boolean
}

export type ConversationMessage = {
  id: string
  conversation_id: string
  sender_id: string
  body: string
  attachments: ChatAttachment[]
  created_at: string
}

// A photo or file on a message. path is inside the private ChatAttachments
// bucket, under the conversation's own folder (the storage policies key
// off that folder), and is resolved to a short-lived signed URL to show.
export type ChatAttachment = {
  path: string
  name: string
  type: string
  size: number
}

export const MESSAGE_COLUMNS = "id, conversation_id, sender_id, body, attachments, created_at"
export const ATTACHMENTS_MAX = 10
export const ATTACHMENT_BYTES_MAX = 10 * 1024 * 1024
const CHAT_BUCKET = "ChatAttachments"

export const SUBJECT_MAX = 120
export const BODY_MAX = 4000

export async function listConversations() {
  const { data, error } = await supabase.rpc("list_conversations")
  return { data: data as ConversationSummary[] | null, error }
}

// transactionId links the new thread to that transaction (see the
// 20261016000002 migration). It's only sent when set, so unlinked threads
// keep calling the original signatures.
export async function startConversation(memberId: string, subject: string, body: string, transactionId?: string | null) {
  return supabase.rpc("start_conversation", {
    p_member_id: memberId,
    p_subject: subject.trim(),
    p_body: body.trim(),
    ...(transactionId ? { p_transaction_id: transactionId } : {})
  })
}

// Starting a thread with files can't be one RPC: the files have to land in
// the conversation's folder, which storage only allows once it exists. So
// open the empty thread, upload, then post the first message; undo it all
// if any step fails. See the 20261015000004 migration.
export async function startConversationWithAttachments(
  memberId: string,
  senderId: string,
  subject: string,
  body: string,
  files: File[],
  transactionId?: string | null
): Promise<{ data: string | null; error: string | null }> {
  if (files.length === 0) {
    const { data, error } = await startConversation(memberId, subject, body, transactionId)
    return { data: (data as string | null) ?? null, error: error?.message ?? null }
  }

  const { data: id, error: openError } = await supabase.rpc("open_conversation", {
    p_member_id: memberId,
    p_subject: subject.trim(),
    ...(transactionId ? { p_transaction_id: transactionId } : {})
  })
  if (openError || !id) return { data: null, error: openError?.message ?? "Couldn't start the conversation." }
  const conversationId = id as string

  const { attachments, error: uploadError } = await uploadChatAttachments(conversationId, senderId, files)
  if (uploadError) {
    await supabase.rpc("discard_empty_conversation", { p_conversation_id: conversationId })
    return { data: null, error: `Couldn't upload: ${uploadError}` }
  }

  const { error: insertError } = await supabase
    .from("conversation_messages")
    .insert({ conversation_id: conversationId, sender_id: senderId, body: body.trim(), attachments })
  if (insertError) {
    await removeChatAttachments(attachments.map((a) => a.path))
    await supabase.rpc("discard_empty_conversation", { p_conversation_id: conversationId })
    return { data: null, error: insertError.message }
  }
  return { data: conversationId, error: null }
}

// Just enough of a transaction to show it as a TransactionRow on the
// thread it's linked to. RLS applies: someone who can't see the row gets
// null and the thread simply shows no card.
const LINKED_TRANSACTION_COLUMNS = `
  transaction_id, txn_date, created_at, description, amount, bank, member_id, loan_id,
  classification, status, receipt_url, receipt_urls, rejection_reason,
  members!transactions_member_id_fkey ( name ),
  loans!transactions_loan_id_fkey ( name, borrowers!loans_borrower_id_fkey ( name, member_id ) ),
  investments!transactions_investment_id_fkey ( name ),
  from_bank_account:bank_accounts!transactions_bank_account_id_fkey ( bank_name, account_name )
`

export async function fetchLinkedTransaction(transactionId: string): Promise<any | null> {
  const { data } = await supabase
    .from("transactions")
    .select(LINKED_TRANSACTION_COLUMNS)
    .eq("transaction_id", transactionId)
    .maybeSingle()
  return data ?? null
}

// Threads already about a transaction -- shown on its detail sheet. RLS
// limits members to their own threads.
export async function listTransactionConversations(transactionId: string) {
  const { data } = await supabase
    .from("conversations")
    .select("id, member_id, subject, status, last_message_at")
    .eq("transaction_id", transactionId)
    .order("last_message_at", { ascending: false })
  return (data ?? []) as { id: string; member_id: string; subject: string; status: "open" | "closed"; last_message_at: string }[]
}

// Admin-only: link an existing thread to a transaction, or clear the link
// with null. See the 20261016000003 migration.
export async function setConversationTransaction(conversationId: string, transactionId: string | null) {
  return supabase.rpc("set_conversation_transaction", {
    p_conversation_id: conversationId,
    p_transaction_id: transactionId
  })
}

// Candidates for linking to a member's thread: their own entries plus
// every entry on a loan they hold or borrowed (as a member or through
// their borrower record) -- the rows that member can be asked about.
export async function listMemberTransactions(memberId: string): Promise<{ data: any[]; error: string | null }> {
  const { data: borrowers } = await supabase.from("borrowers").select("borrower_id").eq("member_id", memberId)
  const borrowerIds = (borrowers ?? []).map((b) => b.borrower_id as string)
  const { data: loans } = await supabase
    .from("loans")
    .select("loan_id")
    .or([`member_id.eq.${memberId}`, ...(borrowerIds.length ? [`borrower_id.in.(${borrowerIds.join(",")})`] : [])].join(","))
  const loanIds = (loans ?? []).map((l) => l.loan_id as string)
  const { data, error } = await supabase
    .from("transactions")
    .select(LINKED_TRANSACTION_COLUMNS)
    .or([`member_id.eq.${memberId}`, ...(loanIds.length ? [`loan_id.in.(${loanIds.join(",")})`] : [])].join(","))
    .neq("status", "cancelled")
    .order("txn_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(200)
  return { data: data ?? [], error: error?.message ?? null }
}

export async function markConversationRead(conversationId: string) {
  return supabase.rpc("mark_conversation_read", { p_conversation_id: conversationId })
}

export async function setConversationStatus(conversationId: string, status: "open" | "closed") {
  return supabase.rpc("set_conversation_status", { p_conversation_id: conversationId, p_status: status })
}

// All-or-nothing, like uploadReceipts: if any file fails, the ones that
// already landed are removed again.
export async function uploadChatAttachments(
  conversationId: string,
  senderId: string,
  files: File[]
): Promise<{ attachments: ChatAttachment[]; error: string | null }> {
  const stamp = Date.now()
  const results = await Promise.all(
    files.map(async (file, i) => {
      const safeName = file.name.replace(/[^\w.\-]+/g, "_")
      const path = `${conversationId}/${senderId}-${stamp}-${i + 1}-${safeName}`
      const { error } = await supabase.storage
        .from(CHAT_BUCKET)
        .upload(path, file, { contentType: file.type || "application/octet-stream" })
      const attachment: ChatAttachment = { path, name: file.name, type: file.type, size: file.size }
      return { attachment, error }
    })
  )
  const failed = results.find((r) => r.error)
  if (failed) {
    await removeChatAttachments(results.filter((r) => !r.error).map((r) => r.attachment.path))
    return { attachments: [], error: failed.error!.message }
  }
  return { attachments: results.map((r) => r.attachment), error: null }
}

// Which newly picked files fit alongside the ones already queued, plus a
// message for whatever was turned away (too big, or over the per-message cap).
export function acceptChatFiles(queued: File[], picked: File[]): { accepted: File[]; error: string } {
  const tooBig = picked.filter((f) => f.size > ATTACHMENT_BYTES_MAX)
  const ok = picked.filter((f) => f.size <= ATTACHMENT_BYTES_MAX)
  const room = Math.max(0, ATTACHMENTS_MAX - queued.length)
  let error = ""
  if (tooBig.length > 0) error = `${tooBig.map((f) => f.name).join(", ")} ${tooBig.length > 1 ? "are" : "is"} over 10 MB.`
  else if (ok.length > room) error = `You can attach up to ${ATTACHMENTS_MAX} files per message.`
  return { accepted: ok.slice(0, room), error }
}

export async function removeChatAttachments(paths: string[]) {
  if (paths.length > 0) await supabase.storage.from(CHAT_BUCKET).remove(paths)
}

export async function getChatAttachmentUrl(path: string, download?: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(CHAT_BUCKET)
    .createSignedUrl(path, 3600, download ? { download } : undefined)
  if (error) return null
  return data.signedUrl
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatMessageTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}
