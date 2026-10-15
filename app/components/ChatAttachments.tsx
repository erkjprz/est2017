"use client"

import { useEffect, useMemo, useState } from "react"
import { ATTACHMENTS_MAX, formatFileSize, getChatAttachmentUrl, type ChatAttachment } from "@/lib/conversations"

// Attachments inside a chat bubble: photos as thumbnails (tap for full
// size), anything else as a file chip that downloads it.
export function MessageAttachments({ attachments }: { attachments: ChatAttachment[] }) {
  const [viewing, setViewing] = useState<{ url: string; name: string } | null>(null)
  const photos = attachments.filter((a) => a.type.startsWith("image/"))
  const files = attachments.filter((a) => !a.type.startsWith("image/"))

  return (
    <>
      {photos.length > 0 && (
        <div className={`grid gap-1.5 ${photos.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
          {photos.map((a) => (
            <PhotoThumb key={a.path} attachment={a} onOpen={(url) => setViewing({ url, name: a.name })} />
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className={`space-y-1.5 ${photos.length > 0 ? "mt-1.5" : ""}`}>
          {files.map((a) => (
            <FileChip key={a.path} attachment={a} />
          ))}
        </div>
      )}
      {viewing && <PhotoViewer url={viewing.url} name={viewing.name} onClose={() => setViewing(null)} />}
    </>
  )
}

function useSignedUrl(path: string, download?: string) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    getChatAttachmentUrl(path, download).then((signed) => {
      if (cancelled) return
      if (signed) setUrl(signed)
      else setFailed(true)
    })
    return () => {
      cancelled = true
    }
  }, [path, download])
  return { url, failed }
}

function PhotoThumb({ attachment, onOpen }: { attachment: ChatAttachment; onOpen: (url: string) => void }) {
  const { url, failed } = useSignedUrl(attachment.path)
  if (failed) return <FileChip attachment={attachment} />
  return (
    <button
      type="button"
      onClick={() => url && onOpen(url)}
      className="block w-full max-w-[260px] rounded-md overflow-hidden border border-hairline bg-paper"
      aria-label={`Open ${attachment.name}`}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not a static asset
        <img src={url} alt={attachment.name} className="w-full max-h-64 object-cover" />
      ) : (
        <span className="block w-full h-40 animate-pulse" />
      )}
    </button>
  )
}

function FileChip({ attachment }: { attachment: ChatAttachment }) {
  const { url } = useSignedUrl(attachment.path, attachment.name)
  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noreferrer"
      aria-disabled={!url}
      className="flex items-center gap-2.5 rounded-md border border-hairline bg-paper px-3 py-2 text-left"
    >
      <span className="text-xl shrink-0">📄</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-ink truncate">{attachment.name}</span>
        <span className="block text-[11px] text-ink-soft">{formatFileSize(attachment.size)}</span>
      </span>
      <span className="text-ink-soft shrink-0 text-sm">↓</span>
    </a>
  )
}

function PhotoViewer({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={onClose}>
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 text-white text-2xl leading-none"
        style={{ top: "calc(1rem + env(safe-area-inset-top))" }}
        aria-label="Close"
      >
        ✕
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not a static asset */}
      <img src={url} alt={name} className="max-w-full max-h-full object-contain" onClick={(e) => e.stopPropagation()} />
    </div>
  )
}

// Files picked in the composer but not sent yet, each removable. The remove
// button sits inside the tile's corner (not hanging off it) so the
// horizontal scroller can't clip it, and is dark-on-photo in either theme.
export function PendingAttachments({ files, onRemove }: { files: File[]; onRemove: (index: number) => void }) {
  const previews = useMemo(
    () => files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null)),
    [files]
  )
  useEffect(
    () => () => {
      for (const p of previews) if (p) URL.revokeObjectURL(p)
    },
    [previews]
  )

  if (files.length === 0) return null
  return (
    <div className="flex gap-2 overflow-x-auto">
      {files.map((file, i) => (
        <div
          key={`${file.name}-${file.lastModified}-${i}`}
          className="relative shrink-0 w-[72px] h-[72px] rounded-md overflow-hidden border border-hairline bg-paper"
        >
          {previews[i] ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
            <img src={previews[i]!} alt={file.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-end gap-0.5 px-1.5 pb-1.5">
              <FileIcon className="w-5 h-5 text-ink-soft" />
              <span className="text-[10px] leading-tight text-ink truncate w-full text-center">{file.name}</span>
              <span className="text-[9px] text-ink-soft">{formatFileSize(file.size)}</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="absolute top-1 right-1 w-[22px] h-[22px] rounded-full bg-black/65 text-white flex items-center justify-center"
            aria-label={`Remove ${file.name}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3 h-3">
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}

export function PaperclipIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={className} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13"
      />
    </svg>
  )
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={className} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
      />
    </svg>
  )
}

const ACCEPT = "image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"

// Opens the file picker. With a label it's a quiet text button for a
// toolbar ("Add photos or files"); without one, an icon button sized to sit
// next to the composer's Send. Disabled while sending or once the
// per-message cap is reached.
export function AttachButton({
  count,
  disabled,
  onPick,
  label
}: {
  count: number
  disabled?: boolean
  onPick: (files: File[]) => void
  label?: string
}) {
  const off = disabled || count >= ATTACHMENTS_MAX
  return (
    <label
      className={`shrink-0 flex items-center text-ink-soft hover:text-ink transition-colors ${
        label ? "gap-1.5 text-sm py-1.5 pr-2" : "justify-center w-10 h-10 rounded-full hover:bg-paper-2"
      } ${off ? "opacity-40 pointer-events-none" : "cursor-pointer"}`}
      aria-label={label ? undefined : "Attach photos or files"}
      title="Attach photos or files"
    >
      <PaperclipIcon className={label ? "w-[18px] h-[18px]" : "w-[22px] h-[22px]"} />
      {label && <span>{label}</span>}
      <input
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          onPick(Array.from(e.target.files ?? []))
          // Reset so picking the same file again still fires onChange.
          e.target.value = ""
        }}
      />
    </label>
  )
}
