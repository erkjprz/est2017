import { supabase } from "@/lib/supabase"

// Receipts are stored in a private bucket; callers hold onto the storage
// path (not a durable URL) and resolve a short-lived signed URL right
// before displaying it.
export async function getReceiptSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from("Receipts").createSignedUrl(path, 3600)
  if (error) return null
  return data.signedUrl
}

// Every receipt file on a transaction row, in order. receipt_urls is the
// list; receipt_url (its first entry, kept in sync by the database) is
// only a fallback for rows cached before the list existed.
export function receiptPaths(t: { receipt_urls?: string[] | null; receipt_url?: string | null } | null | undefined): string[] {
  if (!t) return []
  if (t.receipt_urls && t.receipt_urls.length > 0) return t.receipt_urls
  return t.receipt_url ? [t.receipt_url] : []
}

// Uploads each file under "<prefix>-<timestamp>-<n>-<name>" -- the prefix
// is the member id for member-owned receipts, so the Receipts bucket's
// read policy still lets that member (or borrower) see their own files.
// All-or-nothing: if any upload fails, the ones that already landed are
// removed again so nothing is left orphaned in the bucket.
export async function uploadReceipts(
  files: File[],
  prefix: string
): Promise<{ paths: string[]; error: string | null }> {
  const stamp = Date.now()
  const results = await Promise.all(
    files.map(async (file, i) => {
      const path = `${prefix}-${stamp}-${i + 1}-${file.name}`
      const { error } = await supabase.storage.from("Receipts").upload(path, file, { contentType: file.type })
      return { path, error }
    })
  )
  const failed = results.find((r) => r.error)
  if (failed) {
    await removeReceipts(results.filter((r) => !r.error).map((r) => r.path))
    return { paths: [], error: failed.error!.message }
  }
  return { paths: results.map((r) => r.path), error: null }
}

export async function removeReceipts(paths: string[]) {
  if (paths.length > 0) await supabase.storage.from("Receipts").remove(paths)
}
