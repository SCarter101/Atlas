import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'

// Points at electron-vite's build output, not the packaged installer (Track
// A owns packaging) — `npm run build` must have already produced this file.
// app/package.json has "type": "module", so this file loads as ESM (no
// CommonJS __dirname) — derive the equivalent from import.meta.url instead.
// This module lives at app/e2e/support, so out/ is three levels up.
const here = fileURLToPath(new URL('.', import.meta.url))
const MAIN_ENTRY = resolve(here, '..', '..', 'out', 'main', 'index.js')

export interface AtlasApp {
  app: ElectronApplication
  window: Page
}

// Launches the real built app exactly the way a user's installed copy would
// start (no ELECTRON_RENDERER_URL, so main/index.ts's dev-server branch is
// never taken — see the comment on that branch in src/main/index.ts — it
// always falls through to loadFile(out/renderer/index.html), the same file
// a packaged build loads).
//
// KNOWN LIMITATION (documented rather than worked around — see this
// project's established "document accepted-risk findings" convention):
// opening the sample/new project writes real files under the OS user's
// Documents folder (`main/persistence/projectStore.ts`'s
// `sampleProjectRoot()` calls `app.getPath('documents')` directly, with no
// test-controllable override anywhere in the app). This suite was scoped to
// NOT touch main/index.ts (owned by sibling Phase-9 tracks), so there is no
// clean way to redirect that path without a source change outside this
// track's remit. In practice this means running this suite creates/reuses
// `<Documents>/Atlas Projects/Cottonmouth Sample.atlas` — the exact same
// folder a real user gets from clicking "Cottonmouth" on Landing once, no
// different from ordinary manual use of the app, and reseeding is
// idempotent (see seedSampleProject.ts's existsSync guard) so rerunning the
// suite does not accumulate anything. It is deliberately NOT deleted by this
// suite: guessing the OS's real Documents path from Node (outside Electron)
// and rm -rf'ing it is a worse risk than leaving one harmless, idempotent,
// app-owned folder in place.
export async function launchAtlas(): Promise<AtlasApp> {
  const app = await electron.launch({ args: [MAIN_ENTRY] })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  return { app, window }
}

// A fresh Electron profile has no localStorage, so AppShell's product tour
// (Phase 9 Track G) auto-opens the first time AppShell mounts — i.e. once
// navigation lands inside a project (Landing itself is outside AppShell, so
// the tour isn't present there yet). Its full-screen overlay then intercepts
// pointer events on everything underneath it, including the manuscript
// editor. Call this right after the first in-app navigation completes, before
// interacting with anything AppShell renders. "Skip" also calls the same
// finish() as Escape (marks it seen in localStorage) — using the visible
// button rather than a bare keypress makes the dismissal assertable and
// fails loudly (via toBeVisible's timeout) if the tour's markup ever changes,
// instead of silently clicking through to nothing.
export async function dismissTourIfShown(window: Page): Promise<void> {
  const skipButton = window.getByRole('button', { name: 'Skip' })
  if (await skipButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await skipButton.click()
  }
}
