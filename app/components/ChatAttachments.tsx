"use client"

import { useEffect, useMemo, useState } from "react"
import { formatFileSize, getChatAttachmentUrl, type ChatAttachment } from "@/lib/conversations"

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

// Files picked in the composer but not sent yet, each removable.
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
    <div className="flex gap-2 overflow-x-auto pb-2">
      {files.map((file, i) => (
        <div key={`${file.name}-${file.lastModified}-${i}`} className="relative shrink-0">
          {previews[i] ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
            <img src={previews[i]!} alt={file.name} className="w-16 h-16 object-cover rounded-md border border-hairline" />
          ) : (
            <div className="w-16 h-16 rounded-md border border-hairline bg-paper-2 flex flex-col items-center justify-center px-1">
              <span className="text-xl">📄</span>
              <span className="text-[9px] text-ink-soft truncate w-full text-center">{file.name}</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-ink text-paper text-[11px] leading-none flex items-center justify-center"
            aria-label={`Remove ${file.name}`}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
