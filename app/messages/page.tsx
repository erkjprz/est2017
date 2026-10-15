"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import BorrowerHeader from "@/app/components/BorrowerHeader"
import { Sheet } from "@/app/components/Sheet"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"
import { AttachButton, PendingAttachments } from "@/app/components/ChatAttachments"
import { readCache, writeCache } from "@/lib/cache"
import {
  BODY_MAX,
  SUBJECT_MAX,
  acceptChatFiles,
  formatMessageTime,
  listConversations,
  startConversationWithAttachments,
  type ConversationSummary
} from "@/lib/conversations"

type MemberOption = { member_id: string; name: string; role: string }

// useSearchParams() (for the admin "?to=<memberId>" deep link from the
// Members page) needs its own Suspense boundary -- same pattern as
// EditTransactionSheetHost.
export default function MessagesPage() {
  return (
    <Suspense fallback={null}>
      <MessagesInbox />
    </Suspense>
  )
}

function MessagesInbox() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { loading: authLoading, member } = useAuth()
  const isAdmin = member?.role === "admin"
  const cacheKey = member ? `conversations:${member.member_id}` : null
  const cached = cacheKey ? readCache<ConversationSummary[]>(cacheKey) : undefined

  const [conversations, setConversations] = useState<ConversationSummary[]>(cached ?? [])
  const [dataLoading, setDataLoading] = useState(!cached)
  const [loadError, setLoadError] = useState("")
  const [filter, setFilter] = useState<"open" | "closed">("open")
  // + New's compose sheet; keyed so every open is a fresh sheet (its own
  // slide-in, empty fields), never a reuse of one that's mid-close.
  const [newCompose, setNewCompose] = useState<number | null>(null)
  // The admin "?to=" deep link's sheet is closed by remembering it was
  // dismissed, not by waiting on a navigation to clear the param -- while
  // that navigation was in flight (slow network, installed app) the closed
  // sheet stayed mounted invisibly over the page, blocking every tap.
  const [dismissedTo, setDismissedTo] = useState<string | null>(null)
  const preselectedMemberId = searchParams.get("to")

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
      const key = `conversations:${member!.member_id}`
      const { data, error } = await listConversations()
      if (error) {
        setLoadError(error.message)
      } else {
        setConversations(data ?? [])
        writeCache(key, data ?? [])
      }
      setDataLoading(false)
    }

    load()
  }, [authLoading, member, router])

  // Admin deep link from the Members page opens the composer pre-filled
  // with that member. Closing it also drops the param in place (no
  // navigation) so a refresh doesn't reopen it.
  const deepLinkTo = isAdmin && preselectedMemberId && preselectedMemberId !== dismissedTo ? preselectedMemberId : null
  const compose =
    newCompose !== null ? { key: `new-${newCompose}`, to: null } : deepLinkTo ? { key: `to-${deepLinkTo}`, to: deepLinkTo } : null

  function closeCompose() {
    setNewCompose(null)
    if (preselectedMemberId) {
      setDismissedTo(preselectedMemberId)
      window.history.replaceState(null, "", "/messages")
    }
  }

  const Header = member?.role === "borrower" ? BorrowerHeader : Navbar
  // Back goes to wherever this page is reached from: the Admin page for
  // admins, the borrower home (its header menu) for borrowers, and the
  // Menu page for everyone else.
  const back =
    isAdmin
      ? { label: "Admin", path: "/admin" }
      : member?.role === "borrower"
        ? { label: "Home", path: "/borrower" }
        : { label: "Menu", path: "/menu" }

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

  // Members see every thread of their own; admins work an inbox, so
  // closed threads are filed away behind their own chip.
  const visible = isAdmin ? conversations.filter((c) => c.status === filter) : conversations
  const unreadOpen = conversations.filter((c) => c.unread && c.status === "open").length

  return (
    <>
      <Header />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(3rem+var(--dock-h)+env(safe-area-inset-bottom))]">
          <button
            onClick={() => router.push(back.path)}
            className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors"
          >
            ← {back.label}
          </button>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
                {isAdmin ? "Administration" : "Support"}
              </div>
              <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-1">
                {isAdmin ? "Member Questions" : "Chat with Est. 2017"}
              </h1>
              <p className="text-[13px] text-ink-soft mb-6">
                {isAdmin
                  ? "Questions and conversations between members and the admin team."
                  : "Have a question about your account, a transaction, or a loan? Send it here and any admin can reply."}
              </p>
            </div>
            <button
              onClick={() => {
                // Opening + New also retires a still-pending deep link.
                if (preselectedMemberId) closeCompose()
                setNewCompose(Date.now())
              }}
              className="shrink-0 bg-gold-soft text-ink px-4 py-2.5 rounded-sm text-sm font-semibold"
            >
              + New
            </button>
          </div>

          {isAdmin && (
            <div className="flex items-center gap-2 mb-4">
              {(["open", "closed"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3.5 py-1.5 rounded-full text-[13px] border ${
                    filter === f ? "bg-ink text-paper border-ink" : "border-hairline text-ink-soft"
                  }`}
                >
                  {f === "open" ? `Open${unreadOpen > 0 ? ` · ${unreadOpen} unread` : ""}` : "Closed"}
                </button>
              ))}
            </div>
          )}

          {loadError && <p className="text-sm text-rust mb-4">Couldn&apos;t load messages: {loadError}</p>}

          {!loadError && visible.length === 0 && (
            <p className="text-sm text-ink-soft text-center py-12 card">
              {isAdmin && filter === "closed"
                ? "No closed conversations."
                : isAdmin
                  ? "No member questions yet."
                  : "You haven't asked anything yet. Tap + New to send the admins a question."}
            </p>
          )}

          {visible.length > 0 && (
            <div className="card divide-y divide-hairline">
              {visible.map((c) => {
                const fromMe = c.last_message_sender_id === member.member_id
                const prefix = fromMe ? "You: " : !isAdmin ? "Admins: " : ""
                return (
                  <button
                    key={c.id}
                    onClick={() => router.push(`/messages/${c.id}`)}
                    className="w-full text-left px-5 py-3.5 flex items-start gap-3"
                  >
                    {c.unread && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-gold shrink-0" />}
                    <div className={c.unread ? "flex-1 min-w-0" : "flex-1 min-w-0 ml-[18px]"}>
                      <div className="flex items-baseline justify-between gap-2">
                        <p className={`text-sm text-ink truncate ${c.unread ? "font-semibold" : "font-medium"}`}>
                          {isAdmin && c.member_name ? `${c.member_name} · ` : ""}
                          {c.subject}
                        </p>
                        <span className="text-[11px] text-ink-soft font-mono shrink-0">
                          {formatMessageTime(c.last_message_at)}
                        </span>
                      </div>
                      {c.last_message_body && (
                        <p className="text-[13px] text-ink-soft mt-0.5 truncate">
                          {prefix}
                          {c.last_message_body}
                        </p>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </main>

      {compose && (
        <ComposeSheet
          key={compose.key}
          isAdmin={isAdmin}
          selfId={member.member_id}
          preselectedMemberId={compose.to}
          onClose={closeCompose}
          onStarted={(id) => router.push(`/messages/${id}`)}
        />
      )}
    </>
  )
}

function ComposeSheet({
  isAdmin,
  selfId,
  preselectedMemberId,
  onClose,
  onStarted
}: {
  isAdmin: boolean
  selfId: string
  preselectedMemberId: string | null
  onClose: () => void
  onStarted: (conversationId: string) => void
}) {
  const [members, setMembers] = useState<MemberOption[]>([])
  const [recipientId, setRecipientId] = useState(preselectedMemberId ?? "")
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!isAdmin) return
    supabase
      .from("members")
      .select("member_id, name, role")
      .eq("status", "approved")
      .neq("member_id", selfId)
      .order("name")
      .then(({ data }) => setMembers(data ?? []))
  }, [isAdmin, selfId])

  const targetId = isAdmin ? recipientId : selfId
  const canSend = !!targetId && subject.trim().length > 0 && (body.trim().length > 0 || files.length > 0) && !sending

  async function send() {
    if (!canSend) return
    setSending(true)
    setError("")
    const { data, error } = await startConversationWithAttachments(targetId, selfId, subject, body, files)
    if (error || !data) {
      setError(error ?? "Couldn't start the conversation.")
      setSending(false)
      return
    }
    onStarted(data)
  }

  function addFiles(picked: File[]) {
    const { accepted, error } = acceptChatFiles(files, picked)
    setError(error)
    if (accepted.length > 0) setFiles((prev) => [...prev, ...accepted])
  }

  return (
    <Sheet
      title={isAdmin ? "Message a Member" : "Chat with Est. 2017"}
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          className="w-full bg-ink text-paper px-6 py-3.5 rounded-full text-base font-bold shadow-lg disabled:opacity-50"
        >
          {sending ? "Sending..." : "Send"}
        </button>
      }
    >
      <div className="space-y-3">
        {isAdmin && (
          <label className="block">
            <span className="block text-xs uppercase tracking-wide text-ink-soft font-mono mb-1.5">To</span>
            <select
              value={recipientId}
              onChange={(e) => setRecipientId(e.target.value)}
              className="w-full card px-3 py-2.5 text-sm text-ink"
            >
              <option value="">Choose a member…</option>
              {members.map((m) => (
                <option key={m.member_id} value={m.member_id}>
                  {m.name}
                  {m.role === "borrower" ? " (borrower)" : m.role === "admin" ? " (admin)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="block text-xs uppercase tracking-wide text-ink-soft font-mono mb-1.5">Subject</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={SUBJECT_MAX}
            placeholder={isAdmin ? "e.g. About your March contribution" : "e.g. Question about my loan"}
            className="w-full card px-3 py-2.5 text-sm text-ink placeholder:text-ink-soft outline-none"
          />
        </label>
        <label className="block">
          <span className="block text-xs uppercase tracking-wide text-ink-soft font-mono mb-1.5">Message</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={BODY_MAX}
            rows={5}
            className="w-full card px-3 py-2.5 text-sm text-ink outline-none resize-none"
          />
        </label>
        <div>
          <PendingAttachments files={files} onRemove={(i) => setFiles((prev) => prev.filter((_, j) => j !== i))} />
          <div className="flex items-center gap-2.5">
            <AttachButton count={files.length} disabled={sending} onPick={addFiles} />
            <span className="text-sm text-ink-soft">
              {files.length > 0 ? `${files.length} attached` : "Attach photos or files"}
            </span>
          </div>
        </div>
        {error && <p className="text-sm text-rust">{error}</p>}
      </div>
    </Sheet>
  )
}
