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

export async function startConversation(memberId: string, subject: string, body: string) {
  return supabase.rpc("start_conversation", {
    p_member_id: memberId,
    p_subject: subject.trim(),
    p_body: body.trim()
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
  files: File[]
): Promise<{ data: string | null; error: string | null }> {
  if (files.length === 0) {
    const { data, error } = await startConversation(memberId, subject, body)
    return { data: (data as string | null) ?? null, error: error?.message ?? null }
  }

  const { data: id, error: openError } = await supabase.rpc("open_conversation", {
    p_member_id: memberId,
    p_subject: subject.trim()
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
