import type { AgentGoal, AgentRole, AgentRunRecord, AgentRunStatus, AgentStep, PermissionDecision } from './schema/agent'
import type { CapabilityManifest } from './schema/capability'
import type { CodexEntry, CodexEntryType, FactStatus } from './schema/codex'
import type { ProjectManifest } from './schema/project'
import type { ManuscriptTree, SceneMeta } from './schema/manuscript'
import type { ChapterSummary, ContextWarning, RetrievalResult, SceneSummary } from './schema/retrieval'

// Channel names shared between preload's contextBridge exposure and main's
// ipcMain handlers, so a typo can't silently create two different strings.
export const IpcChannel = {
  ProjectOpen: 'project:open',
  ProjectCreate: 'project:create',
  // Bootstraps (creating on first run if needed) the bundled "Cottonmouth"
  // demo project so the app opens on populated data — see seedSampleProject.ts.
  ProjectOpenSample: 'project:open-sample',
  // Lists previously-created projects (excluding the bundled sample) so
  // Landing can offer a "reopen" tile for each, and lets one be deleted.
  ProjectList: 'project:list',
  ProjectDelete: 'project:delete',
  // Real project creation from the Story Foundations onboarding flow.
  ProjectCreateFromFoundations: 'project:create-from-foundations',
  ManuscriptTree: 'manuscript:tree',
  SceneRead: 'scene:read',
  SceneWrite: 'scene:write',
  CodexList: 'codex:list',
  CodexUpsert: 'codex:upsert',
  CodexDelete: 'codex:delete',
  CapabilitiesList: 'capabilities:list',
  AgentRunStart: 'agent-run:start',
  AgentRunStep: 'agent-run:step',
  AgentRunRespondToPermission: 'agent-run:respond-to-permission',
  AgentRunCancel: 'agent-run:cancel',
  AgentRunsList: 'agent-runs:list',
  AgentRunGet: 'agent-runs:get',
  RetrievalSearch: 'retrieval:search',
  SummariesGetChapter: 'summaries:get-chapter',
  SummariesGetScene: 'summaries:get-scene',
  ContextWarnings: 'context:warnings'
} as const

export interface SceneReadResult {
  meta: SceneMeta
  prose: string
}

export interface SceneWritePatch {
  meta?: Partial<SceneMeta>
  prose?: string
}

export interface CodexListFilter {
  type?: CodexEntryType
  status?: FactStatus
}

// Lightweight summary for the agent-runs history list — the full
// AgentRunRecord (with its steps[]) is only fetched on demand via
// agentRuns.get() when a run is opened.
export interface AgentRunSummary {
  runId: string
  agentRole: AgentRole
  status: AgentRunStatus
  startedAt: string
  endedAt?: string
}

// A minimal draft shape the Story Foundations UI builds from free-text
// answers — main fills in the rest of CodexEntry's bookkeeping fields
// (schemaVersion, timestamps, relationships, history) when it writes these.
export interface FoundationsCodexDraft {
  type: CodexEntryType
  name: string
  summary: string
  status: FactStatus
}

// The full renderer-facing surface, mirrored by preload/index.ts's
// contextBridge.exposeInMainWorld('atlas', ...) call.
export interface AtlasBridge {
  project: {
    open(path: string): Promise<ProjectManifest>
    create(path: string, seed: Partial<ProjectManifest>): Promise<ProjectManifest>
    openSample(): Promise<{ projectRoot: string; manifest: ProjectManifest }>
    list(): Promise<{ projectRoot: string; manifest: ProjectManifest }[]>
    delete(projectRoot: string): Promise<void>
    createFromFoundations(
      title: string,
      genrePrimary: string | undefined,
      entries: FoundationsCodexDraft[]
    ): Promise<{ projectRoot: string; manifest: ProjectManifest }>
  }
  manuscript: {
    tree(): Promise<ManuscriptTree>
  }
  scenes: {
    read(sceneId: string): Promise<SceneReadResult>
    write(sceneId: string, patch: SceneWritePatch): Promise<void>
  }
  codex: {
    list(filter?: CodexListFilter): Promise<CodexEntry[]>
    upsert(entry: CodexEntry): Promise<void>
    delete(entryId: string, entryType: CodexEntryType): Promise<void>
  }
  capabilities: {
    list(): Promise<CapabilityManifest[]>
  }
  agentRuns: {
    start(goal: AgentGoal): Promise<{ runId: string }>
    onStep(runId: string, onStep: (step: AgentStep) => void): () => void
    respondToPermission(runId: string, requestId: string, decision: PermissionDecision): Promise<void>
    cancel(runId: string): Promise<void>
    list(): Promise<AgentRunSummary[]>
    get(runId: string): Promise<AgentRunRecord>
  }
  retrieval: {
    search(query: string, opts?: { kind?: string; limit?: number }): Promise<RetrievalResult[]>
  }
  summaries: {
    getChapter(chapterId: string): Promise<ChapterSummary>
    getScene(sceneId: string): Promise<SceneSummary>
  }
  context: {
    warnings(goal: AgentGoal): Promise<ContextWarning[]>
  }
}
