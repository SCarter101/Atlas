import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannel } from '@shared/ipc'
import type { AtlasBridge } from '@shared/ipc'
import type { AgentStep, PermissionDecision } from '@shared/schema/agent'

const atlasBridge: AtlasBridge = {
  project: {
    open: (path) => ipcRenderer.invoke(IpcChannel.ProjectOpen, path),
    create: (path, seed) => ipcRenderer.invoke(IpcChannel.ProjectCreate, path, seed),
    openSample: () => ipcRenderer.invoke(IpcChannel.ProjectOpenSample),
    list: () => ipcRenderer.invoke(IpcChannel.ProjectList),
    delete: (projectRoot) => ipcRenderer.invoke(IpcChannel.ProjectDelete, projectRoot),
    createFromFoundations: (title, genrePrimary, entries) =>
      ipcRenderer.invoke(IpcChannel.ProjectCreateFromFoundations, title, genrePrimary, entries)
  },
  manuscript: {
    tree: () => ipcRenderer.invoke(IpcChannel.ManuscriptTree)
  },
  scenes: {
    read: (sceneId) => ipcRenderer.invoke(IpcChannel.SceneRead, sceneId),
    write: (sceneId, patch) => ipcRenderer.invoke(IpcChannel.SceneWrite, sceneId, patch)
  },
  codex: {
    list: (filter) => ipcRenderer.invoke(IpcChannel.CodexList, filter),
    upsert: (entry) => ipcRenderer.invoke(IpcChannel.CodexUpsert, entry),
    delete: (entryId, entryType) => ipcRenderer.invoke(IpcChannel.CodexDelete, entryId, entryType)
  },
  export: {
    manuscript: (format) => ipcRenderer.invoke(IpcChannel.ExportManuscript, format),
    codex: (format) => ipcRenderer.invoke(IpcChannel.ExportCodex, format)
  },
  import: {
    manuscript: () => ipcRenderer.invoke(IpcChannel.ImportManuscript)
  },
  capabilities: {
    list: () => ipcRenderer.invoke(IpcChannel.CapabilitiesList),
    create: (manifest) => ipcRenderer.invoke(IpcChannel.CapabilitiesCreate, manifest),
    update: (manifest) => ipcRenderer.invoke(IpcChannel.CapabilitiesUpdate, manifest),
    setLifecycleState: (id, state) => ipcRenderer.invoke(IpcChannel.CapabilitiesSetLifecycleState, id, state)
  },
  permissions: {
    list: () => ipcRenderer.invoke(IpcChannel.PermissionsList),
    revoke: (id) => ipcRenderer.invoke(IpcChannel.PermissionsRevoke, id)
  },
  agentRuns: {
    start: (goal) => ipcRenderer.invoke(IpcChannel.AgentRunStart, goal),
    onStep: (runId, onStep) => {
      const listener = (_evt: Electron.IpcRendererEvent, payload: { runId: string; step: AgentStep }): void => {
        if (payload.runId === runId) onStep(payload.step)
      }
      ipcRenderer.on(IpcChannel.AgentRunStep, listener)
      return () => ipcRenderer.removeListener(IpcChannel.AgentRunStep, listener)
    },
    respondToPermission: (runId: string, requestId: string, decision: PermissionDecision) =>
      ipcRenderer.invoke(IpcChannel.AgentRunRespondToPermission, runId, requestId, decision),
    cancel: (runId: string) => ipcRenderer.invoke(IpcChannel.AgentRunCancel, runId),
    list: () => ipcRenderer.invoke(IpcChannel.AgentRunsList),
    get: (runId) => ipcRenderer.invoke(IpcChannel.AgentRunGet, runId)
  },
  retrieval: {
    search: (query, opts) => ipcRenderer.invoke(IpcChannel.RetrievalSearch, query, opts)
  },
  summaries: {
    getChapter: (chapterId) => ipcRenderer.invoke(IpcChannel.SummariesGetChapter, chapterId),
    getScene: (sceneId) => ipcRenderer.invoke(IpcChannel.SummariesGetScene, sceneId),
    getDerived: (kind, subjectId) => ipcRenderer.invoke(IpcChannel.SummariesGetDerived, kind, subjectId)
  },
  context: {
    warnings: (goal) => ipcRenderer.invoke(IpcChannel.ContextWarnings, goal)
  },
  embeddings: {
    status: () => ipcRenderer.invoke(IpcChannel.EmbeddingsStatus),
    setProvider: (provider) => ipcRenderer.invoke(IpcChannel.EmbeddingsSetProvider, provider)
  },
  sessions: {
    logActivity: (wordsDelta) => ipcRenderer.invoke(IpcChannel.SessionsLogActivity, wordsDelta),
    summary: () => ipcRenderer.invoke(IpcChannel.SessionsSummary),
    setGoal: (goal) => ipcRenderer.invoke(IpcChannel.SessionsSetGoal, goal)
  },
  snapshots: {
    list: (sceneId) => ipcRenderer.invoke(IpcChannel.SnapshotsList, sceneId),
    create: (sceneId, prose, label) => ipcRenderer.invoke(IpcChannel.SnapshotsCreate, sceneId, prose, label),
    diff: (sceneId, snapshotIdA, snapshotIdB) => ipcRenderer.invoke(IpcChannel.SnapshotsDiff, sceneId, snapshotIdA, snapshotIdB)
  },
  backups: {
    create: (label) => ipcRenderer.invoke(IpcChannel.BackupCreate, label),
    list: () => ipcRenderer.invoke(IpcChannel.BackupList),
    restore: (backupId) => ipcRenderer.invoke(IpcChannel.BackupRestore, backupId),
    recoveryStatus: () => ipcRenderer.invoke(IpcChannel.SessionRecoveryStatus),
    getSchedule: () => ipcRenderer.invoke(IpcChannel.BackupScheduleGet),
    setSchedule: (schedule) => ipcRenderer.invoke(IpcChannel.BackupScheduleSet, schedule)
  },
  secrets: {
    set: (name, value) => ipcRenderer.invoke(IpcChannel.SecretsSet, name, value),
    has: (name) => ipcRenderer.invoke(IpcChannel.SecretsHas, name),
    clear: (name) => ipcRenderer.invoke(IpcChannel.SecretsClear, name)
  },
  prompts: {
    get: (role) => ipcRenderer.invoke(IpcChannel.PromptsGet, role),
    set: (role, text) => ipcRenderer.invoke(IpcChannel.PromptsSet, role, text),
    reset: (role) => ipcRenderer.invoke(IpcChannel.PromptsReset, role)
  },
  usage: {
    summary: () => ipcRenderer.invoke(IpcChannel.UsageSummary)
  },
  models: {
    catalog: () => ipcRenderer.invoke(IpcChannel.ModelsCatalog)
  },
  consent: {
    grant: (decision, runId) => ipcRenderer.invoke(IpcChannel.ConsentGrant, decision, runId),
    setRequireAuth: (value) => ipcRenderer.invoke(IpcChannel.ConsentSetRequireAuth, value)
  },
  telemetry: {
    getEnabled: () => ipcRenderer.invoke(IpcChannel.TelemetryGetEnabled),
    setEnabled: (enabled) => ipcRenderer.invoke(IpcChannel.TelemetrySetEnabled, enabled),
    exportFeedback: () => ipcRenderer.invoke(IpcChannel.TelemetryExportFeedback)
  }
}

contextBridge.exposeInMainWorld('atlas', atlasBridge)
