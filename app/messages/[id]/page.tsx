"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import BorrowerHeader from "@/app/components/BorrowerHeader"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"
import { AttachButton, MessageAttachments, PendingAttachments } from "@/app/components/ChatAttachments"
import {
  BODY_MAX,
  MESSAGE_COLUMNS,
  acceptChatFiles,
  formatMessageTime,
  markConversationRead,
  removeChatAttachments,
  setConversationStatus,
  uploadChatAttachments,
  type ConversationMessage
} from "@/lib/conversations"

type Conversation = {
  id: string
  member_id: string
  subject: string
  status: "open" | "closed"
  created_at: string
}

export default function ConversationPage() {
  const params = useParams()
  const conversationId = params?.id as string
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()
  const isAdmin = member?.role === "admin"
  const isBorrower = member?.role === "borrower"

  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [memberName, setMemberName] = useState("")
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  // Sender names are only resolved for admins -- members just see "Admins"
  // on the other side, and borrowers can't read other members' rows anyway.
  const [senderNames, setSenderNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [draft, setDraft] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState("")
  const [statusBusy, setStatusBusy] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const requestedNames = useRef(new Set<string>())

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

    let cancelled = false

    async function load() {
      const [convRes, msgRes] = await Promise.all([
        supabase
          .from("conversations")
          .select("id, member_id, subject, status, created_at")
          .eq("id", conversationId)
          .maybeSingle(),
        supabase
          .from("conversation_messages")
          .select(MESSAGE_COLUMNS)
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true })
      ])
      if (cancelled) return

      if (convRes.error || msgRes.error) {
        setLoadError((convRes.error ?? msgRes.error)!.message)
      } else if (!convRes.data) {
        setLoadError("Conversation not found.")
      } else {
        setConversation(convRes.data as Conversation)
        setMessages(msgRes.data ?? [])
        markConversationRead(conversationId)
      }
      setLoading(false)
    }

    load()

    // New messages from the other side (or this user on another device)
    // land live. RLS on conversation_messages applies to realtime too.
    const channel = supabase
      .channel(`conversation-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "conversation_messages",
          filter: `conversation_id=eq.${conversationId}`
        },
        (payload) => {
          const msg = { ...(payload.new as ConversationMessage) }
          msg.attachments = msg.attachments ?? []
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]))
          if (msg.sender_id !== member!.member_id) markConversationRead(conversationId)
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [authLoading, member, router, conversationId])

  useEffect(() => {
    if (!isAdmin || !conversation) return
    const ids = Array.from(new Set([conversation.member_id, ...messages.map((m) => m.sender_id)]))
    const missing = ids.filter((id) => !requestedNames.current.has(id))
    if (missing.length === 0) return
    missing.forEach((id) => requestedNames.current.add(id))
    supabase
      .from("members")
      .select("member_id, name")
      .in("member_id", missing)
      .then(({ data }) => {
        if (!data) return
        setSenderNames((prev) => {
          const next = { ...prev }
          for (const m of data) next[m.member_id] = m.name
          return next
        })
        const owner = data.find((m) => m.member_id === conversation.member_id)
        if (owner) setMemberName(owner.name)
      })
  }, [isAdmin, conversation, messages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" })
  }, [messages.length])

  function addFiles(picked: File[]) {
    const { accepted, error } = acceptChatFiles(files, picked)
    setSendError(error)
    if (accepted.length > 0) setFiles((prev) => [...prev, ...accepted])
  }

  // Grow the reply box with its text (up to max-h-36, then it scrolls).
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [draft])

  const canSend = !sending && (draft.trim().length > 0 || files.length > 0)

  async function send() {
    const body = draft.trim()
    if ((!body && files.length === 0) || sending || !member) return
    setSending(true)
    setSendError("")

    const { attachments, error: uploadError } = await uploadChatAttachments(conversationId, member.member_id, files)
    if (uploadError) {
      setSending(false)
      setSendError(`Couldn't upload: ${uploadError}`)
      return
    }

    const { data, error } = await supabase
      .from("conversation_messages")
      .insert({ conversation_id: conversationId, sender_id: member.member_id, body, attachments })
      .select(MESSAGE_COLUMNS)
      .single()
    setSending(false)
    if (error) {
      await removeChatAttachments(attachments.map((a) => a.path))
      setSendError(error.message)
      return
    }
    setDraft("")
    setFiles([])
    setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]))
    // A new message reopens a closed thread server-side; mirror it here.
    setConversation((c) => (c ? { ...c, status: "open" } : c))
  }

  async function toggleStatus() {
    if (!conversation || statusBusy) return
    const next = conversation.status === "open" ? "closed" : "open"
    setStatusBusy(true)
    const { error } = await setConversationStatus(conversation.id, next)
    setStatusBusy(false)
    if (!error) setConversation({ ...conversation, status: next })
  }

  const Header = isBorrower ? BorrowerHeader : Navbar
  // Borrowers have no bottom dock, so the composer sits on the safe area
  // instead of above the (absent) dock.
  const composerBottom = isBorrower ? "env(safe-area-inset-bottom)" : "var(--dock-h)"

  if (authLoading || !member || loading) {
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

  return (
    <>
      <Header />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        {/* Clears the fixed composer, which is taller while files are queued. */}
        <div
          className={`max-w-3xl mx-auto px-4 sm:px-5 pt-8 ${
            files.length > 0
              ? "pb-[calc(14rem+var(--dock-h)+env(safe-area-inset-bottom))]"
              : "pb-[calc(9rem+var(--dock-h)+env(safe-area-inset-bottom))]"
          }`}
        >
          <button
            onClick={() => router.push("/messages")}
            className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors"
          >
            ← {isAdmin ? "Member Questions" : "Chat with Est. 2017"}
          </button>

          {loadError || !conversation ? (
            <p className="text-sm text-rust">{loadError || "Conversation not found."}</p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3 mb-6">
                <div className="min-w-0">
                  <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
                    {isAdmin ? memberName || "Member" : "With the admins"}
                    {conversation.status === "closed" && " · Closed"}
                  </div>
                  <h1 className="font-display text-2xl sm:text-3xl font-semibold text-ink break-words">
                    {conversation.subject}
                  </h1>
                </div>
                {isAdmin && (
                  <button
                    onClick={toggleStatus}
                    disabled={statusBusy}
                    className="shrink-0 border border-hairline px-3.5 py-2 rounded-md text-sm disabled:opacity-60"
                  >
                    {conversation.status === "open" ? "Close" : "Reopen"}
                  </button>
                )}
              </div>

              <div className="space-y-3">
                {messages.map((m) => {
                  const mine = m.sender_id === member.member_id
                  const fromThreadMember = m.sender_id === conversation.member_id
                  const label = mine
                    ? "You"
                    : isAdmin
                      ? senderNames[m.sender_id] ?? (fromThreadMember ? "Member" : "Admin")
                      : "Admins"
                  return (
                    <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                      <div
                        className={`max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm whitespace-pre-wrap break-words ${
                          mine ? "bg-gold-soft text-ink" : "bg-paper-2 border border-hairline text-ink"
                        }`}
                      >
                        {m.attachments?.length > 0 && <MessageAttachments attachments={m.attachments} />}
                        {m.body && <div className={m.attachments?.length > 0 ? "mt-2" : ""}>{m.body}</div>}
                      </div>
                      <span className="text-[11px] text-ink-soft font-mono mt-1 px-1">
                        {label} · {formatMessageTime(m.created_at)}
                      </span>
                    </div>
                  )
                })}
                <div ref={bottomRef} />
              </div>
            </>
          )}
        </div>
      </main>

      {conversation && !loadError && (
        <div className="fixed inset-x-0 z-30 bg-paper border-t border-hairline" style={{ bottom: composerBottom }}>
          <div className="max-w-3xl mx-auto px-4 sm:px-5 py-3">
            {sendError && <p className="text-xs text-rust mb-2">{sendError}</p>}
            {/* One bar, chat-app style: attach, a text box that grows with
                what's typed, and send -- with pending files inside it. */}
            <div className="card overflow-hidden focus-within:border-gold transition-colors">
              {files.length > 0 && (
                <div className="px-2.5 pt-2.5">
                  <PendingAttachments files={files} onRemove={(i) => setFiles((prev) => prev.filter((_, j) => j !== i))} />
                </div>
              )}
              <div className="flex items-end gap-1 p-1.5">
                <AttachButton count={files.length} disabled={sending} onPick={addFiles} />
                <textarea
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      send()
                    }
                  }}
                  maxLength={BODY_MAX}
                  rows={1}
                  aria-label="Message"
                  placeholder={files.length > 0 ? "Add a note (optional)" : isAdmin ? "Reply as the admin team…" : "Write a message…"}
                  // 16px on phones: iOS zooms the page into any input smaller than that.
                  className="flex-1 min-w-0 bg-transparent px-1.5 py-2 text-base sm:text-sm leading-6 text-ink placeholder:text-ink-soft outline-none resize-none max-h-36"
                />
                <button
                  type="button"
                  onClick={send}
                  disabled={!canSend}
                  aria-label="Send"
                  className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                    canSend ? "bg-gold text-paper" : "bg-paper text-ink-soft"
                  }`}
                >
                  {sending ? (
                    <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" className="w-[18px] h-[18px]">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-6 6m6-6l6 6" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
