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

**Codex is used ONLY for the independent review pass — never as a builder.** All
*building* is done by Claude subagents in isolated git worktrees (the wave pattern above).
Codex-as-builder was tried once (Round 6 / Phase 5) and abandoned: `codex-companion.mjs
task --write` operates on the **shared working tree**, not an isolated worktree, so Codex
build jobs can't run in parallel (they collide on shared plumbing files like
`shared/ipc.ts`/`handlers.ts`/`preload/index.ts`) and repeatedly got cut off mid-task by
their own session limits, leaving orphaned backend code for the orchestrator to finish by
hand. Claude worktree agents parallelize cleanly and finish their briefs, so they remain
the build path. Keep Codex strictly for the review step below.

**Codex review step (added Round 5, retained):** the Codex plugin is installed, exposing a
`codex:codex-rescue` agent type and a `codex-companion.mjs` runtime with `review` /
`adversarial-review` commands. After a wave is merged and green, hand the **whole feature
diff** (`git diff <base>..HEAD`) to Codex for an independent, correctness-only review, then
**verify every finding against the actual code yourself before acting** — Codex can be
wrong, and it's still the orchestrator's job to confirm and fix. Mechanics: launch a
background job and retrieve results directly with `node
"<plugin>/plugins/codex/scripts/codex-companion.mjs" status <jobId> --wait --timeout-ms
<ms>` then `… result <jobId>` (plugin root:
`C:\Users\octav\.claude\plugins\marketplaces\openai-codex`); the job id also drops out of
the registry once consumed, so read the diff/`git status` directly if `result` 404s. In
Round 5 this caught a whole-feature-dead bug (capability recommendations never fired due to
a tool-id mismatch) that 192 green tests and a clean boot both missed, because the bug was
in the seam between a unit test's self-made fixture and the real recorded data — see the
Round 5 entry.

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

**Round 5 — Phase 4 ("Drafting and Revision Tools")**

A prioritized-but-complete core of spec §15 Phase 4, built across one parallel wave of
six agents plus one sequential follow-up agent, then subjected to an independent Codex
review pass (see "Codex review" below). Carried-forward scope decisions (unchanged from
Phase 3): model calls stay simulated, no new npm dependencies, honest-placeholder
labeling for anything still simulated. A key structural win this round: **no Wave 1 item
needed to touch `shared/ipc.ts` / `handlers.ts` / `preload/index.ts`** — everything rode
on existing generic IPC (`scenes.write`, `codex.*`, `sessions.*`, `snapshots.*`,
`capabilities.create`) or pure renderer/simulator state, which removed the main
append-only-conflict source from the Phase 3 wave.

*Wave 1A — Keyboard-first suggestion review & revision status:* J/K (next/prev), A/R
(accept/reject), and per-category "Accept all" batch controls, implemented at the
`ManuscriptWorkspace.tsx` container level (not `AgentRail.tsx` — that file is only the
run-trigger panel; the suggestion cards actually render in `ManuscriptWorkspace`). New
dependency-free `shared/suggestionReview.ts` holds the pure ordering/traversal helpers.
The keydown guard `isTypingTarget()` bails on `input`/`textarea`/`select`/contenteditable
(Tiptap's ProseMirror root) and on any modifier key, so J/K/A/R never steal keystrokes
while drafting. Added `'fixed'` to `SuggestionRef['state']` (spec §7.2's 5th Story Editor
issue status) with a "Mark Fixed" action on `EditorialFindingCard`.

*Wave 1B — Agent-proposed metadata & craft reference layer:* the `'metadata-proposal'`
suggestion kind is now constructed end-to-end (Dev-Editor proposes a partial `SceneMeta`
patch via the pure `proposeSceneMetadataPatch()`), rendered by new `MetadataProposalCard`,
and applied on accept via `scenes.write({ meta })` in `store.ts`'s `setSuggestionState`
(the real metadata-persistence path — `SceneMetadataPanel` is read-only; there is no
separate metadata IPC). New `renderer/src/lib/craftReference.ts` (`CRAFT_CONCEPTS`:
hooks, scene turns, causality, stakes, setup/payoff, POV, pacing) surfaced as inline
expandable chips on findings tagged with `craftConceptIds`.

*Wave 1C — Dialogue voice profiles & side-by-side version comparison:* typed
`CharacterVoiceProfile` (spec §7.4's 13 fields) added to `CodexEntry`, edited in
`CodexEntryForm` for character entries, read by the Dialoguer to produce 3 tension-tier
alternates (`buildTensionAlternatives()`) and to flag similar-sounding characters
(`detectSimilarVoices()`, surfaced as `editorial-finding`s). Generator gained opt-in
multi-draft mode (Advanced-Mode-gated, N `insertion`s sharing a `draftGroupId`) rendered
in a new `DraftComparisonView`; the word-level LCS diff was extracted to
`shared/diffText.ts`. The previously-orphaned `SnapshotDiffView` is now reachable via a
"Revision history" toggle in the workspace toolbar.

*Wave 1D — Focus themes, read-aloud, writing sprints:* completed the Typewriter theme
(`[data-theme='typewriter']` in `tokens.css`; `theme` union was already forward-declared
`'paper'|'night'|'typewriter'` in `schema/project.ts`); `toggleTheme` now cycles 3-way
via `THEMES`. New `ReadAloudControl` (browser-native `speechSynthesis`, sentence-split
utterances for sentence-level highlight — no dependency). New `SprintTimer` (15/25/45
presets + quiet summary); it deliberately does **not** re-log words via
`sessions.logActivity` because `handlers.ts`'s `scene:write` already logs the delta on
every autosave — double-logging would inflate the Dashboard momentum card. Added
word-count-on-hover to distraction-free mode (the one gap left from Round 2's focus-mode
checklist).

*Wave 1E — World Builder interview:* new `WorldBuilderInterview` wizard (6 spec topics +
8 genre templates) whose compiled answers are smuggled through
`AgentGoal.scope.selectionText` (marker-prefixed JSON via `shared/worldBuilderInterview.ts`)
so no `AgentGoal`-schema/zod widening was needed. `runWorldBuilder` now returns 2–4
proposed Codex entries via `deriveWorldBuilderProposals()`, each through the existing
`CodexAdditionCard` approval flow; added a new `'author-stated'` citation reliability
value (distinct from the regex-guess `'low'`) for facts synthesized from the writer's own
answers.

*Wave 1F — Visual story tools:* `Timeline.tsx` extended into a 4-tab view (Timeline /
Plot Threads / Character Map / Conflict Curve), all manuscript-linked via the existing
`getManuscriptReadingOrder()`. New `'plot-thread'` `CodexEntryType`; new
`SceneCraftMeta.conflictLevel` (1–5) and Tier-1 `SceneMeta.presentCharacterIds`, both
editable in `SceneMetadataPanel` and written via a new `updateSceneMeta` store action.
Plot-thread→scene links are **derived** by scanning `SceneContinuityMeta.setupIds`/
`payoffIds` rather than duplicating the relationship. Hand-rolled SVG/CSS-grid charts (no
chart library added). New pure functions in `shared/codexLogic.ts`
(`getPlotThreadSceneLinks`, `getConflictCurve`, `getCharacterPresenceMap`).
**Important gotcha this wave hit:** zod's `.object()` silently strips unknown keys, so new
`CodexEntryType`/`SceneMeta` fields **had to** be mirrored into `shared/validation.ts` or
they'd be dropped at the IPC write boundary — the same sharp edge every schema-touching
Phase 4 agent had to remember.

*Wave 2 — Production tool use across roles + capability recommendations:* each of the 5
roles now folds one **real** sandboxed-tool call into its result (Generator/Line-Editor →
`word-count`; Dialoguer → real `codex-search` via `retrieval/search.ts`, called directly
since codex-search can't run in the `vm` sandbox; World-Builder → `codex-contradiction-check`
against *proposed* + existing Codex, warnings folded into proposals via the pure
`applyContradictionWarnings()`). New `detectRepeatedToolPattern()` +
`maybeRecommendCapability()`: when a role reaches for the same tool across 3+ separate
completed runs, Dev-Editor surfaces a `'capability-recommendation'` suggestion; accepting
it installs the draft manifest via `capabilities.create` (routed through
`setSuggestionState` so per-card Accept **and** batch Accept-all both install — a card's
own Accept button alone would have missed the batch path). The Wave 2 agent hit its
session limit mid-task; the orchestrator finished the last piece (the store.ts install
routing) by hand.

*Codex review (new this round):* per the user's request, after all Phase 4 code was
merged and green, an independent **Codex** subagent (via the `codex:codex-rescue` agent
type / `codex-companion.mjs status|result`) reviewed the full `479e803..HEAD` diff for
correctness only. It surfaced 3 real bugs, all confirmed against the code and fixed:
- **HIGH — capability recommendations were dead on arrival.** `maybeRecommendCapability`
  did `capabilities.find(c => c.id === match.toolId)`, but recorded tool-call ids are
  versioned per-role *pseudo* ids (`global.tools.structural-analysis@1.0.0`) that match
  **no** installed manifest, so it always bailed and no recommendation ever appeared.
  Fixed to strip the `@version` and **synthesize** a minimal draft manifest when there's
  no installed tool to clone (the per-role workflow tools have none). The reason this
  slipped through: the round's own isolated unit test used a *real* manifest id
  (`codex-search`) as its fixture, so it never exercised the versioned-pseudo-id path.
  Added `simulator.capabilityRecommendation.test.ts` that drives a real Dev-Editor run
  end-to-end to close that blind spot.
- **MED — J/K review skipped two card kinds.** `KIND_ORDER` in `suggestionReview.ts` still
  omitted `'metadata-proposal'` and `'capability-recommendation'` (a stale Wave-1A comment
  claimed no card rendered them — true when written, false after 1B/2). Both added.
- **LOW — grouped draft rows had no scroll/focus anchor.** `DraftComparisonView` now takes
  `focusedSuggestionId` and renders the `suggestion-<id>` anchor + focus ring per row.

  Lesson worth keeping: a fresh independent reviewer (here, a different model) caught a
  whole-feature-dead bug that a green test suite + clean boot did not — because the bug
  lived in the seam *between* an isolated unit under test and the real recorded data it
  runs against. When a feature's unit test constructs its own fixture, make at least one
  test drive the real production entry point end-to-end.

**Explicitly deferred from Phase 4** (confirmed scope, not oversight): real
OpenRouter/LM Studio provider integration + API-key vault (still simulated); the full
production capability review/compare/rollback workflow beyond enable/disable/deprecate +
this round's recommendation drafts; real external MCP connectivity; TTS voice selection
and reduced-motion tuning for read-aloud; craft-reference explainers are static text (no
deep-linking into a lesson library). Carried-over Phase 3 deferrals still stand.

**Round 6 — Phase 5 ("Import, Export, and Production Hardening")**

Spec §15 Phase 5, built as a sequence of items (not a parallel wave — see the build-method
note below). Two scope decisions this round **reversed prior standing constraints, with
explicit user sign-off**: (1) the "no new npm dependencies" rule was **lifted for Phase 5's
real file I/O** — `docx`, `pdfkit`, `jszip`, `mammoth` (all pure-JS, main-process-only) were
added for real export/import; (2) full-core scope, all five export formats + typeset Series
Bible. Model calls still stay simulated (that deferral is unchanged).

*Build-method note (important):* this round **tried Codex subagents as the builder**
(`codex-companion.mjs task --write`) and **abandoned it mid-round** at the user's direction.
Codex operates on the **shared working tree**, not isolated worktrees, so its build jobs
can't parallelize (they collide on `shared/ipc.ts`/`handlers.ts`/`preload/index.ts`) and the
larger ones repeatedly hit their own session limits mid-task, leaving orphaned backend for
the orchestrator to finish by hand. Reverted to **Claude worktree agents for building**
(Item 5 was built that way, cleanly). Codex is retained **only** for the review pass. See
the "Codex is used ONLY for the independent review pass" note near the top.

*Item 1 — Real export engine:* `main/export/` renders the manuscript to **Markdown / plain
text / PDF (pdfkit) / DOCX (docx) / EPUB (jszip-assembled EPUB3)** and the Codex to **JSON /
Markdown / compressed series-bible**, plus a **typeset Series Bible to PDF and EPUB**. Pure
`render*` functions (return `Buffer`/`string`, unit-tested by magic-byte + substring) are
split from the Electron dialog+write handler. `Export.tsx` performs real exports via new
`export:manuscript`/`export:codex` IPC + `dialog.showSaveDialog`. Private (`isPrivate`)
entries are excluded from shareable codex exports.

*Item 2 — Manuscript import + Codex extraction:* `main/import/` parses `.md`/`.txt`/`.docx`
(mammoth `extractRawText`) into a real `.atlas` project (books/parts/chapters/globally-unique
scenes); heuristic `extractCodexCandidates` (repeated proper nouns, dialogue attribution,
location prepositions) proposes character/location entries through a new `ImportReview`
writer-approval gate before any become `ai-extracted`/`tentative` Codex entries. New
`import:manuscript` IPC + Landing "Import Manuscript" card. Honest limits: heuristic, and
`.docx` heading *styles* are lost by `extractRawText` (only literal "Chapter N" lines split).

*Item 3 — Autosave trust signal + backup/snapshots + recovery:* save indicator shows
"All changes saved · h:mm AM/PM" (`store.lastSavedAt`). `backupStore.ts` makes labeled
project backups/snapshots (one jszip engine) that **skip the `backups/` dir (no nesting) and
the rebuildable `index.sqlite`**; restore is **non-destructive** (extracts to a new
`<name>-restored-<ts>.atlas`). Interrupted-session recovery via a `settings/session.lock`
written on open (after checking for a stale one) and removed on clean quit; a stale lock
raises a dismissible workspace banner. New `backup:*` + `session:recovery-status` IPC;
Settings "Backups & snapshots" section.

*Item 4 — Privacy authorization flows:* real **API-key vault** (`main/security/keyVault.ts`,
Electron `safeStorage`/OS keychain) — refuses plaintext when encryption is unavailable,
path-traversal-guarded names, and the IPC bridge exposes only `set/has/clear` so the **raw
secret never reaches the renderer**. Heuristic cloud-model classifier (`shared/privacy.ts`),
per-scene `localModelOnly` flag (+ `validation.ts` mirror + `SceneMetadataPanel` toggle),
and a run-start gate (`AgentRail.authorizeRun`, both invoke + interview paths): a local-only
target scene **blocks** a cloud run, else a cloud run without session auth opens
`CloudConsentDialog`. Settings "Privacy" section. (This **delivers the API-key vault** that
Phase 4 had listed as deferred.)

*Item 5 — Error handling + storage hardening (Claude worktree agent):* React `ErrorBoundary`
(outside the router), a global toast surface for unhandled rejections/errors, main-process
`uncaughtException`/`unhandledRejection` log-and-continue guards, a typed `AtlasError` for
corrupt/missing manifests, and store IPC actions that catch → toast → reset state instead of
stranding a half-open stage. Pure `shared/errors.ts` with tests.

*Also fixed a pre-existing flake:* six `AgentRunManager` tests raced the async `result` step
with a fixed `setTimeout(0|50|60)`; replaced with a deterministic poll helper
(`simulator.testUtils.ts:waitForResultStep`) — 8/8 consecutive full-suite runs green.

*Codex adversarial-review (closing step, retained):* `codex-companion.mjs adversarial-review
--base eb6025c` on the whole Phase 5 diff surfaced 3 findings, all confirmed against the code
and fixed:
- **HIGH — same-title import overwrote an existing project** (path derived from the title
  slug alone). Now suffixes the folder (`-2`, `-3`, …) until unique, so import is additive.
- **HIGH — the `localModelOnly` invariant was renderer-only.** Added a main-side hard-block
  in the `AgentRunStart` handler: a cloud-classified model run against a local-only scene is
  rejected with `AtlasError`, even via a direct bridge call.
- **MED — a stale tracked-change accept** (original `before` text gone) skipped the write but
  still marked the card accepted. Now surfaces a conflict toast and bails before the flip.

**Explicitly deferred from Phase 5** (confirmed scope): real OpenRouter/LM Studio provider
integration is still simulated (the *vault* now exists, but no live model calls) — and with
it, **main-side cloud-consent *session* tracking** (the consent modal is renderer-side; the
main-side guard enforces only the `localModelOnly` data invariant, which is enough while
transmission is simulated); DOCX import fidelity beyond raw text (heading styles); beta-reader
DOCX-comment import (spec's post-Phase-5 item). Carried-over Phase 3/4 deferrals still stand.

**Round 7 — Phase 6 ("Real Model Integration")**

The first post-Phase-5 beta round, scoped from `Atlas Beta Roadmap - Gap Analysis.md`'s own
Phase 6 write-up. Confirmed scope decision with the user up front, via `AskUserQuestion`,
before any code: **"Infrastructure-first."** Real OpenRouter + LM Studio adapters, real
per-role prompt persistence, real usage/cost tracking, real per-agent model routing, real
functional fallback, and real main-side cloud-consent session tracking — but only
**Generator and Line-Editor** produce suggestion text from real completions this round. Story
Editor/Dialogue Editor/World Builder get real adapter connectivity and real cost tracking but
keep their template-based structured multi-finding simulation; extracting structured findings
reliably from a real model needs JSON-mode/tool-calling design work, deliberately deferred to
a later quality-focused phase rather than folded into this one. No token streaming this round
either — single request/response, also deliberately deferred.

*Planning note:* before dispatching any subagent, a `Plan`-agent validation pass corrected the
initial 3-way-fully-parallel wave design. It found `main/agent/simulator.ts` and
`AgentRail.tsx` can't safely be split across two concurrent agents (same lines, different
rewrites) and that the consent/fallback/real-text wave structurally depends on both other
waves' *real* merged exports (`getActivePrompt`, `recordUsage`, `ModelCallSummary.outputText`,
`ProviderAdapter.isAvailable()`) — forking it before they merged would mean it couldn't even
compile in its own worktree. Corrected structure: **Wave 0** (orchestrator, direct) added an
explicit `'simulator'` `ModelProvider` value both Wave 1 agents needed present in their forks.
**Wave 1** ran two agents truly in parallel on disjoint file ownership. **Wave 2** forked fresh
*after* Wave 1 merged, briefed against Wave 1's actual merged code (re-verified by the
orchestrator directly, not assumed) rather than the original plan's guesses — this caught that
Wave 1B had already been forced to fix two lines in `AgentRail.tsx` (owned by Wave 2) just to
keep its own build compiling after a shared type change, shrinking Wave 2's real remaining
scope there to two small additions instead of a full rewrite.

*Operational note:* both Wave 1 agents hit a transient API stream-stall failure mid-task
(unrelated to either brief). Both had substantial uncommitted work intact in their worktrees;
resumed via `SendMessage` with precise "continue from exactly here" instructions rather than
restarting from scratch — full verification after resuming confirmed no work was lost or
duplicated.

*Wave 1A — Adapters & schema:* `openRouterAdapter.ts`/`lmStudioAdapter.ts` replaced their
unconditional-throw stubs with real HTTP implementations; `ProviderAdapter` gained
`isAvailable()`; `ModelCallSummary` gained optional `outputText`. Real deviation from the
original design assumption, verified against live OpenRouter docs while implementing: the
`usage: {include: true}` request flag is deprecated and has no effect — usage accounting is
included in every response by default now.

*Wave 1B — Prompts, usage, catalog, routing, Settings:* `promptStore.ts` wires up
`PromptEditorSection` — a component that had existed since **before this round** fully built
in the UI (role picker, version label, reset/save-new-version buttons) but held everything in
local `useState`, discarding every edit on reload. `usageStore.ts` (append-only per-project
JSONL) and `openRouterCatalog.ts` (live model+pricing catalog, 1h cache) back a new Settings
"Usage & cost" section and catalog-driven model dropdowns. `agentModels` refactored
project-wide from `Record<AgentRole, string>` (a bare display name) to
`Record<AgentRole, ModelRef>` — the real routing type, not a mockup label.

*Wave 2 — Consent, fallback, real-text loop:* `cloudConsent.ts`'s `CloudConsentSessionStore`
closes the deferral called out at the end of Round 6 — `AgentRunStart` now enforces
`CLOUD_CONSENT_REQUIRED` the same way it already enforced `LOCAL_MODEL_ONLY`, so a direct
bridge call can no longer start a cloud run in a session that never showed the consent dialog.
`simulator.ts`'s `runModelCallStep()` became the single choke point for system-prompt
resolution, LM Studio fallback on a primary-adapter failure, and error classification — a
failed real call with no usable fallback now ends a run in a new recoverable `'paused'` status
(declared in the type system since Phase 2, never produced by any code path until now) instead
of a hard `'error'`. Generator and Line-Editor now emit suggestions built from a real adapter's
actual completion text when one is selected, instead of unconditionally using the template
simulator.

*Codex adversarial-review (closing step, retained):* the full `0b21cf7..HEAD` diff surfaced 4
findings; 3 confirmed and fixed, 1 accepted as a documented limitation rather than a code
change:
- **HIGH — OpenRouter missing/malformed usage was silently recorded as $0/0 tokens.** A
  successful response with content but no usage object (an anomaly per OpenRouter's own
  docs, which say usage is always included) let a real paid call bypass `maxCostUsd` budget
  checks. Now fails loudly with `OPENROUTER_BAD_RESPONSE` when token counts are missing;
  `cost` alone is still allowed to be absent (a plausible free-model case) without treating
  the whole response as malformed.
- **MED — a failed LM Studio fallback call fell through to `'error'` instead of `'paused'`.**
  `isAvailable()` passing doesn't guarantee the completion call itself then succeeds; that
  failure wasn't re-wrapped as `ModelCallFailure`, so it skipped the intended recoverable
  path entirely. Now wrapped and re-classified the same way the primary call already was.
- **MED — the renderer's cloud-consent IPC sync was fire-and-forget** with no ordering
  guarantee relative to the `agentRuns.start` call immediately after it — a narrow but real
  race that could spuriously reject a just-approved run. Now awaited.
- **HIGH, not fixed — a caller who deliberately invokes the consent bridge directly can
  still grant their own run consent**, bypassing the renderer dialog on purpose. This round's
  actual goal was closing *accidental* bypass (a future code path that starts a cloud run
  without going through `authorizeRun()`), which the guard correctly does. A local
  single-user desktop app has no meaningful adversarial boundary between its own renderer and
  main process; proving a dialog was actually shown without moving the whole UI into the main
  process isn't worth the redesign for the value it would add. Documented as an accepted
  limitation, same treatment Round 6 gave the `warnCloudUnpublished`-not-synced-to-main
  decision.

4 new regression tests added for the 3 fixed findings (missing/malformed OpenRouter usage,
fallback-call-itself-fails routing to `'paused'`).

**Explicitly deferred from Phase 6** (confirmed scope, not oversight): token streaming (single
request/response only); real multi-draft "Generate Alternatives" against a real model (still
simulated even when a real adapter is selected — N real HTTP calls per run isn't designed for
yet); structured-output extraction for Story Editor/Dialogue Editor/World Builder (still
template-simulated, real cost tracking only); LM Studio base-URL configurability (hardcoded to
the default local port); direct Anthropic/OpenAI/Google provider keys (spec routes remote
calls through one OpenRouter key by design). These are the natural scope of a later
quality-focused phase.

## Current verified state (as of Round 7 / Phase 6 completion)

- `npx tsc --noEmit` clean on both `tsconfig.web.json` and `tsconfig.node.json`.
- `npx vitest run` — 267/267 tests passing across 45 files (was 224/38 at Round 6), stable
  across multiple consecutive full-suite runs. One isolated flake was observed once in
  `simulator.test.ts`'s `afterEach` `rmSync` cleanup (a transient Windows file-handle race
  during test teardown, not an assertion failure) — reproduced as a clean pass in isolation
  and in 3/3 subsequent full-suite runs; not a Phase 6 regression.
- App launches cleanly via `npm run dev` after all three waves merged, with only the expected
  dev-mode warnings (React DevTools suggestion, React Router v7 future flags, Electron CSP
  insecure-policy) — no regressions, no circular-import/TDZ crash.
- No real OpenRouter API key was available in this environment to exercise the actual
  money-spending call path end-to-end (saving a key and running Generator/Line-Editor against
  a real model, confirming real cost appears in Settings). That remains a manual verification
  step for the user with their own key. Full interactive click-through of the new Phase 6 UI
  (model routing dropdowns, prompt editor persistence across reload, the usage/cost section,
  LM Studio fallback with a real local server) was **not** performed for the same
  no-headless-Electron-driver reason noted in every prior round. Verification relied on the
  automated suite (incl. mocked-`fetch` adapter tests exercising the real HTTP request/response
  shapes), a real `npm run dev` boot check, and an independent Codex adversarial-review of the
  whole diff.
