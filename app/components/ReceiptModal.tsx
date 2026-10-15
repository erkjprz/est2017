"use client"

import { useEffect, useState } from "react"
import { getReceiptSignedUrl } from "@/lib/receiptUrl"

// Opens on paths[startIndex]; with more than one file (a transfer proved
// by several screenshots), arrows and a counter step through the rest.
export default function ReceiptModal({
  paths,
  startIndex = 0,
  onClose
}: {
  paths: string[]
  startIndex?: number
  onClose: () => void
}) {
  const [index, setIndex] = useState(startIndex)
  const path = paths[index]
  const [url, setUrl] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  function go(delta: number) {
    setIndex((i) => (i + delta + paths.length) % paths.length)
    setUrl(null)
    setLoaded(false)
    setFailed(false)
  }

  useEffect(() => {
    let cancelled = false

    getReceiptSignedUrl(path).then((signedUrl) => {
      if (cancelled) return
      if (!signedUrl) {
        setFailed(true)
        return
      }
      setUrl(signedUrl)
    })

    return () => {
      cancelled = true
    }
  }, [path])

  return (
    <div
      // No backdrop-blur -- `backdrop-filter` on a `position: fixed`
      // element is a known WebKit compositing bug on iOS (see Sheet.tsx);
      // bg-black/80 is opaque enough on its own. z-[60], one above Sheet's
      // z-50: it's opened from inside sheets (e.g. Admin's Review
      // transaction), and at an equal z-index it painted behind them.
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="relative max-w-lg w-full min-h-72 max-h-[85vh] bg-paper-2 border border-hairline rounded-sm overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute top-3 right-3 z-10 bg-ink text-paper w-8 h-8 rounded-full flex items-center justify-center text-lg leading-none"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>

        {url && !failed && (
          <img
            key={url}
            src={url}
            alt="Receipt"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={`block w-full h-auto max-h-[85vh] object-contain mx-auto bg-paper transition-opacity duration-300 ${
              loaded ? "opacity-100" : "opacity-0"
            }`}
          />
        )}

        {!loaded && !failed && (
          <div className="absolute inset-0 flex items-center justify-center bg-paper-2 animate-pulse">
            <span className="w-9 h-9 rounded-full border-[3px] border-hairline border-t-gold animate-spin" />
          </div>
        )}

        {failed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-paper-2 text-ink-soft text-sm">
            <span className="text-2xl">🧾</span>
            {/* A PDF proof can't render as an image -- offer it directly. */}
            {url ? (
              <a href={url} target="_blank" rel="noopener noreferrer" className="text-gold underline">
                Open this file
              </a>
            ) : (
              "Couldn't load this receipt."
            )}
          </div>
        )}

        {paths.length > 1 && (
          <div className="absolute bottom-3 inset-x-0 z-10 flex items-center justify-center gap-3">
            <button
              type="button"
              className="bg-ink text-paper w-8 h-8 rounded-full flex items-center justify-center text-lg leading-none"
              onClick={() => go(-1)}
              aria-label="Previous receipt"
            >
              ‹
            </button>
            <span className="bg-ink text-paper rounded-full px-3 py-1 text-[12px] font-mono">
              {index + 1} / {paths.length}
            </span>
            <button
              type="button"
              className="bg-ink text-paper w-8 h-8 rounded-full flex items-center justify-center text-lg leading-none"
              onClick={() => go(1)}
              aria-label="Next receipt"
            >
              ›
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
