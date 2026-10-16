"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Navbar from "@/app/components/Navbar"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/app/auth-context"
import { SkeletonCardList } from "@/app/components/Skeleton"
import { readCache, writeCache } from "@/lib/cache"
import { Sheet } from "@/app/components/Sheet"
import { Toast } from "@/app/components/Toast"
import { FieldRow, PersonIcon, MailIcon, rowSelectClass, rowInputClass } from "@/app/components/TransactionFormUI"
import {
  ConfirmSheet,
  DeactivateBody,
  EditPersonSheet,
  FilterChips,
  PeopleSearch,
  PersonRow,
  PersonSheet,
  matchesSearch,
  usePersonParam,
  useActiveLoansByMember,
  type PersonAction
} from "@/app/components/admin/People"
import {
  addPerson,
  deactivatePerson,
  reactivatePerson,
  type Person
} from "@/lib/memberAdmin"

// Same global admin data for any admin -- no per-user scoping needed.
const MEMBERS_CACHE_KEY = "admin:members-list"

type Filter = "all" | "members" | "borrowers" | "pending" | "inactive"

// ?filter=borrowers (old /admin/borrowers links) opens on that chip. Only
// read in the browser; the page renders a skeleton until auth has loaded,
// so this never differs from the server's first render.
function initialFilter(): Filter {
  if (typeof window === "undefined") return "all"
  const requested = new URLSearchParams(window.location.search).get("filter")
  return requested === "members" || requested === "borrowers" || requested === "pending" || requested === "inactive"
    ? requested
    : "all"
}

export default function AdminMembersPage() {
  const router = useRouter()
  const { loading: authLoading, member: authMember } = useAuth()
  const cachedMembers = readCache<Person[]>(MEMBERS_CACHE_KEY)

  const [members, setMembers] = useState<Person[]>(cachedMembers ?? [])
  const [loaded, setLoaded] = useState(Boolean(cachedMembers))

  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<Filter>(initialFilter)
  const [toast, setToast] = useState("")
  const [error, setError] = useState("")

  const [showAddForm, setShowAddForm] = useState(false)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [role, setRole] = useState("member")
  const [adding, setAdding] = useState(false)

  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false)
  const [busy, setBusy] = useState(false)

  const { byMember: activeLoans, reload: reloadLoans } = useActiveLoansByMember()

  async function loadMembers() {
    const { data } = await supabase
      .from("members")
      .select("*")
      .order("created_at", { ascending: false })

    const next = data ?? []
    setMembers(next)
    setLoaded(true)
    writeCache(MEMBERS_CACHE_KEY, next)
  }

  useEffect(() => {
    if (authLoading) return

    if (!authMember) {
      router.push("/login")
      return
    }

    if (authMember.role !== "admin") {
      router.push("/dashboard")
      return
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data once the auth check above passes
    loadMembers()
    reloadLoans()
  }, [authLoading, authMember, router, reloadLoans])

  usePersonParam(loaded, openPerson)

  // Drop ?filter= once it's been read (see initialFilter) so a refresh
  // starts from All.
  useEffect(() => {
    if (window.location.search.includes("filter=")) window.history.replaceState(null, "", window.location.pathname)
  }, [])

  function openPerson(id: string) {
    setOpenId(id)
    setEditing(false)
    setConfirmingDeactivate(false)
    setError("")
  }

  function closePerson() {
    setOpenId(null)
    setEditing(false)
    setConfirmingDeactivate(false)
  }

  // Runs one write for the open person, then reports it and refreshes.
  async function run(write: () => Promise<void>, done: string, close = true) {
    setBusy(true)
    setError("")
    try {
      await write()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
      setBusy(false)
      return
    }
    setBusy(false)
    if (close) closePerson()
    setToast(done)
    loadMembers()
  }

  async function addMember() {
    if (!name.trim()) {
      setError("Enter a name.")
      return
    }
    setAdding(true)
    setError("")
    try {
      await addPerson(name, email, role)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
      setAdding(false)
      return
    }
    setAdding(false)
    setToast(`${name} added`)
    setName("")
    setEmail("")
    setRole("member")
    setShowAddForm(false)
    loadMembers()
  }

  const counts = {
    all: members.length,
    members: members.filter((m) => m.role !== "borrower" && m.status !== "inactive").length,
    borrowers: members.filter((m) => m.role === "borrower" && m.status !== "inactive").length,
    pending: members.filter((m) => m.status === "pending").length,
    inactive: members.filter((m) => m.status === "inactive").length
  }
  const chips = [
    { id: "all" as Filter, label: "All", count: counts.all },
    // Pending only shows up when someone is actually waiting.
    ...(counts.pending > 0 ? [{ id: "pending" as Filter, label: "Pending", count: counts.pending }] : []),
    { id: "members" as Filter, label: "Members", count: counts.members },
    { id: "borrowers" as Filter, label: "Borrowers", count: counts.borrowers },
    { id: "inactive" as Filter, label: "Inactive", count: counts.inactive }
  ]
  const activeFilter: Filter = filter === "pending" && counts.pending === 0 ? "all" : filter

  const inFilter = (m: Person) => {
    if (activeFilter === "members") return m.role !== "borrower" && m.status !== "inactive"
    if (activeFilter === "borrowers") return m.role === "borrower" && m.status !== "inactive"
    if (activeFilter === "pending") return m.status === "pending"
    if (activeFilter === "inactive") return m.status === "inactive"
    return true
  }
  // Pending first (they're waiting on someone), then by name, inactive last.
  const rank = (m: Person) => (m.status === "pending" ? 0 : m.status === "inactive" ? 2 : 1)
  const visible = members
    .filter((m) => inFilter(m) && matchesSearch(m, search))
    .sort((a, b) => rank(a) - rank(b) || (a.name ?? "").localeCompare(b.name ?? ""))

  const openPersonRow = members.find((m) => m.member_id === openId) ?? null

  function actionsFor(p: Person): PersonAction[] {
    const actions: PersonAction[] = []
    if (p.status === "pending") {
      actions.push(
        p.role === "borrower"
          ? {
              label: "Approve borrower",
              hint: "Approve them in the Admin queue",
              onClick: () => router.push(`/admin?signup=${p.member_id}`)
            }
          : {
              label: "Review signup",
              hint: "Approve them, or link them to an existing record, in the Admin queue",
              onClick: () => router.push(`/admin?signup=${p.member_id}`)
            }
      )
    }
    actions.push({
      label: "Edit details",
      hint: p.role === "borrower" ? "Name, email, role, status" : "Name, email, role, status, gain sharing",
      onClick: () => setEditing(true)
    })
    if (p.status === "approved") {
      actions.push({ label: "Message", hint: `Open a chat with ${p.name}`, onClick: () => router.push(`/messages?to=${p.member_id}`) })
    }
    if (p.role === "borrower") {
      actions.push({ label: "View as", hint: "See the app the way they see it", onClick: () => router.push(`/admin/view-as/${p.member_id}`) })
    }
    if (p.status === "inactive") {
      actions.push({
        label: busy ? "Reactivating…" : "Reactivate",
        hint: p.role === "borrower" ? "Let them sign in again" : "Let them sign in and share in gains again",
        onClick: () => {
          if (busy) return
          run(() => reactivatePerson(p.member_id, p.role === "borrower"), `${p.name} reactivated`)
        }
      })
    } else {
      actions.push({
        label: "Deactivate",
        hint: "Lock them out of the app",
        danger: true,
        onClick: () => setConfirmingDeactivate(true)
      })
    }
    return actions
  }

  if (authLoading || !authMember || authMember.role !== "admin") {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(6rem+var(--dock-h)+env(safe-area-inset-bottom))]">
            <SkeletonCardList rows={3} />
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(6rem+var(--dock-h)+env(safe-area-inset-bottom))]">
          <button
            onClick={() => router.push("/admin")}
            className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors"
          >
            ← Admin
          </button>
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">Administration</div>
              <h1 className="font-display text-4xl font-semibold">Members</h1>
            </div>
            <button
              className="shrink-0 bg-gold-soft text-ink px-4 py-2.5 rounded-full text-sm font-semibold"
              onClick={() => {
                setError("")
                setShowAddForm(true)
              }}
            >
              + Add
            </button>
          </div>

          {error && !openId && !showAddForm && <p className="mt-4 text-sm text-rust">{error}</p>}

          <div className="mt-6">
            <PeopleSearch value={search} onChange={setSearch} />
          </div>
          <div className="mt-3">
            <FilterChips chips={chips} active={activeFilter} onChange={setFilter} />
          </div>

          <div className="mt-4 space-y-2">
            {visible.map((m) => (
              <PersonRow key={m.member_id} person={m} onClick={() => openPerson(m.member_id)} />
            ))}

            {loaded && visible.length === 0 && (
              <p className="text-sm text-ink-soft px-1 py-2">
                {search ? `No one matches "${search}".` : "No one here."}
              </p>
            )}
          </div>

          <button
            className="mt-6 text-[13px] text-ink-soft hover:text-ink"
            onClick={() => router.push("/admin/members?newTransaction=1", { scroll: false })}
          >
            Record a transaction on someone&apos;s behalf <span className="text-gold">→</span>
          </button>
        </div>
      </main>

      {showAddForm && (
        <Sheet
          title="Add person"
          onClose={() => setShowAddForm(false)}
          footer={
            <button
              type="button"
              className="w-full bg-ink text-paper px-6 py-3.5 rounded-full text-base font-bold shadow-lg motion-safe:transition-transform motion-safe:active:scale-[0.97] disabled:opacity-50 disabled:shadow-none"
              onClick={addMember}
              disabled={adding}
            >
              {adding ? "Adding…" : "Add"}
            </button>
          }
        >
          <div className="card divide-y divide-hairline overflow-hidden">
            <FieldRow icon={<PersonIcon />}>
              <input className={rowInputClass} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            </FieldRow>
            <FieldRow icon={<MailIcon />}>
              <input
                className={rowInputClass}
                placeholder="Email (optional)"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </FieldRow>
            <FieldRow icon={<PersonIcon />}>
              <select className={rowSelectClass} value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="borrower">Borrower</option>
              </select>
            </FieldRow>
          </div>
          <p className="px-1 pt-3 text-xs text-ink-soft">
            {role === "borrower"
              ? "Borrowers can only see their own loan and don't share in gains."
              : "Added as approved, sharing in gains from now on."}
          </p>
          {error && <p className="px-1 pt-2 text-sm text-rust">{error}</p>}
        </Sheet>
      )}

      {openPersonRow && !editing && !confirmingDeactivate && (
        <PersonSheet
          person={openPersonRow}
          loans={activeLoans[openPersonRow.member_id] ?? []}
          actions={actionsFor(openPersonRow)}
          onClose={closePerson}
        >
          {error && <p className="mt-4 px-1 text-sm text-rust">{error}</p>}
        </PersonSheet>
      )}

      {openPersonRow && editing && (
        <EditPersonSheet
          person={openPersonRow}
          onClose={() => setEditing(false)}
          onSaved={() => {
            closePerson()
            setToast("Saved")
            loadMembers()
          }}
          onError={(msg) => {
            setEditing(false)
            setError(msg)
          }}
        />
      )}

      {openPersonRow && confirmingDeactivate && (
        <ConfirmSheet
          title={`Deactivate ${openPersonRow.name}?`}
          confirmLabel="Deactivate"
          busyLabel="Deactivating…"
          danger
          busy={busy}
          onClose={() => setConfirmingDeactivate(false)}
          onConfirm={() => run(() => deactivatePerson(openPersonRow.member_id), `${openPersonRow.name} deactivated`)}
        >
          <DeactivateBody person={openPersonRow} />
          {error && <p className="text-rust">{error}</p>}
        </ConfirmSheet>
      )}

      {toast && <Toast message={toast} onDone={() => setToast("")} />}
    </>
  )
}
