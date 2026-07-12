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

## Current verified state (as of Round 3 completion)

- `npx tsc --noEmit` clean on both `tsconfig.web.json` and `tsconfig.node.json`.
- `npx vitest run` — 28/28 tests passing across 5 files.
- App launches cleanly via `npm run dev` (main + preload build, renderer connects) with
  only expected dev-mode warnings (React DevTools suggestion, React Router v7 future
  flags, Electron CSP insecure-policy warning) — none of these are regressions.
