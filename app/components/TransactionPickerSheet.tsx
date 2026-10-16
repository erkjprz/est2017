"use client"

import { useEffect, useState } from "react"
import { Sheet } from "@/app/components/Sheet"
import { SkeletonPanel } from "@/app/components/Skeleton"
import { TransactionRow, type Txn } from "@/app/components/transactions/TransactionParts"
import { listMemberTransactions } from "@/lib/conversations"

// A member's entries (and their loans'), newest first -- the rows a chat
// with them can be about. Tapping one picks it. Used to link a transaction
// to an existing thread and when starting a new one.
export function TransactionPickerSheet({
  memberId,
  title,
  currentId,
  busy,
  error,
  onPick,
  onClose
}: {
  memberId: string
  title: string
  currentId: string | null
  busy?: boolean
  error?: string
  onPick: (t: Txn) => void
  onClose: () => void
}) {
  const [rows, setRows] = useState<Txn[] | null>(null)
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    let cancelled = false
    listMemberTransactions(memberId).then(({ data, error }) => {
      if (cancelled) return
      if (error) setLoadError(error)
      setRows(data.filter((t) => t.transaction_id !== currentId))
    })
    return () => {
      cancelled = true
    }
  }, [memberId, currentId])

  return (
    <Sheet title={title} onClose={onClose}>
      {error && <p className="text-sm text-rust mb-3">{error}</p>}
      {loadError && <p className="text-sm text-rust mb-3">Couldn&apos;t load transactions: {loadError}</p>}
      {rows === null ? (
        <SkeletonPanel />
      ) : rows.length === 0 && !loadError ? (
        <p className="text-sm text-ink-soft text-center py-8">No other transactions for this member.</p>
      ) : (
        <div className={`space-y-2 ${busy ? "opacity-60 pointer-events-none" : ""}`}>
          {rows.map((t) => (
            <TransactionRow key={t.transaction_id} t={t} onOpen={() => onPick(t)} />
          ))}
        </div>
      )}
    </Sheet>
  )
}
