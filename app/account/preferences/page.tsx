"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Navbar from "@/app/components/Navbar"
import BorrowerHeader from "@/app/components/BorrowerHeader"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"
import { readCache, writeCache } from "@/lib/cache"
import { Toast } from "@/app/components/Toast"

function isValidNonNegativeNumber(value: string): boolean {
  if (!value.trim()) return true // empty clears the preference
  const n = Number(value)
  return !Number.isNaN(n) && n >= 0
}

function AmountField({
  label,
  helper,
  value,
  onChange,
  bankId,
  onBankChange,
  banks,
  onSave,
  saving,
  message
}: {
  label: string
  helper: string
  value: string
  onChange: (v: string) => void
  bankId: string
  onBankChange: (v: string) => void
  banks: { id: string; bank_name: string; account_name: string | null }[]
  onSave: () => void
  saving: boolean
  message: string
}) {
  return (
    <div className="card p-5">
      <h2 className="font-display text-lg font-medium text-ink mb-1">{label}</h2>
      <p className="text-[13px] text-ink-soft">{helper}</p>

      <div className="mt-4 space-y-3">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft text-base">₱</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="Not set"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="border border-hairline bg-paper pl-7 pr-3 py-2 rounded-md w-full text-base leading-6 [font-variant-numeric:tabular-nums] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>

        <div>
          <label className="block mb-1.5 text-[13px] text-ink-soft">
            Bank the transfer goes to
          </label>
          {/* appearance-none so iOS doesn't apply its own native select
              height/padding -- keeps it the same size as the amount input
              (and the Account page inputs) above it. */}
          <div className="relative">
            <select
              className="appearance-none border border-hairline bg-paper text-ink text-base leading-6 rounded-md pl-3 pr-9 py-2 w-full"
              value={bankId}
              onChange={(e) => onBankChange(e.target.value)}
            >
              <option value="">Not set</option>
              {banks.map((bank) => (
                <option key={bank.id} value={bank.id}>
                  {bank.account_name || bank.bank_name}
                </option>
              ))}
            </select>
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-soft"
            >
              <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        {message && <p className="text-sm text-rust">{message}</p>}

        <button
          onClick={onSave}
          disabled={saving || !isValidNonNegativeNumber(value)}
          className="bg-ink text-paper px-4 py-2 rounded-md text-sm disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  )
}

type PreferencesSnapshot = {
  banks: { id: string; bank_name: string; account_name: string | null }[]
  contributionAmount: string
  contributionBankId: string
  loanPaymentAmount: string
  loanPaymentBankId: string
}

export default function PreferencesPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()
  const isBorrower = member?.role === "borrower"
  const cacheKey = member ? `preferences:${member.member_id}` : null
  const cached = cacheKey ? readCache<PreferencesSnapshot>(cacheKey) : undefined

  const [dataLoading, setDataLoading] = useState(!cached)
  const [banks, setBanks] = useState<{ id: string; bank_name: string; account_name: string | null }[]>(cached?.banks ?? [])
  const [contributionAmount, setContributionAmount] = useState(cached?.contributionAmount ?? "")
  const [contributionBankId, setContributionBankId] = useState(cached?.contributionBankId ?? "")
  const [loanPaymentAmount, setLoanPaymentAmount] = useState(cached?.loanPaymentAmount ?? "")
  const [loanPaymentBankId, setLoanPaymentBankId] = useState(cached?.loanPaymentBankId ?? "")

  const [savingContribution, setSavingContribution] = useState(false)
  const [contributionMessage, setContributionMessage] = useState("")
  const [savingLoanPayment, setSavingLoanPayment] = useState(false)
  const [loanPaymentMessage, setLoanPaymentMessage] = useState("")
  const [toast, setToast] = useState<string | null>(null)

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
  }, [authLoading, member, router])

  useEffect(() => {
    if (authLoading || !member || member.status !== "approved") return

    async function load() {
      if (!member) return

      // Only show the blocking loader on a true cold start -- if we
      // already rendered cached data, refresh quietly behind it instead
      // of flashing back to a spinner on every navigation.
      if (!readCache(`preferences:${member.member_id}`)) setDataLoading(true)

      const [{ data, error }, { data: bankList }] = await Promise.all([
        supabase
          .from("members")
          .select(
            "default_contribution_amount, default_contribution_bank_id, default_loan_payment_amount, default_loan_payment_bank_id"
          )
          .eq("member_id", member!.member_id)
          .single(),
        supabase.from("bank_accounts").select("id, bank_name, account_name").order("bank_name")
      ])

      const nextBanks = bankList ?? []
      setBanks(nextBanks)

      // A cleared default comes back as null, which has to overwrite the
      // cached value too -- otherwise a removed preference keeps showing
      // up from the cache on every relaunch. Only a failed query keeps
      // whatever was already on screen.
      const nextContributionAmount = error
        ? contributionAmount
        : data?.default_contribution_amount != null
          ? String(data.default_contribution_amount)
          : ""
      const nextContributionBankId = error ? contributionBankId : (data?.default_contribution_bank_id ?? "")
      const nextLoanPaymentAmount = error
        ? loanPaymentAmount
        : data?.default_loan_payment_amount != null
          ? String(data.default_loan_payment_amount)
          : ""
      const nextLoanPaymentBankId = error ? loanPaymentBankId : (data?.default_loan_payment_bank_id ?? "")
      setContributionAmount(nextContributionAmount)
      setContributionBankId(nextContributionBankId)
      setLoanPaymentAmount(nextLoanPaymentAmount)
      setLoanPaymentBankId(nextLoanPaymentBankId)
      setDataLoading(false)

      writeCache<PreferencesSnapshot>(`preferences:${member.member_id}`, {
        banks: nextBanks,
        contributionAmount: nextContributionAmount,
        contributionBankId: nextContributionBankId,
        loanPaymentAmount: nextLoanPaymentAmount,
        loanPaymentBankId: nextLoanPaymentBankId
      })
    }

    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally omitted: the left-out values are fallbacks/cache data, and depending on them would refetch in a loop
  }, [authLoading, member])

  // Keeps the cached snapshot in step with what was just saved, so a
  // relaunch paints the saved values instead of the pre-save ones.
  function updateCache(patch: Partial<PreferencesSnapshot>) {
    if (!cacheKey) return
    const prev = readCache<PreferencesSnapshot>(cacheKey)
    writeCache<PreferencesSnapshot>(cacheKey, {
      banks,
      contributionAmount,
      contributionBankId,
      loanPaymentAmount,
      loanPaymentBankId,
      ...prev,
      ...patch
    })
  }

  async function saveContribution() {
    if (savingContribution) return
    setSavingContribution(true)
    setContributionMessage("")

    const [{ error }, { error: bankError }] = await Promise.all([
      supabase.rpc("set_default_contribution_amount", {
        p_amount: contributionAmount.trim() ? Number(contributionAmount) : null
      }),
      supabase.rpc("set_default_contribution_bank", { p_bank_id: contributionBankId || null })
    ])

    setSavingContribution(false)
    if (!error && !bankError) {
      updateCache({ contributionAmount, contributionBankId })
      setToast("Default contribution saved")
    }
    setContributionMessage(error?.message || bankError?.message || "")
  }

  async function saveLoanPayment() {
    if (savingLoanPayment) return
    setSavingLoanPayment(true)
    setLoanPaymentMessage("")

    const [{ error }, { error: bankError }] = await Promise.all([
      supabase.rpc("set_default_loan_payment_amount", {
        p_amount: loanPaymentAmount.trim() ? Number(loanPaymentAmount) : null
      }),
      supabase.rpc("set_default_loan_payment_bank", { p_bank_id: loanPaymentBankId || null })
    ])

    setSavingLoanPayment(false)
    if (!error && !bankError) {
      updateCache({ loanPaymentAmount, loanPaymentBankId })
      setToast("Default loan payment saved")
    }
    setLoanPaymentMessage(error?.message || bankError?.message || "")
  }

  const Header = isBorrower ? BorrowerHeader : Navbar

  if (authLoading || !member || member.status !== "approved" || dataLoading) {
    return (
      <>
        <Header />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(6rem+var(--dock-h)+env(safe-area-inset-bottom))]">
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
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(6rem+var(--dock-h)+env(safe-area-inset-bottom))]">

          <button
            onClick={() => router.push(isBorrower ? "/borrower" : "/menu")}
            className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors"
          >
            {isBorrower ? "← Your Loan" : "← Menu"}
          </button>

          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Account
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-1">
            Preferences
          </h1>
          <p className="text-[13px] text-ink-soft mb-6">
            {isBorrower
              ? "Set a default amount and bank for the repayments you make often. Leave a field blank to clear it."
              : "Set default amounts and banks for transactions you make often. Leave a field blank to clear it."}
          </p>

          <div className="space-y-4">
            {!isBorrower && (
              <AmountField
                label="Default Contribution Amount"
                helper="Pre-fills the amount and bank when you start a Contribution in New Transaction."
                value={contributionAmount}
                onChange={setContributionAmount}
                bankId={contributionBankId}
                onBankChange={setContributionBankId}
                banks={banks}
                onSave={saveContribution}
                saving={savingContribution}
                message={contributionMessage}
              />
            )}

            <AmountField
              label="Default Loan Payment Amount"
              helper={
                isBorrower
                  ? "Pre-fills the amount and bank when you make a repayment."
                  : "Pre-fills the amount and bank when you start a Loan Payment in New Transaction."
              }
              value={loanPaymentAmount}
              onChange={setLoanPaymentAmount}
              bankId={loanPaymentBankId}
              onBankChange={setLoanPaymentBankId}
              banks={banks}
              onSave={saveLoanPayment}
              saving={savingLoanPayment}
              message={loanPaymentMessage}
            />
          </div>

        </div>
      </main>

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </>
  )
}
