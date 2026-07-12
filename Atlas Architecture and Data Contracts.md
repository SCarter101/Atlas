# Atlas Architecture and Data Contracts (Phase 1.5 → Phase 2)

This document is the bridge between the disposable Phase 1 HTML prototype and the real
Phase 2 application. It records the production stack decision, the on-disk project
format, the core domain schemas, the storage boundary between plain files and the local
index database, and the IPC contract between the Electron renderer and main process.

Everything here is versioned alongside the code. When a schema changes, bump the
relevant `schemaVersion` field and add a migration (see §7).

## 1. Stack Decision

| Concern | Decision |
|---|---|
| Desktop shell | Electron |
| Frontend | React + TypeScript, built with Vite (via `electron-vite`) |
| Backend/runtime logic | Node.js (TypeScript), embedded in Electron's main process |
| Manuscript editor | TipTap (ProseMirror) |
| Project data storage | Hybrid — Markdown/JSON files are the source of truth; SQLite is a rebuildable local index |
| Agent runtime | Embedded in-process (main process), behind an internal module boundary that allows future extraction to a standalone service |
| IPC | Electron `contextBridge` + `ipcMain`/`ipcRenderer`, typed end-to-end |

Rationale is recorded in conversation history; the short version: a solo/small team
benefits most from one language (TypeScript) across UI and agent orchestration, where
the LLM/embedding ecosystem is most mature. Tauri/Rust and a sidecar agent service
remain viable extraction targets later if performance or a hosted/collaboration roadmap
demands it — nothing below assumes Electron-only forever, but nothing below is built to
support that migration prematurely either.

## 2. Project Folder Layout

This refines the conceptual structure in the spec (§12) into a concrete, versioned
layout.

```text
my-novel.atlas/
  project.json                 # Project manifest (see §3.1)
  index.sqlite                 # Derived index — safe to delete and rebuild from files
  manuscript/
    book-01/
      meta.json                # Book title, order, notes
      part-01/
        meta.json
        chapter-001/
          meta.json            # Chapter title, order, POV default, summary
          scene-001.md          # Scene prose (Markdown, front-matter-free)
          scene-001.meta.json   # Scene metadata (see §3.3)
          scene-002.md
          scene-002.meta.json
  codex/
    characters/<entry-id>.json
    locations/<entry-id>.json
    factions/<entry-id>.json
    objects/<entry-id>.json
    events/<entry-id>.json
    world-rules/<entry-id>.json
    timeline/<entry-id>.json
    relationships/<entry-id>.json
    themes/<entry-id>.json
    motifs/<entry-id>.json
    research/<entry-id>.json
    scene-notes/<entry-id>.json
    private-notes/<entry-id>.json
  summaries/
    chapters/<chapter-id>.json
    scenes/<scene-id>.json
    arcs/<character-id>.json
  revisions/
    <scene-id>/<snapshot-id>.json
  capabilities/
    skills/<skill-id>/manifest.json
    tools/<tool-id>/manifest.json
  agent-runs/
    <run-id>.json
  exports/
  settings/
    local.json                 # Per-project local settings (not synced/exported)
```

Notes:

- `.atlas` is a **folder**, not a single file — matches the "human-readable, LLM-retrievable"
  requirement in spec §12 and keeps it git-diffable.
- `index.sqlite` is **never** the source of truth for content. It is rebuilt by walking
  the folder tree. Corruption or a schema change is recoverable by deleting it.
- Global tools/skills and the API-key vault live outside the project, in an
  Atlas user-data directory (`app.getPath('userData')` on Electron), matching spec §8/§12.

## 3. Domain Schemas

All schemas below are the authoritative TypeScript shapes. They live in a shared
`packages/schema` workspace package so both the main process and renderer import the
same types (no duplication, no drift).

### 3.1 Project

```ts
interface ProjectManifest {
  schemaVersion: 1;
  id: string;                    // uuid
  title: string;
  createdAt: string;             // ISO 8601
  updatedAt: string;
  genrePrimary?: string;
  targetWordCount?: number;
  books: string[];                // book ids, ordered
  activeSceneId?: string;         // "where you left off"
  advancedMode: boolean;
  theme: 'paper' | 'night' | 'typewriter';
}
```

### 3.2 Manuscript Hierarchy

```ts
interface Book { id: string; projectId: string; title: string; order: number; }
interface Part  { id: string; bookId: string; title: string; order: number; }
interface Chapter {
  id: string; partId: string; title: string; order: number;
  summary?: string; sceneIds: string[];
}
```

### 3.3 Scene and Tiered Metadata

Matches spec §5 exactly; the tiers are a UI progressive-disclosure concern, not a
storage concern — all tiers live in one `.meta.json` file.

```ts
interface SceneMeta {
  schemaVersion: 1;
  id: string;
  chapterId: string;
  order: number;

  // Tier 1 — always visible
  title: string;
  povCharacterId?: string;        // Codex character entry id
  locationId?: string;            // Codex location entry id
  timeOrDate?: string;
  purpose?: string;

  // Tier 2 — Story Craft
  craft?: {
    characterDesire?: string;
    externalGoal?: string;
    internalConflict?: string;
    opposition?: string;
    stakes?: string;
    turningPoint?: string;
    outcome?: string;
    emotionalShift?: string;
    revealedInformation?: string;
  };

  // Tier 3 — Continuity and Threads
  continuity?: {
    timelinePlacement?: string;
    continuityNotes?: string;
    setupIds?: string[];          // links to plot-thread entries
    payoffIds?: string[];
    foreshadowingNotes?: string;
    themeIds?: string[];
    motifIds?: string[];
    relatedCodexIds?: string[];
  };

  wordCount: number;
  status: 'outline' | 'drafting' | 'drafted' | 'revised' | 'final';
  updatedAt: string;
}
```

Scene prose lives in the sibling `.md` file, referenced by filename convention
(`scene-XXX.md` ↔ `scene-XXX.meta.json`), not by an ID lookup — this keeps the pair
movable and human-legible.

### 3.4 Codex Entry

```ts
type CodexEntryType =
  | 'character' | 'location' | 'faction' | 'object' | 'event' | 'world-rule'
  | 'timeline-item' | 'relationship' | 'theme' | 'motif' | 'research-note'
  | 'historical-reference' | 'scene-note' | 'private-author-note';

type FactStatus = 'canon' | 'tentative' | 'deprecated' | 'contradicted';

interface CodexEntry {
  schemaVersion: 1;
  id: string;
  type: CodexEntryType;
  name: string;
  status: FactStatus;
  body: Record<string, unknown>;   // type-specific fields, e.g. voice profile for character
  isPrivate: boolean;
  localModelOnly: boolean;
  locked: boolean;                  // world rules only — Generator must not violate
  source: 'author' | 'ai-proposed' | 'ai-extracted';
  approvedAt?: string;               // null until a human approves an ai-* entry
  relationships: CodexRelationship[];
  manuscriptLinks: ManuscriptLink[]; // where this fact appears/was established
  spoilerRevealSceneId?: string;     // earliest scene this may be shown to the reader
  createdAt: string;
  updatedAt: string;
  history: CodexVersion[];           // append-only
}

interface CodexRelationship {
  id: string;
  targetEntryId: string;
  kind: string;          // free-text or controlled vocabulary, e.g. "sibling-of", "located-in"
  notes?: string;
}

interface ManuscriptLink { sceneId: string; excerpt?: string; }

interface CodexVersion {
  versionId: string;
  changedAt: string;
  changedBy: 'author' | string;    // agent id if AI-proposed
  diffSummary: string;
  snapshot: Record<string, unknown>;
}
```

AI-authored entries (`source: 'ai-proposed' | 'ai-extracted'`) are written to disk as
**drafts** in the same file with `approvedAt: null` and excluded from default retrieval
until approved — this is how "AI-proposed Codex additions must never become canon
automatically" (spec §6) is enforced at the storage layer, not just the UI layer.

### 3.5 Agent Run (Model-Neutral Capability Protocol)

This is the internal schema spec §8 calls for — one shape regardless of model provider.

```ts
type AgentRole = 'Generator' | 'Dev-Editor' | 'Line-Editor' | 'Dialoguer' | 'World-Builder';

interface AgentGoal {
  runId: string;
  agentRole: AgentRole;
  modelRef: ModelRef;
  userIntent: string;               // e.g. "Send selection to Line Editor"
  scope: {
    sceneIds?: string[];
    selectionText?: string;
    codexEntryIds?: string[];
  };
  constraints: {
    maxTurns: number;
    maxTokens: number;
    maxToolCalls: number;
    maxElapsedMs: number;
    maxCostUsd?: number;
    allowedCapabilityCategories: string[];
  };
}

interface ModelRef {
  provider: 'anthropic' | 'openai' | 'google' | 'openrouter' | 'lm-studio';
  modelId: string;
  viaOpenRouter: boolean;
}

interface AgentStep {
  stepIndex: number;
  kind: 'plan' | 'tool-call' | 'skill-invoke' | 'permission-request' | 'model-call' | 'result';
  timestamp: string;
  detail: ToolCall | SkillInvocation | PermissionRequest | ModelCallSummary | AgentResult;
}

interface ToolCall {
  toolId: string;           // namespaced+versioned, e.g. "global.tools.contradiction-check@1.2.0"
  input: unknown;           // validated against the tool's input schema
  output?: unknown;
  error?: AgentError;
}

interface SkillInvocation {
  skillId: string;
  input: unknown;
  output?: unknown;
}

interface PermissionRequest {
  capabilityId: string;
  actionType: string;
  dataScope: string;
  destination?: string;     // e.g. "openrouter" | "web" | filesystem path class
  decision: 'approved-once' | 'approved-session' | 'denied' | 'pending';
}

interface ModelCallSummary {
  modelRef: ModelRef;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  // No private chain-of-thought is persisted or displayed, per spec §8.
}

interface AgentResult {
  summary: string;
  proposedManuscriptChanges?: SuggestionRef[];
  proposedCodexChanges?: SuggestionRef[];
  citations?: Citation[];
  warnings?: string[];
  nextSteps?: string[];
}

interface AgentError { code: string; message: string; recoverable: boolean; }
interface Citation { sourceUrl?: string; note: string; reliability?: 'low' | 'medium' | 'high'; }

interface AgentRunRecord {
  schemaVersion: 1;
  goal: AgentGoal;
  steps: AgentStep[];
  status: 'running' | 'paused' | 'completed' | 'cancelled' | 'error';
  startedAt: string;
  endedAt?: string;
}
```

`AgentRunRecord` is what gets written to `agent-runs/<run-id>.json` and is exactly what
backs the action-trace UI (spec §8) — nothing is shown in that UI that isn't in this
record, and this record never contains raw model reasoning tokens.

### 3.6 Suggestion (Universal AI Suggestion Contract)

```ts
interface SuggestionRef {
  id: string;
  agentRole: AgentRole;
  kind: 'insertion' | 'tracked-change' | 'editorial-finding' | 'dialogue-alternative'
      | 'metadata-proposal' | 'codex-addition';
  targetSceneId?: string;
  targetCodexEntryId?: string;
  payload: unknown;                 // shape depends on `kind`
  provenance: { capabilityId?: string; capabilityVersion?: string; runId: string };
  state: 'pending' | 'accepted' | 'rejected' | 'refining';
  refineInstruction?: string;
}
```

Every suggestion, regardless of originating agent, is stored and rendered through this
one shape — this is what makes "Accept / Reject / Refine" a single reusable UI
component rather than five bespoke ones.

### 3.7 Tool / Skill Manifest

```ts
interface CapabilityManifest {
  schemaVersion: 1;
  id: string;                       // namespaced: "global.tools.x" | "project.<projectId>.skills.y"
  name: string;
  description: string;
  type: 'tool' | 'skill';
  scope: 'global' | 'project';
  owner: string;
  version: string;                  // semver
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  requiredContext: string[];
  dependsOn: string[];               // other capability ids (namespaced+versioned)
  compatibleAgentRoles: AgentRole[];
  compatibleModelCapabilities: string[]; // e.g. "tool-calling", "min-context-32k"
  sideEffects: 'none' | 'reads-project' | 'writes-project' | 'network' | 'filesystem-external';
  permissionCategory: string;
  localOnly: boolean;
  costCharacteristics: { estTokens?: number; estTimeMs?: number; estCostUsd?: number };
  validationStatus: 'untested' | 'passed' | 'failed';
  lifecycleState: 'draft' | 'enabled' | 'disabled' | 'deprecated';
  createdBy: 'author' | 'agent-generated';
  history: { versionId: string; changedAt: string; note: string }[];
}
```

### 3.8 Permission / Session Approval

```ts
interface SessionApproval {
  id: string;
  capabilityId: string;
  capabilityVersion: string;
  actionType: string;
  dataScope: string;
  destination?: string;
  grantedAt: string;
  expiresAtSessionEnd: true;        // session approvals never outlive the app session
}
```

A broader scope, a different destination, or a different capability version invalidates
a prior `SessionApproval` and forces a new `PermissionRequest` — enforced by comparing
all four fields, not just `capabilityId`.

## 4. Storage Boundary (Files vs. SQLite Index)

**Files are the only source of truth.** SQLite exists purely to make retrieval fast and
is rebuilt by re-reading the project folder.

| Data | Lives in files | Lives in SQLite index |
|---|---|---|
| Scene prose | ✅ (`.md`) | — |
| Scene metadata | ✅ (`.meta.json`) | mirrored, indexed by scene/chapter/POV/status |
| Codex entries | ✅ (`.json`) | mirrored, indexed by type/status/name, FTS5 full-text |
| Codex relationships | ✅ (embedded in entry) | mirrored as an edge table for graph/contradiction queries |
| Embeddings (Phase 3) | — | SQLite (`sqlite-vec` or equivalent) only, regenerable from files |
| Agent runs | ✅ (`agent-runs/*.json`) | mirrored, indexed by date/agent/status for the activity panel |
| Capability manifests | ✅ (`capabilities/**/manifest.json`) | mirrored, indexed by scope/type/status |

Write path: the app **always writes files first**, then updates the SQLite row in the
same transaction-like sequence (file write → fsync → SQLite upsert). If the SQLite
upsert fails, the file write already succeeded and a background reconciliation pass can
repair the index. If a file write fails, nothing is indexed. This ordering guarantees
the index can never point at data that doesn't exist on disk.

## 5. IPC Contract (Renderer ↔ Main)

Renderer never touches the filesystem or SQLite directly. All access goes through a
typed IPC layer exposed via `contextBridge`, e.g.:

```ts
// preload — exposed as window.atlas
interface AtlasBridge {
  project: {
    open(path: string): Promise<ProjectManifest>;
    create(path: string, seed: Partial<ProjectManifest>): Promise<ProjectManifest>;
  };
  scenes: {
    read(sceneId: string): Promise<{ meta: SceneMeta; prose: string }>;
    write(sceneId: string, patch: { meta?: Partial<SceneMeta>; prose?: string }): Promise<void>;
  };
  codex: {
    list(filter?: { type?: CodexEntryType; status?: FactStatus }): Promise<CodexEntry[]>;
    upsert(entry: CodexEntry): Promise<void>;
  };
  agentRuns: {
    start(goal: AgentGoal): Promise<{ runId: string }>;
    subscribe(runId: string, onStep: (step: AgentStep) => void): () => void; // returns unsubscribe
    respondToPermission(runId: string, requestId: string, decision: PermissionRequest['decision']): Promise<void>;
  };
}
```

Every method is `async` and every payload is validated against the shared schema
package on both sides (renderer never trusts its own state; main never trusts the
renderer's input) — this is the seam where a future sidecar-service extraction would
happen with minimal churn, since the renderer already only talks through this
interface.

## 6. Simulated Agent Runtime (Phase 2 Scope)

Per spec §15 Phase 2 and the user's own phase plan, Phase 2 wires the **real**
`AgentGoal` → `AgentStep[]` → `AgentRunRecord` pipeline end-to-end, but the
`model-call` step is answered by a local simulator, not a real provider call:

- The simulator returns deterministic, canned `AgentResult` payloads keyed by
  `agentRole` + a couple of scope heuristics (e.g. Line Editor on a selection returns a
  tracked-change suggestion; Story Editor on an act returns a canned editorial report).
- `PermissionRequest` steps are real — the session-approval flow, expiry, and
  scope-matching logic all run for real, just gated on simulated capability calls.
- `ModelCallSummary` token/cost numbers are simulated but shaped identically to what a
  real OpenRouter response would produce, so the cost pre-flight UI is exercised
  honestly.
- Swapping the simulator for a real OpenRouter/LM Studio call in Phase 3 should require
  changing exactly one module (the model-call executor) — nothing in the schema, IPC
  contract, or UI should need to change.

## 7. Testing and Migration Strategy

- **Schema migrations**: every persisted shape carries `schemaVersion`. A `migrations/`
  module maps `(typeName, fromVersion) -> migrationFn`. On project open, each file is
  migrated in place (written back) before use; SQLite index is simply rebuilt on any
  index schema bump rather than migrated in place.
- **Unit tests**: schema validation, migration functions, file⇄index consistency
  (property-based: random entry → write → reindex → query → compare).
- **Integration tests**: IPC contract tested against a temp project folder (no
  Electron window needed — main-process modules are plain Node and testable in
  isolation).
- **UI tests**: component tests for the suggestion contract (Accept/Reject/Refine),
  scene editor save/load, and the permission dialog, using the sample project as fixture
  data ported from the Phase 1 prototype.
- **Golden-path smoke test**: scripted flow — create project → Story Foundations fast
  path → create scene → draft in TipTap → send selection to a simulated agent → accept
  suggestion → reopen app → confirm state persisted — run before each milestone.

## 8. What This Doc Deliberately Defers

Consistent with spec §18, the following remain open and are not blocked by anything
above; they will be resolved when Phase 3 makes them load-bearing:

- Embedding provider and vector index technology
- Real OpenRouter request/response mapping and streaming strategy
- LM Studio discovery/connection handshake
- Executable-tool sandbox technology
- Capability signing / third-party distribution
- Import parser strategy (manuscript ingestion)
- Export rendering pipeline
