import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchAtlas } from './support/launchApp'

// Covers the "New Project" -> Story Foundations wizard -> app shell path
// end-to-end, kept separate from golden-path.spec.ts because
// createProjectFromFoundations.ts deliberately creates a project with "no
// manuscript structure yet — that's created by the writer once they start
// drafting" (see that file's own comment), so a project built this way has
// no scene for the draft/agent/accept steps to run against. This spec only
// verifies the wizard itself reaches a real, working project — the fast
// path through all six questions, skipping every answer, exercising
// `Skip for now` on each step plus the title/path/done screens' own
// buttons.

test.describe('Atlas Story Foundations wizard', () => {
  let app: ElectronApplication
  let window: Page
  let createdProjectTitle: string | undefined

  test.afterEach(async () => {
    // This spec creates a brand-new, uniquely-timestamped project on every
    // run via the real createProjectFromFoundations() IPC path (the whole
    // point of the test), and — unlike the golden-path spec, which reuses
    // the idempotent, already-seeded sample project — nothing ever cleaned
    // that project up. Every local/CI run of this suite was silently
    // accumulating another orphaned "E2E Smoke Test <timestamp>.atlas"
    // folder in the real writer's Documents/Atlas Projects folder forever.
    // Delete it here via the app's own real project.list/delete bridge
    // (not a guessed filesystem path from this Node test process — Documents
    // can be OS-redirected, e.g. onto OneDrive, so `os.homedir() + '/Documents'`
    // would not reliably match app.getPath('documents')'s real resolution).
    if (window && createdProjectTitle) {
      await window
        .evaluate(async (title) => {
          const projects = await window.atlas.project.list()
          const match = projects.find((p) => p.manifest.title === title)
          if (match) await window.atlas.project.delete(match.projectRoot)
        }, createdProjectTitle)
        .catch(() => {
          // Best-effort — a window that's already gone (e.g. the test itself
          // crashed before creating the project) shouldn't fail the cleanup step.
        })
    }
    await app?.close()
  })

  test('creates a new project via the fast path and lands in the app shell', async () => {
    ;({ app, window } = await launchAtlas())

    // Not an exact/anchored match: Landing.tsx's "New Project" button wraps
    // a "+" icon div, title div, and subtitle div ("Start with a guided
    // Story Foundations setup") all in the same <button>, so the accessible
    // name is "+ New Project Start with a guided Story Foundations setup"
    // (confirmed via this suite's own error-context snapshot from an
    // earlier run) — not just "New Project", and not even starting with it.
    const newProjectButton = window.getByRole('button', { name: /New Project/ })
    await expect(newProjectButton).toBeVisible({ timeout: 20_000 })
    await newProjectButton.click()

    // --- Title step ----------------------------------------------------------
    const titleInput = window.getByPlaceholder('Working title…')
    await expect(titleInput).toBeVisible({ timeout: 10_000 })
    const projectTitle = `E2E Smoke Test ${Date.now()}`
    createdProjectTitle = projectTitle
    await titleInput.fill(projectTitle)
    await window.getByRole('button', { name: 'Continue', exact: true }).click()

    // --- Path step -------------------------------------------------------------
    // Not exact for the same reason as "New Project" above — the pathCard
    // button wraps a title div plus a description div together.
    await window.getByRole('button', { name: /^Fast path/ }).click()

    // --- Question step: skip all six questions ---------------------------------
    const skipButton = window.getByRole('button', { name: 'Skip for now', exact: true })
    for (let i = 0; i < 6; i += 1) {
      await expect(skipButton).toBeVisible({ timeout: 10_000 })
      await skipButton.click()
    }

    // --- Done step ---------------------------------------------------------------
    const finishButton = window.getByRole('button', { name: /Go to Dashboard/ })
    await expect(finishButton).toBeVisible({ timeout: 10_000 })
    await finishButton.click()

    // createProjectFromFoundations() (state/store.ts) flips stage to 'app' on
    // success without an explicit navigate() call — the HashRouter's location
    // is still whatever it was on mount, so App.tsx's "/" -> "/dashboard"
    // redirect route is what actually lands us here.
    await window.waitForURL(/#\/dashboard/, { timeout: 20_000 })
    await expect(window.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible({ timeout: 10_000 })
  })
})
