"use client"

import { createContext, useContext, useEffect, useState } from "react"

// The user's stored choice: "system" means "no explicit choice yet -- follow
// the device". "light"/"dark" are explicit overrides.
type ThemePreference = "light" | "dark" | "system"
// What's actually painted, always one of the two.
type ResolvedTheme = "light" | "dark"

function systemPrefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

const ThemeContext = createContext<{
  theme: ResolvedTheme
  preference: ThemePreference
  setPreference: (preference: ThemePreference) => void
}>({
  theme: "dark",
  preference: "system",
  setPreference: () => {}
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>("system")
  const [theme, setTheme] = useState<ResolvedTheme>("dark")
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem("haru-theme")
    const initial: ThemePreference = stored === "light" || stored === "dark" ? stored : "system"
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage and matchMedia are only readable after hydration
    setPreferenceState(initial)
    setTheme(initial === "system" ? (systemPrefersDark() ? "dark" : "light") : initial)
    setMounted(true)
  }, [])

  // Only listens while the user hasn't overridden the theme -- once they
  // pick light or dark explicitly, it stays put even if the device theme
  // changes underneath it later (until they switch back to "System").
  useEffect(() => {
    if (!mounted || preference !== "system") return

    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => setTheme(media.matches ? "dark" : "light")
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [mounted, preference])

  useEffect(() => {
    if (!mounted) return
    document.documentElement.classList.toggle("dark", theme === "dark")

    const meta = document.querySelector('meta[name="theme-color"]')
    meta?.setAttribute("content", theme === "dark" ? "#0a0a0a" : "#ffffff")
  }, [theme, mounted])

  function setPreference(next: ThemePreference) {
    setPreferenceState(next)

    if (next === "system") {
      // No stored key at all is what marks "follow the device" -- letting a
      // fresh visitor (or someone who switches back to System) fall through
      // to systemPrefersDark() again instead of pinning today's resolved
      // value.
      localStorage.removeItem("haru-theme")
      setTheme(systemPrefersDark() ? "dark" : "light")
    } else {
      localStorage.setItem("haru-theme", next)
      setTheme(next)
    }
  }

  return (
    <ThemeContext.Provider value={{ theme, preference, setPreference }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
