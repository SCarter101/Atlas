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

  test.afterEach(async () => {
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
