# Atlas — Project Notes for Claude

Atlas is a writing-companion desktop app (Electron + React + TypeScript, built via
`electron-vite`). Prototype work is organized into phases; this file tracks standing
constraints and what's been done so future sessions don't need to re-audit from scratch.

## Standing constraints

- **The desktop app is the product now.** All fixes/features target `app/src` only.
  The root-level `.dc.html` mockup files (`Atlas.dc.html` and siblings) are permanently
  out of scope — do not edit them, even if an audit finds issues there. The project has
  moved past the static-HTML phase.
- Git identity for this repo is set **locally only** (`git config user.email` /
  `user.name`, not `--global`) — do not change this to global.
- `.gitignore` covers `node_modules/`, `out/`, `dist/`, `*.tsbuildinfo`, `.thumbnail`,
  `.claude/`.

## Tooling quirks (Windows)

- `node`/`npm`/`npx` are not on PATH by default in either Bash-tool git-bash or a fresh
  PowerShell session. Node lives at `C:\Program Files\nodejs`. Prepend it when needed:
  `export PATH="/c/Program Files/nodejs:$PATH"` (Bash) or add to `$env:Path` (PowerShell).
- Verify with: `npx tsc --noEmit -p tsconfig.web.json`, `npx tsc --noEmit -p tsconfig.node.json`,
  `npx vitest run` (all from `app/`).
- Run the app with `npm run dev` from `app/`.

## Parallel-subagent orchestration pattern (used for punch-list fixes)

When the user asks for multiple independent fixes done in parallel via subagents:

1. Read the actual current file contents for every planned fix **before** dispatching,
   and trace which files each fix needs to touch.
2. Assign one subagent per fix using `Agent` with `isolation: "worktree"` (filesystem
   isolation via git worktree + branch). Merge two fixes into one agent if they'd
   collide on the same file; sequence one fix after another merges if one depends on
   the other's final state (e.g. validation schemas depend on the final IPC channel set).
3. Git worktrees don't inherit gitignored files, so each agent's worktree is missing
   `app/node_modules` (~400MB). Fix via a directory junction, **preferably from
   PowerShell** (the Bash-tool version sometimes silently no-ops on Windows):
   `cmd /c mklink /J node_modules "<main-repo-path>\app\node_modules"`
4. As orchestrator: merge branches **sequentially**, running full verification
   (`tsc` × 2 configs + `vitest run`) after **each individual merge**, not batched at
   the end — catches integration issues immediately. Clean up worktrees/branches once
   merged.
5. If a subagent turns out to be editing out-of-scope files (e.g. the retired `.dc.html`
   mockup), stop it immediately with `TaskStop` and revert any already-merged change
   with `git revert --no-edit -m 1 <merge-commit>` rather than leaving it in place.

This pattern ran across three rounds (14 total agent branches) with zero merge conflicts,
due to the upfront file-scoping step.

**Wave variant (used for Phase 3, a much larger build):** when the work is too big for
one round of fully-independent agents, split into sequential *waves*. Wave 1 = several
agents in parallel on genuinely independent file surfaces (still expect append-only
conflicts in shared plumbing files like `shared/ipc.ts`/`main/ipc/handlers.ts`/
`preload/index.ts` when two agents both add new IPC channels — resolve by hand, it's
always just "keep both sides"). Merge and verify all of Wave 1 first. Wave 2 = agent(s)
that depend on Wave 1's *real* APIs (not guessed ones) run afterward, against the
already-merged codebase, so their briefs can cite exact current function signatures
instead of assumed ones. **Always finish with a real `npm run dev` smoke test, not just
green `tsc`/`vitest`** — Phase 3's Wave 2D agent unknowingly built on top of a Wave 1A
regression (a circular import between `CodexView.tsx` and `CodexEntryForm.tsx` — one
imported a constant back from the other, causing "Cannot access 'X' before
initialization" on every launch) that 97 passing unit tests never caught, because it was
a module-evaluation-order bug, not a logic bug. Only booting the real app surfaced it.

## Fix rounds completed so far

**Round 1 — "Fix before next review"**
- Landing's Cottonmouth sample project now navigates to `/manuscript` on open (was
  defaulting to Dashboard) — spec §2 requires the default view to show the Manuscript
  workspace with Story Editor report + tracked changes.
- Chapter/scene nav click handlers — audited and found already fully wired in the real
  app; no fix needed (the gap was only in the retired `.dc.html` mockup).
- `AgentRunsView` replaced with a real list+detail view backed by new IPC
  (`agentRuns.list()` / `.get()`) instead of a `ComingSoon` stub.
- Session-scoped permission approvals now persist: `SessionApproval` records are
  created on "Approve for session" (matched on capabilityId+actionType+dataScope+
  destination per spec §13), checked before re-prompting, and manageable (list/revoke)
  from Settings.

**Round 2 — "Worth scheduling"**
- All 5 agent roles (Generator, Dev-Editor, Line-Editor, Dialoguer, World-Builder) are
  simulated in `main/agent/simulator.ts` and wired in the `AgentRail` (was only 1 of 5).
- New suggestion-card types added for insertions, dialogue alternatives, and codex
  additions, each with agent icon/tint attribution header (role→icon map: Generator=nib,
  Dev-Editor=compass, Line-Editor=loupe, Dialoguer=quote, World-Builder=globe).
- Focus mode now queues incoming suggestions silently and flushes them (with a summary
  message) when focus mode is turned off, instead of interrupting.
- Generic schema-migration module (`main/persistence/migrations.ts`) added; all
  persistence stores route `JSON.parse` results through `migrateRecord()`. Registry is
  currently empty (no v2 schema exists yet) but the seam is in place.
- Capability dependency chains: sample capabilities now declare `dependsOn`, and
  Library's capability detail view resolves + displays them.

**Round 3 — "Lower priority" + 3 user-requested additions**
- Accessibility: global `:focus-visible` ring added in `tokens.css`; removed a stray
  `outline: none` in the command palette that blocked it.
- Hardcoded hex colors in `AppShell`'s top nav replaced with existing theme tokens
  (`--c-amber`, `--c-amber-soft`, etc.) so they adapt between Paper/Night themes.
- MCP adapter scaffolding fleshed out (`shared/mcp.ts`: example `StdioMcpAdapter` +
  2 example server configs, explicitly labeled illustrative/not connected) and surfaced
  read-only in Settings → Advanced Mode. Still a behavioral no-op — Phase 2 stays
  non-functional here by design.
- Runtime payload validation added via zod (`shared/validation.ts`): `CodexEntry`,
  scene-write patches, `AgentGoal`, and project-creation payloads are validated at the
  IPC boundary in `main/ipc/handlers.ts` before touching disk.
- **Project delete**: Landing now lists all on-disk projects (`project.list()` IPC,
  scans `Documents/Atlas Projects/*`) with Open/Delete per card; delete
  (`project.delete()`) recursively removes the project folder after a
  `window.confirm()`.
- **Writers-desk image crop fix**: container's `aspectRatio` set to match the source
  image's actual pixel dimensions (1402/1122) with `backgroundSize: contain`, so the
  full image shows uncropped instead of being cover-cropped.
- **App identity**: window/taskbar icon now uses the user-supplied Atlas logo
  (`app/resources/icon.png`, converted from `Atlas_003.jpg`); `app.setName('Atlas')` +
  `setAppUserModelId('com.atlas.desktop')` set in `main/index.ts`; `electron-builder`
  `build` config added to `app/package.json` (`productName: "Atlas"`) for future
  packaging. Known limitation: in unpackaged dev mode, Windows may still surface
  "Electron.exe" in some low-level OS chrome (e.g. taskbar tooltip) — full rename
  requires a packaged build, which has not been run.

**Round 4 — Phase 3 ("Codex, Retrieval, and Agent Runtime Prototype")**

A prioritized core of spec §15 Phase 3, built across two orchestrated waves (see the
"Wave variant" note above). Confirmed scope decisions going in: model calls stay
simulated behind a swappable adapter interface (no real OpenRouter wiring/API key vault
this round), embeddings are lightweight local deterministic vectors (no ML dependency),
and several lower-priority Phase 3 items were explicitly deferred (see below).

*Wave 1A — Codex depth:*
- `codexStore.ts`'s `upsertCodexEntry()` now appends a real `CodexVersion` to
  `entry.history` server-side on every update (previously written once and never
  touched again) — visible as a collapsible "History" disclosure per entry in
  `CodexView.tsx`.
- `detectContradictions()`, `getManuscriptReadingOrder()`, `filterBySpoilerReveal()`
  added to `shared/codexLogic.ts` (dependency-free so the renderer can import them
  directly) — contradiction badges now render on conflicting entries; spoiler-aware
  filtering by manuscript reading order is available to callers (not yet exposed as a
  Codex-view toggle).
- `CodexView.tsx` gained full CRUD: a new `components/CodexEntryForm.tsx` modal handles
  create/edit with a relationships editor, manuscript-links picker, and spoiler
  reveal-scene picker; delete has a confirm dialog. Previously read+accept/reject only.

*Wave 1B — Retrieval & context:*
- `main/retrieval/vectorize.ts`: deterministic hashing-trick bag-of-words vectors +
  cosine similarity (explicitly documented as a placeholder for a real embedding model,
  matching the house style of `agent/simulator.ts`'s labeled simulation).
- New `vectors` table in `persistence/db.ts` (sql.js); `main/retrieval/search.ts` indexes
  Codex entries and scene prose lazily on first `retrieval:search` call per project
  session.
- `main/persistence/summaryStore.ts`: rolling chapter/scene summaries (extractive
  heuristic, same "honest placeholder" pattern), written into the previously-unused
  `summaries/` folder.
- `main/retrieval/contextWarnings.ts` + `ContextInspectionPanel.tsx`: the panel's two
  previously-hardcoded "not retrieved in this simulated run" rows and static warning box
  now reflect real retrieval/summary/warning data.

*Wave 1C — Session/momentum & snapshots:*
- `main/persistence/sessionStore.ts`: daily word-count activity log (`sessions/` folder,
  new), streak calculation, optional `ProjectManifest.sessionGoal`. Dashboard's "Today's
  session" card (previously a hardcoded "Not tracked yet" string) now shows real
  data plus a collapsible 30-day heat map.
- `main/persistence/revisionStore.ts`: scene snapshots into the previously-unused
  `revisions/` folder, captured automatically right before a tracked-change suggestion
  is accepted, plus a hand-rolled word-level LCS diff (no new dependency) surfaced via
  new `components/SnapshotDiffView.tsx` (functional but not yet linked from navigation).

*Wave 2D — Functional agent loop, capability registry, sandbox, permissions:*
- `main/agent/providers/`: a `ProviderAdapter` interface with a real `simulatorAdapter`
  (the five agent roles' inline model-call construction now goes through one shared
  adapter call) and `openRouterAdapter`/`lmStudioAdapter` stubs that throw a clear
  "not configured in this build" error — the seam data-contracts.md §6 described,
  without a real provider integration.
- `simulator.ts` now enforces `AgentGoal.constraints` for real (turns, tool calls,
  tokens, elapsed time, cost) with a distinct "budget exceeded" terminal path, plus
  duplicate-action detection (spec Risk 4) — previously these limits were only echoed
  into a summary string and never checked.
- `main/capabilities/registry.ts`: global capabilities now really live outside the
  project (`app.getPath('userData')/atlas/capabilities/`) vs. project-scoped
  (`<project>/capabilities/`) — previously both scopes lived in the same project folder
  with `scope` as a display-only label. New `capabilities:create/update/setLifecycleState`
  IPC; `Library.tsx` gained create/edit/enable/disable/deprecate controls (Advanced
  Mode only) — previously 100% read-only.
- `main/capabilities/sandbox.ts`: real `node:vm`-based tool execution (bounded
  wall-clock timeout, no ambient `require`/`fs`/network) with three real seed tools
  (`word-count`, `codex-contradiction-check`, `codex-search`) auto-installed into the
  global scope on app startup. Dev-Editor's simulated run now invokes
  `codex-contradiction-check` for real and folds one real data point into its result —
  the first agent role to do anything beyond canned template text.
- `main/permissions/sessionApprovals.ts`: `SessionApproval` is now also tracked
  main-process-side (per `ProjectSession`), checked before re-prompting, and
  IPC-backed (`permissions:list/revoke`) — previously it existed only in renderer
  zustand state with no main-process awareness (Round 1's "session approvals persist"
  was renderer-only; this closes that gap).
- Found and fixed a real bug while wiring this: `AgentRail.tsx` hardcoded
  `provider: 'openrouter'` on every constructed `AgentGoal`, which would have broken
  every agent run once the OpenRouter adapter started throwing per its new intended
  behavior. Changed to `'anthropic'` to preserve "model calls stay simulated."

*Post-merge fix:* a real `npm run dev` smoke test (not just `tsc`/`vitest`) caught a
circular-import crash between `CodexView.tsx` and `CodexEntryForm.tsx` from Wave 1A
(`CodexEntryForm` imported a constant back from `CodexView`) that threw "Cannot access
'TYPE_LABEL' before initialization" on every launch. Fixed by extracting the constant to
`renderer/src/lib/codexLabels.ts`. See the "Wave variant" note above.

*Post-Phase-3 fixes (user testing):* `state/store.ts`'s `setSuggestionState()` only ever
applied manuscript changes for `tracked-change` (Line Editor) suggestions — accepting a
Generator `insertion` suggestion flipped its UI state to accepted but never touched the
scene's prose, silently discarding Generator's output. This predates Phase 3 (Generator
was wired in Round 2) but was only caught by live testing. Now `insertion` suggestions
append their text to the scene on accept, same snapshot-before-write pattern as
tracked-change. Also fixed: `openSampleProject()`/`openProjectAtPath()`/
`createProjectFromFoundations()` never cleared `activeSuggestions`/`queuedSuggestions`/
`lastAgentSummary` on open, so reopening the sample project after exiting to Landing
re-appended the same seeded suggestions (same ids) a second time — a real "duplicate
key" React warning, not a rendering-only issue. All three now reset that state on open.

**Explicitly deferred from Phase 3** (confirmed scope decision, not an oversight):
capability recommendation drafts from agent-detected repeated processes; the full
production capability review/compare/rollback workflow beyond basic
enable/disable/deprecate; capability test/validation-status automation and
usage-metrics/efficiency-reporting UI; real external MCP server connectivity (the
`shared/mcp.ts` scaffolding from Round 3 is unchanged); real OpenRouter/LM Studio
provider integration and the API-key vault spec §13 requires; a Codex-view UI toggle for
"view as of scene X" using the new spoiler-filtering logic (the logic exists, the toggle
doesn't); `SnapshotDiffView` isn't yet linked from the manuscript workspace's navigation.

## Current verified state (as of Round 4 / Phase 3 completion)

- `npx tsc --noEmit` clean on both `tsconfig.web.json` and `tsconfig.node.json`.
- `npx vitest run` — 97/97 tests passing across 16 files (was 28/5 at Round 3).
- App launches cleanly via `npm run dev` (main + preload build, renderer connects) with
  only expected dev-mode warnings (React DevTools suggestion, React Router v7 future
  flags, Electron CSP insecure-policy warning) — none of these are regressions.
- Full interactive click-through of the new UI (Codex CRUD, Library capability
  management, Dashboard session card, an agent run hitting the new sandboxed-tool +
  permission-enforcement path) was **not** performed this round — no headless
  Electron/Playwright driver exists in this environment yet (see the `run` skill's
  Electron pattern if one is needed later). Verification here relied on the automated
  test suite plus a real `npm run dev` log/console check, which is how the circular-import
  bug above was actually caught.
