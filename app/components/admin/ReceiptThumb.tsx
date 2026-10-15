"use client"

import { useEffect, useState } from "react"
import { getReceiptSignedUrl } from "@/lib/receiptUrl"

// A receipt shown in place inside a review sheet, so checking the transfer
// doesn't take a separate tap first -- tapping it still opens the full-size
// ReceiptModal. PDFs (and anything that fails to load as an image) fall
// back to a plain file chip.
export function ReceiptThumb({ path, label = "Receipt", onOpen }: { path: string; label?: string; onOpen: () => void }) {
  const isPdf = path.toLowerCase().endsWith(".pdf")
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (isPdf) return
    let cancelled = false
    getReceiptSignedUrl(path).then((signed) => {
      if (cancelled) return
      if (signed) setUrl(signed)
      else setFailed(true)
    })
    return () => {
      cancelled = true
    }
  }, [path, isPdf])

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full card overflow-hidden flex items-center gap-3 p-3 text-left"
      aria-label={`Open ${label.toLowerCase()}`}
    >
      {isPdf || failed ? (
        <span className="w-16 h-16 rounded-md border border-hairline bg-paper flex items-center justify-center text-2xl shrink-0">
          📄
        </span>
      ) : url ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not a static asset
        <img src={url} alt={label} className="w-16 h-16 rounded-md border border-hairline object-cover bg-paper shrink-0" />
      ) : (
        <span className="w-16 h-16 rounded-md border border-hairline bg-paper animate-pulse shrink-0" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="block text-[12px] text-ink-soft">Tap to view full size</span>
      </span>
      <span className="text-ink-soft shrink-0">›</span>
    </button>
  )
}

// Every receipt on a transaction, one thumb each -- numbered when there's
// more than one ("Receipt 1 of 3") so the full-size viewer's counter lines
// up with what was tapped.
export function ReceiptThumbs({
  paths,
  label = "Receipt",
  onOpen
}: {
  paths: string[]
  label?: string
  onOpen: (index: number) => void
}) {
  return (
    <div className="space-y-2">
      {paths.map((path, i) => (
        <ReceiptThumb
          key={path}
          path={path}
          label={paths.length > 1 ? `${label} ${i + 1} of ${paths.length}` : label}
          onOpen={() => onOpen(i)}
        />
      ))}
    </div>
  )
}
