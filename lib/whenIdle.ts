// Runs `fn` once the browser is idle (or after a short delay where
// requestIdleCallback isn't available, e.g. Safari), so background work like
// preloading a lazily-loaded sheet's code never competes with the page's own
// first render. Returns a cleanup that cancels it, for use in an effect.
export function whenIdle(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  if ("requestIdleCallback" in window) {
    const id = window.requestIdleCallback(fn, { timeout: 3000 })
    return () => window.cancelIdleCallback(id)
  }
  const id = setTimeout(fn, 1500)
  return () => clearTimeout(id)
}
