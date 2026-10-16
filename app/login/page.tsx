"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/app/auth-context"

// Arriving from a confirmation link that didn't work (see app/page.tsx):
// explain it and offer a fresh link. Safe to read during the first render --
// the page stays blank until auth finishes loading, so this never shows up
// in server-rendered markup.
function linkErrorMessage() {
  if (typeof window === "undefined") return ""

  const params = new URLSearchParams(window.location.hash.slice(1))
  const errorCode = params.get("error_code")
  if (!errorCode) return ""

  return errorCode === "otp_expired"
    ? "That confirmation link has expired or was already used. Enter your email and tap below to get a new one."
    : `That confirmation link didn't work (${params.get("error_description") ?? errorCode}). Enter your email and tap below to get a new one.`
}

export default function LoginPage() {
  const router = useRouter()
  const { loading: authLoading, user, member } = useAuth()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [message, setMessage] = useState(linkErrorMessage)
  const [needsConfirmation, setNeedsConfirmation] = useState(() => linkErrorMessage() !== "")
  const [resent, setResent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    if (authLoading) return

    if (user && member) {
      router.replace("/dashboard")
    }
  }, [authLoading, user, member, router])

  // Strip a failed confirmation link's hash (read by linkErrorMessage
  // above) so a refresh doesn't show the error again.
  useEffect(() => {
    if (window.location.hash.includes("error_code=")) {
      window.history.replaceState(window.history.state, "", window.location.pathname)
    }
  }, [])

  // A signed-in auth user with no matching members row (signup's insert
  // failed partway, or the row was removed) would otherwise bounce forever
  // between here and /dashboard, which each redirect to the other.
  const orphanedAccount = !authLoading && !!user && !member
  const checkingSession = authLoading || (!!user && !orphanedAccount)

  async function login() {
    if (loading) return

    setLoading(true)
    setMessage("")
    setNeedsConfirmation(false)
    setResent(false)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    setLoading(false)

    if (error) {
      if (error.code === "email_not_confirmed") {
        setNeedsConfirmation(true)
        setMessage("Confirm your email address before signing in. Confirmation links expire, so if the one we sent you doesn't work, get a new one below.")
      } else {
        setMessage(error.message)
      }
    } else {
      router.replace("/dashboard")
    }
  }

  async function resendConfirmation() {
    if (loading) return

    if (!email) {
      setMessage("Enter your email above, then tap below to get a new confirmation link.")
      return
    }

    setLoading(true)

    const { error } = await supabase.auth.resend({ type: "signup", email })

    setLoading(false)

    if (error) {
      setMessage(error.message)
    } else {
      setResent(true)
    }
  }

  if (checkingSession) {
    return <main className="min-h-screen bg-paper" />
  }

  if (orphanedAccount) {
    return (
      <main className="min-h-screen bg-paper flex items-center justify-center px-5 py-8">
        <div className="w-full max-w-md animate-in fade-in duration-500 text-center">
          <h1 className="font-display text-4xl font-semibold text-ink">Est. 2017</h1>

          <div className="bg-paper-2 border border-hairline rounded-xl shadow-sm p-6 mt-8 text-left">
            <p className="text-sm text-ink">
              Your account setup didn&apos;t finish — we couldn&apos;t find a member record for this login.
            </p>
            <p className="text-sm text-ink-soft mt-2">
              Contact an admin to have your account linked, or sign out and try creating your account again.
            </p>
            <button
              onClick={() => supabase.auth.signOut()}
              className="mt-4 w-full rounded-md bg-gold-soft py-3 font-semibold text-ink shadow-sm transition-all hover:opacity-90 active:scale-[0.99]"
            >
              Sign Out
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-paper flex items-center justify-center px-5 py-8">
      <div className="w-full max-w-md animate-in fade-in duration-500">

        {/* Header */}
        <div className="text-center mb-8">

          <h1 className="font-display text-4xl font-semibold text-ink">
            Est. 2017
          </h1>

          <p className="text-sm text-ink-soft mt-2">
            Sign in to access your shared fund.
          </p>

        </div>


        {/* Login Card */}
        <div className="bg-paper-2 border border-hairline rounded-xl shadow-sm p-6">

          <div className="space-y-5">

            {/* Email */}

            <div>
              <label className="block text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-2">
                Email
              </label>

              <input
                type="email"
                placeholder="name@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") login()
                }}
                className="
                  w-full
                  rounded-md
                  border
                  border-hairline
                  bg-paper
                  px-4
                  py-3
                  text-base
                  text-ink
                  placeholder:text-ink-soft
                  outline-none
                  transition-all
                  focus:border-gold
                  focus:ring-2
                  focus:ring-gold/20
                "
              />

            </div>


            {/* Password */}

            <div>

              <div className="flex items-baseline justify-between mb-2">
                <label className="block text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono">
                  Password
                </label>

                <Link
                  href="/forgot-password"
                  className="text-[11px] text-gold hover:underline"
                >
                  Forgot password?
                </Link>
              </div>


              <div className="relative">

                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") login()
                  }}
                  className="
                    w-full
                    rounded-md
                    border
                    border-hairline
                    bg-paper
                    px-4
                    py-3
                    pr-16
                    text-base
                    text-ink
                    placeholder:text-ink-soft
                    outline-none
                    transition-all
                    focus:border-gold
                    focus:ring-2
                    focus:ring-gold/20
                  "
                />


                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="
                    absolute
                    right-3
                    top-1/2
                    -translate-y-1/2
                    text-xs
                    font-medium
                    text-gold
                    hover:text-ink
                    transition-colors
                  "
                >
                  {showPassword ? "Hide" : "Show"}
                </button>

              </div>

            </div>


            {/* Error */}

            {message && (
              <div className="
                rounded-md
                border
                border-rust/20
                bg-rust/10
                px-4
                py-3
              ">
                <p className="text-sm text-rust">
                  {message}
                </p>

                {needsConfirmation && (
                  resent ? (
                    <p className="text-sm text-ink-soft mt-2">
                      New confirmation link sent — check your inbox and tap the newest email.
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={resendConfirmation}
                      disabled={loading}
                      className="mt-2 text-sm font-medium text-gold hover:underline disabled:opacity-60"
                    >
                      Send a new confirmation link
                    </button>
                  )
                )}
              </div>
            )}


            {/* Login Button */}

            <button
              onClick={login}
              disabled={loading}
              className="
                w-full
                rounded-md
                bg-gold-soft
                py-3
                font-semibold
                text-ink
                shadow-sm
                transition-all
                hover:opacity-90
                active:scale-[0.99]
                disabled:cursor-not-allowed
                disabled:opacity-60
              "
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>


          </div>


          {/* Signup */}

          <div className="mt-6 border-t border-hairline pt-5 text-center">

            <p className="text-sm text-ink-soft">
              Don&apos;t have an account?
            </p>

            <Link
              href="/signup"
              className="
                mt-2
                inline-block
                font-medium
                text-gold
                hover:underline
              "
            >
              Create an account →
            </Link>

          </div>

        </div>


        <p className="mt-6 text-center text-xs text-ink-soft">
          Your contributions, investments, loans and fund performance in one place.
        </p>

        <p className="mt-2 text-center text-xs">
          <Link href="/install" className="text-gold hover:underline">
            Add this to your phone&apos;s home screen →
          </Link>
        </p>

      </div>
    </main>
  )
}