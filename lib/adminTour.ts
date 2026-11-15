// The admin tour opens by itself the first time someone opens /admin on
// this device, the same per-device approach as the lending limits "New"
// badge (see lib/lendingLimits.ts). Help → Admin can replay it any time
// via /admin?tour=1. Browser storage can be missing or blocked; then the
// tour simply offers itself again next visit.
const ADMIN_TOUR_SEEN_KEY = "admin:tour-seen"

export const ADMIN_TOUR_REPLAY_PATH = "/admin?tour=1"

export function hasSeenAdminTour(): boolean {
  try {
    return localStorage.getItem(ADMIN_TOUR_SEEN_KEY) === "1"
  } catch {
    return false
  }
}

export function markAdminTourSeen() {
  try {
    localStorage.setItem(ADMIN_TOUR_SEEN_KEY, "1")
  } catch {
    // Nothing to do -- the tour just offers itself again next time.
  }
}
