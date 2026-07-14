import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchAtlas } from './support/launchApp'

// End-to-end smoke test for Atlas's core writer loop, driven against a real
// launched Electron instance (electron-vite's `out/` build) rather than
// mocks. Deliberately opens the built-in "Cottonmouth" sample project rather
// than going through the Story Foundations wizard: a freshly-foundationed
// project has zero manuscript structure (createProjectFromFoundations.ts:
// "no manuscript structure yet — that's created by the writer once they
// start drafting"), so ManuscriptWorkspace would render its empty-state
// screen instead of an editor, and the golden path couldn't reach the
// draft/agent/accept/export steps at all without first building out a
// chapter/scene-creation flow this suite doesn't otherwise need. The sample
// project ships with real chapters/scenes/Codex already in place, matching
// the task's own "whichever is more reliable/faster to script" allowance.
// story-foundations.spec.ts separately covers the Story Foundations wizard
// itself end-to-end.
//
// Every agent role defaults to the `simulator` ModelProvider
// (state/store.ts's DEFAULT_AGENT_MODELS) and openSampleProject() never
// overrides that, so this run never touches a real OpenRouter/LM Studio
// credential and is fully deterministic offline.

test.describe('Atlas golden path', () => {
  let app: ElectronApplication
  let window: Page

  test.afterEach(async () => {
    await app?.close()
  })

  test('draft, run Line Editor, accept a suggestion, export to Markdown', async () => {
    ;({ app, window } = await launchAtlas())

    // --- Landing: open the sample project ---------------------------------
    const sampleProjectButton = window.getByRole('button', { name: /Cottonmouth/ })
    await expect(sampleProjectButton).toBeVisible({ timeout: 20_000 })
    await sampleProjectButton.click()

    // Landing's onClick handler explicitly navigates to /manuscript once
    // openSampleProject() resolves (spec §2 default-view requirement) —
    // HashRouter, so the URL fragment is the reliable signal.
    await window.waitForURL(/#\/manuscript/, { timeout: 20_000 })

    const editor = window.locator('.manuscript-page .ProseMirror')
    await expect(editor).toBeVisible({ timeout: 20_000 })

    // --- Draft: append a new paragraph to the active scene -----------------
    const draftSentence =
      'Ray noticed that his hands were shaking very badly in the cold rain, and he hated that Tull could see it.'
    await editor.click()
    await window.keyboard.press('Control+End')
    await window.keyboard.press('Enter')
    await window.keyboard.type(draftSentence)

    // ManuscriptWorkspace debounces the write 800ms after the last edit
    // (SAVE_DEBOUNCE_MS) then flips the save indicator once scenes.write
    // resolves — wait for the real autosave round-trip, not a fixed sleep.
    // AppShell's bottom-bar status pill *also* renders literal "All changes
    // saved" text (with no timestamp) once sceneSaveState flips to 'saved',
    // alongside ManuscriptWorkspace's own save-state line — matching on the
    // " · " timestamp separator disambiguates to the latter specifically
    // (a strict-mode violation otherwise, confirmed by an earlier run of
    // this suite: getByText(/All changes saved/) resolved to both).
    await expect(window.getByText(/All changes saved · /)).toBeVisible({ timeout: 10_000 })

    // --- Select the new paragraph (agent scope) -----------------------------
    // Select only the just-typed paragraph, not the whole multi-paragraph
    // scene: AgentRail's getSelection() reads ManuscriptEditor's
    // getSelectionText(), which joins block boundaries with a single '\n'
    // (editor.state.doc.textBetween(from, to, '\n')), while the prose
    // actually persisted to disk on autosave joins paragraphs with '\n\n'
    // (onUpdate's editor.getText({ blockSeparator: '\n\n' })). Selecting
    // across multiple paragraphs would make payload.before (single-\n-joined)
    // fail to literally substring-match the on-disk prose (double-\n-joined)
    // at accept time, tripping the zero-occurrence "stale suggestion" guard
    // in store.ts's setSuggestionState. A single-paragraph selection never
    // crosses a block boundary, so this mismatch can't occur, and the
    // sentence's wording is unique in the scene so occurrence-count is
    // exactly 1 (also required by that same guard).
    const newParagraph = window.locator('.manuscript-page .ProseMirror p', { hasText: 'shaking very badly' })
    await expect(newParagraph).toBeVisible()
    await newParagraph.click({ clickCount: 3 })

    // --- Expand Line Editor and invoke on the selected scope ----------------
    // Expanding the panel AFTER selecting (not before) is deliberate: AgentRail
    // computes `selectionAvailable` fresh on every render by calling
    // getSelection() again, but nothing re-renders AgentRail just from a mouse
    // selection change inside the editor (Tiptap's useEditor here only wires
    // onUpdate, not onSelectionUpdate). Clicking the "Line Editor" row toggles
    // local expandedRole state, which forces the re-render that picks up the
    // selection that was already made.
    // Not an exact match: the row button's accessible name concatenates the
    // agent name with its provider subtitle (AgentRail.tsx renders
    // describeProvider(agentModels[agent.role]) as a sibling text node
    // inside the same <button>) — e.g. "Line Editor simulator", not just
    // "Line Editor".
    await window.getByRole('button', { name: /^Line Editor/ }).click()
    const invokeButton = window.getByRole('button', { name: 'Invoke on scene' })
    await expect(invokeButton).toBeEnabled({ timeout: 5_000 })
    await invokeButton.click()

    // Preflight cost/confirm dialog (spec §8) — always shown before a run
    // starts, real or simulated.
    await window.getByRole('button', { name: 'Confirm', exact: true }).click()

    // The simulator's line-edit-scan tool always requests permission before
    // running (simulator.ts's requestPermission — a session approval only
    // short-circuits this on a *second* request for the exact same
    // capability/scope/destination, and this is the first request of the
    // run), so a real PermissionDialog round-trip is unavoidable here.
    await window.getByRole('button', { name: 'Approve once' }).click()

    // --- Wait for the run to complete for real -------------------------------
    // simulateLineEditFindings() (main/agent/simulator.ts) guarantees at
    // least one finding whenever the selection is non-empty (its final
    // fallback branch fires when neither of its two regex checks match), so
    // completion itself is deterministic. The wait is generous (not 20s)
    // because runLineEditor() calls assembleContext(), which calls
    // search.ts's real search() -> retrieval/embeddings/select.ts's
    // selectEmbeddingAdapter(): with no writer preference set (this run's
    // default state), it unconditionally probes LM Studio's local HTTP
    // server first via a plain `fetch` with no AbortController timeout
    // (lmStudioEmbeddingAdapter.ts's isAvailable()) before falling back to
    // the always-available hashing adapter. No LM Studio server runs in this
    // environment, and on Windows a connection attempt to a port nothing is
    // listening on can take much longer to fail than a same-host refused
    // connection "should" (observed ~20s+ in this sandbox rather than an
    // instant ECONNREFUSED) — this is a real, pre-existing characteristic of
    // the embeddings fallback chain, not a flaw in this test's flow. Worth a
    // follow-up (a short explicit timeout on that probe) outside this
    // track's E2E-only scope; flagged separately rather than patched here.
    await expect(window.getByText(/Line Editor found \d+ suggestion/)).toBeVisible({ timeout: 45_000 })

    // --- Accept the suggestion the run just produced -------------------------
    // New suggestions are appended to the end of activeSuggestions
    // (store.ts's handleAgentStep result branch) and every suggestion-kind
    // section in ManuscriptWorkspace renders in that same array order, with
    // the Tracked Changes (Line-Editor) section rendering after Editorial
    // Findings and before any Insertions/Dialogue/Codex/Metadata sections —
    // none of which exist in this run (only Line-Editor was invoked) — so the
    // very last "Accept" button on the page is unambiguously the suggestion
    // this run just created, regardless of whether the sample project's
    // seeded demo suggestions happen to be on the same scene.
    const acceptButtons = window.getByRole('button', { name: 'Accept', exact: true })
    const countBeforeAccept = await acceptButtons.count()
    expect(countBeforeAccept).toBeGreaterThan(0)
    await acceptButtons.last().click()

    // A successful accept removes that suggestion's Accept/Reject/Refine row
    // (SuggestionCard only renders it while `!isResolved`) — if the accept
    // had instead hit the zero-occurrence or repeated-occurrence guard in
    // setSuggestionState, the card would stay pending and this count would
    // NOT drop, so this assertion is a real correctness check, not a
    // tautology.
    await expect(acceptButtons).toHaveCount(countBeforeAccept - 1, { timeout: 10_000 })

    // The accept path snapshots then rewrites the scene via scenes.write, so
    // the same real autosave signal confirms the manuscript was actually
    // touched, not just the suggestion's UI state.
    // AppShell's bottom-bar status pill *also* renders literal "All changes
    // saved" text (with no timestamp) once sceneSaveState flips to 'saved',
    // alongside ManuscriptWorkspace's own save-state line — matching on the
    // " · " timestamp separator disambiguates to the latter specifically
    // (a strict-mode violation otherwise, confirmed by an earlier run of
    // this suite: getByText(/All changes saved/) resolved to both).
    await expect(window.getByText(/All changes saved · /)).toBeVisible({ timeout: 10_000 })

    // --- Export the manuscript to Markdown -----------------------------------
    // ExportManuscript's IPC handler (main/ipc/handlers.ts) calls
    // dialog.showSaveDialog before writing anything — Playwright can't drive
    // a native OS dialog, so stub it in the main process to accept its own
    // suggested defaultPath (the real exports/<slug>-manuscript.md path a
    // human clicking "Save" without changing anything would also produce).
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = (async (opts: { defaultPath?: string }) => ({
        canceled: false,
        filePath: opts?.defaultPath
      })) as typeof dialog.showSaveDialog
    })

    await window.getByRole('link', { name: 'Export', exact: true }).click()
    await window.waitForURL(/#\/export/, { timeout: 10_000 })

    // Both the Manuscript and Codex sections have a format labeled
    // "Markdown" (manuscript's `md` and codex's `codex-md`) — the Manuscript
    // FormatSection renders first in the DOM, so the first match is
    // unambiguous. Not exact: each format button wraps its label plus a hint
    // div (e.g. ".md, scene files") in the same <button>.
    const markdownButton = window.getByRole('button', { name: /^Markdown/ }).first()
    await markdownButton.click()

    await expect(window.getByText(/^Exported to /)).toBeVisible({ timeout: 20_000 })
  })
})
