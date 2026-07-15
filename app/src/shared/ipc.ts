import type { AgentGoal, AgentRole, AgentRunRecord, AgentRunStatus, AgentStep, PermissionDecision } from './schema/agent'
import type { BackupMeta } from './schema/backup'
import type {
  CapabilityManifest,
  CapabilityScope,
  CapabilityTestResult,
  CapabilityUsageMetric,
  LifecycleState,
  SessionApproval
} from './schema/capability'
import type { CodexEntry, CodexEntryType, FactStatus } from './schema/codex'
import type { CodexCandidate } from './schema/import'
import type { OpenRouterCatalogEntry } from './schema/models'
import type { OutlineFramework } from './schema/outline'
import type { ProjectManifest } from './schema/project'
import type { ManuscriptTree, SceneMeta } from './schema/manuscript'
import type { ChapterSummary, ContextWarning, DerivedSummary, DerivedSummaryKind, RetrievalResult, SceneSummary } from './schema/retrieval'
import type { SessionGoal, SessionSummary } from './schema/session'
import type { SnapshotDiffRun } from './schema/revision'
import type { UsageSummary } from './schema/usage'
import type { EmbeddingProvider, EmbeddingsStatus } from './schema/embeddings'

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
  ExportManuscript: 'export:manuscript',
  ExportCodex: 'export:codex',
  ImportManuscript: 'import:manuscript',
  CapabilitiesList: 'capabilities:list',
  CapabilitiesCreate: 'capabilities:create',
  CapabilitiesUpdate: 'capabilities:update',
  CapabilitiesSetLifecycleState: 'capabilities:set-lifecycle-state',
  // Phase 9 Track 3 (§14 capability lifecycle completion) — see
  // main/capabilities/registry.ts's rollbackCapability/promoteCapability/
  // forkCapability/testCapability/getCapabilityUsageMetrics.
  // compareCapabilityVersions is deliberately NOT here: it's a pure diff of
  // two manifests the renderer already has in hand (shared/capabilityDiff.ts),
  // no IPC round-trip needed.
  CapabilitiesRollback: 'capabilities:rollback',
  CapabilitiesPromote: 'capabilities:promote',
  CapabilitiesFork: 'capabilities:fork',
  CapabilitiesTest: 'capabilities:test',
  CapabilitiesUsageMetrics: 'capabilities:usage-metrics',
  PermissionsList: 'permissions:list',
  PermissionsRevoke: 'permissions:revoke',
  AgentRunStart: 'agent-run:start',
  AgentRunStep: 'agent-run:step',
  AgentRunRespondToPermission: 'agent-run:respond-to-permission',
  AgentRunCancel: 'agent-run:cancel',
  AgentRunsList: 'agent-runs:list',
  AgentRunGet: 'agent-runs:get',
  RetrievalSearch: 'retrieval:search',
  SummariesGetChapter: 'summaries:get-chapter',
  SummariesGetScene: 'summaries:get-scene',
  ContextWarnings: 'context:warnings',
  SummariesGetDerived: 'summaries:get-derived',
  EmbeddingsStatus: 'embeddings:status',
  EmbeddingsSetProvider: 'embeddings:set-provider',
  SessionsLogActivity: 'sessions:log-activity',
  SessionsSummary: 'sessions:summary',
  SessionsSetGoal: 'sessions:set-goal',
  SnapshotsList: 'snapshots:list',
  SnapshotsCreate: 'snapshots:create',
  SnapshotsDiff: 'snapshots:diff',
  BackupCreate: 'backup:create',
  BackupList: 'backup:list',
  BackupRestore: 'backup:restore',
  SessionRecoveryStatus: 'session:recovery-status',
  SecretsSet: 'secrets:set',
  SecretsHas: 'secrets:has',
  SecretsClear: 'secrets:clear',
  PromptsGet: 'prompts:get',
  PromptsSet: 'prompts:set',
  PromptsReset: 'prompts:reset',
  UsageSummary: 'usage:summary',
  ModelsCatalog: 'models:catalog',
  ConsentGrant: 'consent:grant',
  ConsentSetRequireAuth: 'consent:set-require-auth',
  // Phase 9 Track E: local-only crash reporting / opt-in local telemetry /
  // in-app feedback channel — see main/telemetry/telemetryStore.ts. No
  // external service exists to send any of this to; TelemetryExportFeedback
  // composes everything into a zip the writer saves and shares manually.
  TelemetryGetEnabled: 'telemetry:get-enabled',
  TelemetrySetEnabled: 'telemetry:set-enabled',
  TelemetryExportFeedback: 'telemetry:export-feedback',
  // Round 10/Phase 9: scheduled automatic backups — see
  // main/persistence/backupStore.ts's maybeRunScheduledBackup() and the
  // timer in main/index.ts's whenReady() that calls it.
  BackupScheduleGet: 'backup:schedule-get',
  BackupScheduleSet: 'backup:schedule-set',
  // Outline frameworks (spec §11) — see main/persistence/outlineStore.ts.
  // One active OutlineFramework per project; get returns null when none has
  // been created yet.
  OutlineGetFramework: 'outline:get-framework',
  OutlineSetFramework: 'outline:set-framework'
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

export type ManuscriptExportFormat = 'md' | 'txt' | 'pdf' | 'docx' | 'epub'
export type CodexExportFormat = 'json' | 'codex-md' | 'series-bible' | 'series-bible-pdf' | 'series-bible-epub'

export interface ExportResult {
  ok: boolean
  filePath?: string
  canceled?: boolean
  error?: string
}

export type { CodexCandidate }

export interface ImportManuscriptResult {
  canceled: boolean
  projectRoot?: string
  manifest?: ProjectManifest
  codexCandidates?: CodexCandidate[]
  error?: string
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
  export: {
    manuscript(format: ManuscriptExportFormat): Promise<ExportResult>
    codex(format: CodexExportFormat): Promise<ExportResult>
  }
  import: {
    manuscript(): Promise<ImportManuscriptResult>
  }
  capabilities: {
    list(): Promise<CapabilityManifest[]>
    create(manifest: CapabilityManifest): Promise<void>
    update(manifest: CapabilityManifest): Promise<void>
    setLifecycleState(id: string, state: LifecycleState): Promise<void>
    // Phase 9 Track 3: restores a capability to an earlier history entry's
    // snapshot (main-side rejects clearly if that entry predates snapshot
    // support rather than crashing).
    rollback(id: string, versionId: string): Promise<void>
    // Moves a capability's manifest file to a different scope's directory.
    promote(id: string, targetScope: CapabilityScope): Promise<void>
    // Copies a capability under a new id into targetScope as a fresh draft;
    // does not touch the original.
    fork(id: string, newId: string, targetScope: CapabilityScope): Promise<void>
    // Runs sampleInput through the manifest's real SandboxedTool if one is
    // registered, else falls back to a structural shape check — see
    // CapabilityTestResult's doc comment for what `mode` means.
    test(manifest: CapabilityManifest, sampleInput: unknown): Promise<CapabilityTestResult>
    // ESTIMATE ONLY — see CapabilityUsageMetric's doc comment.
    usageMetrics(): Promise<CapabilityUsageMetric[]>
  }
  permissions: {
    list(): Promise<SessionApproval[]>
    revoke(id: string): Promise<void>
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
    getDerived(kind: DerivedSummaryKind, subjectId: string): Promise<DerivedSummary>
  }
  context: {
    warnings(goal: AgentGoal): Promise<ContextWarning[]>
  }
  embeddings: {
    status(): Promise<EmbeddingsStatus>
    // Mirrors the writer's Settings choice into the main process (see
    // main/retrieval/embeddings/select.ts's setPreferredEmbeddingProvider),
    // the same "renderer decides, main process is told" pattern
    // consent.setRequireAuth already uses — main-process code that isn't
    // triggered per-call from the renderer (the scene-write reindexing
    // hook, retrieval:search's lazy indexing pass) needs to know this
    // without an extra argument threaded through every unrelated call.
    setProvider(provider: EmbeddingProvider): Promise<void>
  }
  sessions: {
    logActivity(wordsDelta: number): Promise<void>
    summary(): Promise<SessionSummary>
    setGoal(goal: SessionGoal): Promise<void>
  }
  snapshots: {
    list(sceneId: string): Promise<{ snapshotId: string; label?: string; createdAt: string }[]>
    create(sceneId: string, prose: string, label?: string): Promise<{ snapshotId: string }>
    diff(sceneId: string, snapshotIdA: string, snapshotIdB: string): Promise<SnapshotDiffRun[]>
  }
  backups: {
    create(label?: string): Promise<BackupMeta>
    list(): Promise<BackupMeta[]>
    restore(backupId: string): Promise<{ restoredProjectRoot: string }>
    recoveryStatus(): Promise<{ recoveryAvailable: boolean }>
    // Round 10/Phase 9: read/write ProjectManifest.backupSchedule, backing
    // Settings' "Backups & snapshots" enable-toggle + interval control.
    getSchedule(): Promise<NonNullable<ProjectManifest['backupSchedule']>>
    setSchedule(schedule: NonNullable<ProjectManifest['backupSchedule']>): Promise<void>
  }
  secrets: {
    set(name: string, value: string): Promise<{ ok: boolean; error?: string }>
    has(name: string): Promise<boolean>
    clear(name: string): Promise<void>
  }
  prompts: {
    get(role: AgentRole): Promise<{ text: string; version: string }>
    set(role: AgentRole, text: string): Promise<{ version: string }>
    reset(role: AgentRole): Promise<{ text: string; version: string }>
  }
  usage: {
    summary(): Promise<UsageSummary>
  }
  models: {
    catalog(): Promise<OpenRouterCatalogEntry[]>
  }
  // Phase 6: main-side cloud-consent tracking (see
  // main/permissions/cloudConsent.ts). The consent *dialog* itself stays
  // renderer-side (CloudConsentDialog / store.ts's requestCloudConsent) —
  // this bridge just mirrors the writer's decision into the main process so
  // the AgentRunStart IPC handler can enforce it even for a run started via
  // a direct bridge call that bypassed the renderer's own gate.
  consent: {
    grant(decision: 'authorized-once' | 'authorized-session', runId: string): Promise<void>
    setRequireAuth(value: boolean): Promise<void>
  }
  // Phase 9 Track E: see main/telemetry/telemetryStore.ts. `getEnabled`/
  // `setEnabled` control the opt-in local event log only (never anything
  // transmitted); `exportFeedback` takes no renderer-supplied payload since
  // it composes everything (crash log, opt-in event log, sanitized recent
  // agent-run traces, app/OS version info) main-side and writes it via
  // dialog.showSaveDialog, reusing the existing ExportResult shape.
  telemetry: {
    getEnabled(): Promise<boolean>
    setEnabled(enabled: boolean): Promise<void>
    exportFeedback(): Promise<ExportResult>
  }
  // Outline frameworks (spec §11) — see main/persistence/outlineStore.ts /
  // shared/outlineLogic.ts. getFramework returns null before the writer has
  // picked a template or started a custom outline.
  outline: {
    getFramework(): Promise<OutlineFramework | null>
    setFramework(framework: OutlineFramework): Promise<void>
  }
}
