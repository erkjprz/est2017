"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { Sheet } from "@/app/components/Sheet"
import { AdminActionRow } from "@/app/components/breakdown/AdminMenu"
import { FieldRow, PersonIcon, MailIcon, StatusIcon, rowSelectClass, rowInputClass } from "@/app/components/TransactionFormUI"
import { updatePerson, type Person } from "@/lib/memberAdmin"
import { readCache, writeCache } from "@/lib/cache"

// The pieces behind the admin Members page: one row per person, one sheet
// per person with every action on them, and the edit / confirm sheets those
// actions open.

const fmt = (n: number) =>
  Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// One tag per person, most important first: an inactive or pending account
// is what an admin needs to notice, then the role when it isn't a plain
// member.
function personTag(p: Person): { label: string; tone: string } | null {
  if (p.status === "inactive") return { label: "Inactive", tone: "text-rust border-rust" }
  if (p.status === "pending") return { label: "Pending", tone: "text-gold border-gold" }
  if (p.role === "admin") return { label: "Admin", tone: "text-ink-soft border-hairline" }
  if (p.role === "borrower") return { label: "Borrower", tone: "text-ink-soft border-hairline" }
  return null
}

export function PersonTag({ person }: { person: Person }) {
  const tag = personTag(person)
  if (!tag) return null
  return (
    <span className={`shrink-0 text-[10px] uppercase font-mono border rounded-full px-2 py-0.5 ${tag.tone}`}>
      {tag.label}
    </span>
  )
}

export function PersonRow({ person, detail, onClick }: { person: Person; detail?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full card flex items-center gap-3 px-4 py-3 text-left">
      <div className="min-w-0 flex-1">
        <p className={`font-display font-medium truncate text-[15px] ${person.status === "inactive" ? "text-ink-soft" : ""}`}>
          {person.name}
        </p>
        <p className="text-xs text-ink-soft truncate">{detail ?? person.email ?? "No email"}</p>
      </div>
      <PersonTag person={person} />
      <span className="text-ink-soft shrink-0">›</span>
    </button>
  )
}

export function PeopleSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <input
        type="text"
        placeholder="Search by name or email"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full border border-hairline bg-paper-2 text-ink rounded-md pl-4 py-3 text-sm placeholder:text-ink-soft focus:outline-none ${
          value ? "pr-10" : "pr-4"
        }`}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border border-hairline text-ink-soft text-[11px] font-semibold flex items-center justify-center"
        >
          ×
        </button>
      )}
    </div>
  )
}

export function FilterChips<T extends string>({
  chips,
  active,
  onChange
}: {
  chips: { id: T; label: string; count: number }[]
  active: T
  onChange: (id: T) => void
}) {
  // Keeps the selected chip in view, e.g. when the page opens on a filter
  // that sits past the edge of a phone screen.
  const rowRef = useRef<HTMLDivElement>(null)
  // The counts change every chip's width once they load, so re-check then.
  const layoutKey = chips.map((c) => `${c.id}${c.count}`).join()
  useEffect(() => {
    const row = rowRef.current
    const chip = row?.querySelector<HTMLElement>(`[data-chip="${active}"]`)
    if (!row || !chip) return
    if (chip.offsetLeft + chip.offsetWidth > row.scrollLeft + row.clientWidth || chip.offsetLeft < row.scrollLeft) {
      row.scrollLeft = chip.offsetLeft - 16
    }
  }, [active, layoutKey])

  return (
    <div ref={rowRef} className="relative flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {chips.map((c) => (
        <button
          key={c.id}
          data-chip={c.id}
          onClick={() => onChange(c.id)}
          className={`shrink-0 flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
            active === c.id ? "bg-gold-soft text-ink" : "border border-hairline text-ink-soft"
          }`}
        >
          {c.label}
          <span className={`font-mono text-xs ${active === c.id ? "text-ink" : "text-ink-soft"}`}>{c.count}</span>
        </button>
      ))}
    </div>
  )
}

export function matchesSearch(p: Person, search: string) {
  const q = search.trim().toLowerCase()
  if (!q) return true
  return Boolean(p.name?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q))
}

// Opens a person's sheet straight from a ?person= link, then drops the
// param so a refresh doesn't reopen it.
export function usePersonParam(ready: boolean, open: (id: string) => void) {
  useEffect(() => {
    if (!ready) return
    const params = new URLSearchParams(window.location.search)
    const id = params.get("person")
    if (!id) return
    open(id)
    params.delete("person")
    const qs = params.toString()
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])
}

export type PersonLoan = { loan_id: string; loan: string; outstanding: number }

const ACTIVE_LOANS_CACHE_KEY = "admin:active-loans-by-member"

// Every person's active loans, keyed by member -- loans on their own
// account, plus any on a pre-app loan record already linked to them.
// Loaded once with the page (and cached) so a person's sheet opens with
// them already in place, instead of fetching on open and shifting the
// sheet once they arrive. Requested and closed loans are left out; the
// Loans page has those.
export function useActiveLoansByMember() {
  const [byMember, setByMember] = useState<Record<string, PersonLoan[]>>(
    () => readCache<Record<string, PersonLoan[]>>(ACTIVE_LOANS_CACHE_KEY) ?? {}
  )

  const reload = useCallback(async () => {
    const [{ data: loans }, { data: records }, { data: summary }] = await Promise.all([
      supabase.from("loans").select("loan_id, member_id, borrower_id").eq("status", "active"),
      supabase.from("borrowers").select("borrower_id, member_id").not("member_id", "is", null),
      supabase
        .from("v_loan_summary")
        .select("loan_id, loan, outstanding")
        .eq("status", "active")
        .order("start_date", { ascending: false })
    ])
    const memberByRecord = new Map((records ?? []).map((r) => [r.borrower_id as string, r.member_id as string]))
    const ownerByLoan = new Map(
      (loans ?? []).map((l) => [l.loan_id as string, (l.member_id ?? memberByRecord.get(l.borrower_id)) as string | undefined])
    )
    const next: Record<string, PersonLoan[]> = {}
    for (const l of (summary as PersonLoan[]) ?? []) {
      const owner = ownerByLoan.get(l.loan_id)
      if (owner) (next[owner] ??= []).push(l)
    }
    setByMember(next)
    writeCache(ACTIVE_LOANS_CACHE_KEY, next)
  }, [])

  return { byMember, reload }
}

function PersonLoans({ loans }: { loans: PersonLoan[] }) {
  const router = useRouter()
  if (loans.length === 0) return null

  return (
    <div className="mt-5">
      <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">Active loans</p>
      <div className="card px-4">
        {loans.map((l, i) => (
          <button
            key={l.loan_id}
            onClick={() => router.push(`/fund-breakdown?tab=loans&loan=${l.loan_id}`)}
            className={`w-full py-3 flex items-center justify-between gap-3 text-left ${
              i === loans.length - 1 ? "" : "border-b border-dashed border-hairline"
            }`}
          >
            <span className="min-w-0">
              <span className="block text-sm text-ink font-medium truncate">{l.loan}</span>
            </span>
            <span className="flex items-center gap-2 shrink-0">
              <span className="text-right">
                <span className="block font-mono [font-variant-numeric:tabular-nums] text-sm">₱{fmt(l.outstanding)}</span>
                <span className="block text-[11px] text-ink-soft">outstanding</span>
              </span>
              <span className="text-ink-soft">›</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

export type PersonAction = { label: string; hint: string; onClick: () => void; danger?: boolean }

// Everything about one person in one place: who they are, what's waiting
// on them (children -- e.g. an error from the last action), their loans, then every
// action an admin can take on them.
export function PersonSheet({
  person,
  loans,
  actions,
  onClose,
  footer,
  children
}: {
  person: Person
  // From useActiveLoansByMember -- an empty list hides the section.
  loans: PersonLoan[]
  actions: PersonAction[]
  onClose: () => void
  footer?: ReactNode
  children?: ReactNode
}) {
  const joined = person.created_at
    ? new Date(person.created_at).toLocaleDateString(undefined, { month: "short", year: "numeric" })
    : null
  const roleLabel = person.role === "admin" ? "Admin" : person.role === "borrower" ? "Borrower" : "Member"

  return (
    <Sheet title={person.name} onClose={onClose} footer={footer}>
      <div className="flex items-start justify-between gap-3 px-1">
        <div className="min-w-0">
          <p className="text-sm text-ink truncate">{person.email || "No email"}</p>
          <p className="text-xs text-ink-soft mt-0.5">
            {roleLabel}
            {joined && ` · joined ${joined}`}
            {person.role !== "borrower" && person.status === "approved" && person.gain_sharing_eligible === false &&
              " · not sharing in gains"}
          </p>
        </div>
        <PersonTag person={person} />
      </div>

      {children}

      <PersonLoans loans={loans} />

      {actions.length > 0 && (
        <div className="card px-4 mt-5">
          {actions.map((a, i) => (
            <AdminActionRow key={a.label} {...a} last={i === actions.length - 1} />
          ))}
        </div>
      )}
    </Sheet>
  )
}

const primaryButton =
  "w-full bg-ink text-paper px-6 py-3.5 rounded-full text-base font-bold shadow-lg motion-safe:transition-transform motion-safe:active:scale-[0.97] disabled:opacity-50 disabled:shadow-none"

export function EditPersonSheet({
  person,
  onClose,
  onSaved,
  onError
}: {
  person: Person
  onClose: () => void
  onSaved: () => void
  onError: (message: string) => void
}) {
  const [name, setName] = useState(person.name ?? "")
  const [email, setEmail] = useState(person.email ?? "")
  const [role, setRole] = useState(person.role ?? "member")
  const [status, setStatus] = useState(person.status ?? "approved")
  const [gainSharing, setGainSharing] = useState(person.gain_sharing_eligible !== false)
  const [saving, setSaving] = useState(false)

  // Borrowers never share in gains, and neither does anyone inactive --
  // the box is locked off for both rather than letting it be ticked.
  const gainSharingLocked = role === "borrower" || status === "inactive"

  async function save() {
    setSaving(true)
    try {
      await updatePerson(person.member_id, {
        name,
        email,
        role,
        status,
        gainSharingEligible: role === "borrower" ? false : gainSharing
      })
    } catch (err) {
      setSaving(false)
      onError(err instanceof Error ? err.message : "Something went wrong.")
      return
    }
    onSaved()
  }

  return (
    <Sheet
      title="Edit details"
      onClose={onClose}
      footer={
        <button type="button" className={primaryButton} onClick={save} disabled={saving || !name.trim()}>
          {saving ? "Saving…" : "Save"}
        </button>
      }
    >
      <div className="card divide-y divide-hairline overflow-hidden">
        <FieldRow icon={<PersonIcon />}>
          <input className={rowInputClass} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        </FieldRow>
        <FieldRow icon={<MailIcon />}>
          <input className={rowInputClass} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </FieldRow>
        <FieldRow icon={<PersonIcon />}>
          <select
            className={rowSelectClass}
            value={role}
            onChange={(e) => {
              // Moving someone off Borrower restores the usual default.
              if (role === "borrower" && e.target.value !== "borrower") setGainSharing(true)
              setRole(e.target.value)
            }}
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            <option value="borrower">Borrower</option>
          </select>
        </FieldRow>
        <FieldRow icon={<StatusIcon />}>
          <select
            className={rowSelectClass}
            value={status}
            onChange={(e) => {
              // Bringing someone back from inactive restores gain sharing,
              // same as the Reactivate button (it can still be unticked).
              if (status === "inactive" && e.target.value !== "inactive" && role !== "borrower") setGainSharing(true)
              setStatus(e.target.value)
            }}
          >
            <option value="approved">Approved</option>
            <option value="pending">Pending</option>
            <option value="inactive">Inactive</option>
          </select>
        </FieldRow>
      </div>

      <label className="flex items-start gap-2.5 text-sm text-ink-soft px-1 pt-4">
        <input
          type="checkbox"
          checked={gainSharingLocked ? false : gainSharing}
          onChange={(e) => setGainSharing(e.target.checked)}
          disabled={gainSharingLocked}
          className="w-4 h-4 mt-0.5 shrink-0 disabled:opacity-50"
        />
        <span>
          Shares in gains
          <span className="block text-xs">
            {role === "borrower"
              ? "Always off for borrowers."
              : status === "inactive"
                ? "Always off while inactive."
                : "Gets a share of loan interest, bank interest and investment returns."}
          </span>
        </span>
      </label>
    </Sheet>
  )
}

export function ConfirmSheet({
  title,
  children,
  confirmLabel,
  busyLabel,
  danger = false,
  busy,
  onConfirm,
  onClose
}: {
  title: string
  children: ReactNode
  confirmLabel: string
  busyLabel: string
  danger?: boolean
  busy: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <button
          type="button"
          className={`w-full px-6 py-3.5 rounded-full text-base font-bold shadow-lg motion-safe:transition-transform motion-safe:active:scale-[0.97] disabled:opacity-50 disabled:shadow-none ${
            danger ? "bg-rust text-paper" : "bg-ink text-paper"
          }`}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? busyLabel : confirmLabel}
        </button>
      }
    >
      <div className="text-sm text-ink-soft space-y-3 px-1">{children}</div>
    </Sheet>
  )
}

export function DeactivateBody({ person }: { person: Person }) {
  return (
    <>
      <p>
        <span className="text-ink font-semibold">{person.name}</span>{" "}
        {person.role === "borrower"
          ? "won't be able to sign in to see or repay their loan."
          : "won't be able to sign in, and stops sharing in future loan interest, bank interest and investment returns."}
      </p>
      <p>Their transactions and balance stay exactly as they are. You can reactivate them any time.</p>
    </>
  )
}
