// Thin localStorage wrapper for onboarding UI state (product tour + shortcut
// cheat sheet). Deliberately renderer-only, no IPC and no main-process
// persistence — per the Round 10 Track G brief, this keeps onboarding
// polish off the shared-plumbing files (shared/ipc.ts, handlers.ts,
// preload/index.ts) that several sibling tracks touch in parallel this
// round. try/catch guards match this app's existing defensive style for
// browser-only APIs (see ReadAloudControl.tsx's speechSynthesis usage) in
// case localStorage is ever unavailable (e.g. a restrictive Electron
// storage policy) — onboarding UI degrading to "always show" is an
// acceptable fallback, never a hard crash.
const TOUR_SEEN_KEY = 'atlas.onboarding.tourSeen'
const CHEAT_SHEET_SEEN_KEY = 'atlas.onboarding.cheatSheetSeen'

export function hasSeenTour(): boolean {
  try {
    return localStorage.getItem(TOUR_SEEN_KEY) === 'true'
  } catch {
    return false
  }
}

export function markTourSeen(): void {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, 'true')
  } catch {
    // Ignore — worst case the tour offers to run again next launch.
  }
}

export function hasSeenCheatSheet(): boolean {
  try {
    return localStorage.getItem(CHEAT_SHEET_SEEN_KEY) === 'true'
  } catch {
    return false
  }
}

export function markCheatSheetSeen(): void {
  try {
    localStorage.setItem(CHEAT_SHEET_SEEN_KEY, 'true')
  } catch {
    // Ignore — worst case the Help menu's "new" indicator reappears.
  }
}
