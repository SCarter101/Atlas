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
  capabilities: {
    list: () => ipcRenderer.invoke(IpcChannel.CapabilitiesList)
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
    getScene: (sceneId) => ipcRenderer.invoke(IpcChannel.SummariesGetScene, sceneId)
  },
  context: {
    warnings: (goal) => ipcRenderer.invoke(IpcChannel.ContextWarnings, goal)
  }
}

contextBridge.exposeInMainWorld('atlas', atlasBridge)
