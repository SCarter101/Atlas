import { app, ipcMain, type WebContents } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { IpcChannel, type FoundationsCodexDraft } from '@shared/ipc'
import type { AgentGoal, PermissionDecision } from '@shared/schema/agent'
import type { CodexEntry, CodexEntryType, FactStatus } from '@shared/schema/codex'
import type { SceneMeta } from '@shared/schema/manuscript'
import type { SessionGoal } from '@shared/schema/session'
import {
  AgentGoalSchema,
  CodexEntrySchema,
  ProjectManifestSeedSchema,
  SceneWritePatchSchema,
  SessionGoalSchema as SessionGoalValidationSchema
} from '@shared/validation'
import { listAgentRuns, loadAgentRun } from '../persistence/agentRunStore'
import { listCapabilityManifests } from '../persistence/capabilityStore'
import { deleteCodexEntry, listCodexEntries, upsertCodexEntry } from '../persistence/codexStore'
import { createProjectFromFoundations, slugify } from '../persistence/createProjectFromFoundations'
import { findSceneLocation } from '../persistence/db'
import { readManuscriptTree } from '../persistence/manuscriptStore'
import { createProject, deleteProject, listProjects, openProject, sampleProjectRoot, updateProjectManifest } from '../persistence/projectStore'
import { createSnapshot, diffSnapshots, getSnapshot, listSnapshots } from '../persistence/revisionStore'
import { readScene, writeScene } from '../persistence/sceneStore'
import { seedCottonmouthProject } from '../persistence/seedSampleProject'
import { getSessionSummary, logSessionActivity } from '../persistence/sessionStore'
import { getCurrentProjectSession, ProjectSession, setCurrentProjectSession } from '../projectSession'

export function registerIpcHandlers(getWebContents: () => WebContents): void {
  ipcMain.handle(IpcChannel.ProjectOpen, async (_evt, path: string) => {
    setCurrentProjectSession(await ProjectSession.create(path))
    return openProject(path)
  })

  ipcMain.handle(IpcChannel.ProjectCreate, async (_evt, path: string, seed) => {
    const validatedSeed = ProjectManifestSeedSchema.parse(seed)
    const manifest = await createProject(path, validatedSeed)
    setCurrentProjectSession(await ProjectSession.create(path))
    return manifest
  })

  ipcMain.handle(IpcChannel.ProjectOpenSample, async () => {
    const projectRoot = sampleProjectRoot()
    const alreadySeeded = existsSync(join(projectRoot, 'project.json'))
    const session = await ProjectSession.create(projectRoot)
    setCurrentProjectSession(session)
    if (!alreadySeeded) {
      await seedCottonmouthProject(projectRoot, session.db)
    }
    const manifest = await openProject(projectRoot)
    return { projectRoot, manifest }
  })

  ipcMain.handle(IpcChannel.ProjectList, async () => {
    const projects = await listProjects()
    const sampleRoot = sampleProjectRoot()
    return projects.filter((p) => p.projectRoot !== sampleRoot)
  })

  ipcMain.handle(IpcChannel.ProjectDelete, async (_evt, projectRoot: string) => {
    try {
      const session = getCurrentProjectSession()
      if (session.projectRoot === projectRoot) {
        // Deleting the currently-open project's files out from under its own
        // session is fine — we intentionally don't tear down any in-memory
        // session state here; the renderer simply won't have that project
        // open anymore once it navigates elsewhere (e.g. back to Landing).
      }
    } catch {
      // No project is open yet — nothing to compare against.
    }
    await deleteProject(projectRoot)
  })

  ipcMain.handle(
    IpcChannel.ProjectCreateFromFoundations,
    async (_evt, title: string, genrePrimary: string | undefined, entries: FoundationsCodexDraft[]) => {
      const projectRoot = join(app.getPath('documents'), 'Atlas Projects', `${slugify(title)}.atlas`)
      const session = await ProjectSession.create(projectRoot)
      setCurrentProjectSession(session)
      const manifest = await createProjectFromFoundations(projectRoot, session.db, title, genrePrimary, entries)
      return { projectRoot, manifest }
    }
  )

  ipcMain.handle(IpcChannel.ManuscriptTree, async () => {
    const session = getCurrentProjectSession()
    return readManuscriptTree(session.projectRoot)
  })

  ipcMain.handle(IpcChannel.SceneRead, async (_evt, sceneId: string) => {
    const session = getCurrentProjectSession()
    return readScene(session.projectRoot, session.db, sceneId)
  })

  ipcMain.handle(
    IpcChannel.SceneWrite,
    async (_evt, sceneId: string, patch: { meta?: Partial<SceneMeta>; prose?: string }) => {
      const validatedPatch = SceneWritePatchSchema.parse(patch)
      const session = getCurrentProjectSession()
      const location = findSceneLocation(session.db, sceneId)
      if (!location) throw new Error(`Scene ${sceneId} is not in the project index`)

      // Word-count delta for session tracking: read the scene's word count
      // before and after the write (sceneStore.ts isn't owned by this wave,
      // so we don't touch it — readScene(), already imported above, gives
      // us the same before/after numbers without needing to modify it).
      const before =
        validatedPatch.prose !== undefined
          ? await readScene(session.projectRoot, session.db, sceneId).catch(() => null)
          : null

      await writeScene(session.projectRoot, session.db, sceneId, validatedPatch, location.relativeDir, location.slug)

      if (validatedPatch.prose !== undefined) {
        const after = await readScene(session.projectRoot, session.db, sceneId)
        const delta = after.meta.wordCount - (before?.meta.wordCount ?? 0)
        if (delta !== 0) await logSessionActivity(session.projectRoot, delta)
      }
    }
  )

  ipcMain.handle(
    IpcChannel.CodexList,
    async (_evt, filter?: { type?: CodexEntryType; status?: FactStatus }) => {
      const session = getCurrentProjectSession()
      return listCodexEntries(session.projectRoot, filter)
    }
  )

  ipcMain.handle(IpcChannel.CodexUpsert, async (_evt, entry: CodexEntry) => {
    const validatedEntry = CodexEntrySchema.parse(entry)
    const session = getCurrentProjectSession()
    await upsertCodexEntry(session.projectRoot, session.db, validatedEntry)
  })

  ipcMain.handle(IpcChannel.CodexDelete, async (_evt, entryId: string, entryType: CodexEntryType) => {
    const session = getCurrentProjectSession()
    await deleteCodexEntry(session.projectRoot, session.db, { id: entryId, type: entryType })
  })

  ipcMain.handle(IpcChannel.CapabilitiesList, async () => {
    const session = getCurrentProjectSession()
    return listCapabilityManifests(session.projectRoot)
  })

  ipcMain.handle(IpcChannel.AgentRunStart, async (_evt, goal: AgentGoal) => {
    const validatedGoal = AgentGoalSchema.parse(goal)
    const session = getCurrentProjectSession()
    const { runId } = session.agentRuns.start(validatedGoal)
    // Forward every step to the renderer over a fixed channel; preload
    // filters by runId when re-exposing this as a per-run subscription.
    session.agentRuns.onStep(runId, (step) => {
      getWebContents().send(IpcChannel.AgentRunStep, { runId, step })
    })
    return { runId }
  })

  ipcMain.handle(
    IpcChannel.AgentRunRespondToPermission,
    async (_evt, runId: string, requestId: string, decision: PermissionDecision) => {
      const session = getCurrentProjectSession()
      session.agentRuns.respondToPermission(runId, requestId, decision)
    }
  )

  ipcMain.handle(IpcChannel.AgentRunCancel, async (_evt, runId: string) => {
    const session = getCurrentProjectSession()
    session.agentRuns.cancel(runId)
  })

  ipcMain.handle(IpcChannel.AgentRunsList, async () => {
    const session = getCurrentProjectSession()
    return listAgentRuns(session.projectRoot, session.db)
  })

  ipcMain.handle(IpcChannel.AgentRunGet, async (_evt, runId: string) => {
    const session = getCurrentProjectSession()
    return loadAgentRun(session.projectRoot, runId)
  })

  ipcMain.handle(IpcChannel.SessionsLogActivity, async (_evt, wordsDelta: number) => {
    const session = getCurrentProjectSession()
    await logSessionActivity(session.projectRoot, wordsDelta)
  })

  ipcMain.handle(IpcChannel.SessionsSummary, async () => {
    const session = getCurrentProjectSession()
    const manifest = await openProject(session.projectRoot)
    return getSessionSummary(session.projectRoot, manifest.sessionGoal)
  })

  ipcMain.handle(IpcChannel.SessionsSetGoal, async (_evt, goal: SessionGoal) => {
    const validatedGoal = SessionGoalValidationSchema.parse(goal)
    const session = getCurrentProjectSession()
    await updateProjectManifest(session.projectRoot, { sessionGoal: validatedGoal })
  })

  ipcMain.handle(IpcChannel.SnapshotsList, async (_evt, sceneId: string) => {
    const session = getCurrentProjectSession()
    return listSnapshots(session.projectRoot, sceneId)
  })

  ipcMain.handle(IpcChannel.SnapshotsCreate, async (_evt, sceneId: string, prose: string, label?: string) => {
    const session = getCurrentProjectSession()
    const { meta } = await readScene(session.projectRoot, session.db, sceneId)
    return createSnapshot(session.projectRoot, sceneId, prose, meta, label)
  })

  // 'current' is a sentinel id (not a real snapshotId) meaning "the scene's
  // live prose on disk right now" — lets the renderer diff a saved snapshot
  // against the current draft without a separate IPC shape.
  ipcMain.handle(IpcChannel.SnapshotsDiff, async (_evt, sceneId: string, snapshotIdA: string, snapshotIdB: string) => {
    const session = getCurrentProjectSession()
    const [proseA, proseB] = await Promise.all([
      snapshotIdA === 'current'
        ? readScene(session.projectRoot, session.db, sceneId).then((r) => r.prose)
        : getSnapshot(session.projectRoot, sceneId, snapshotIdA).then((s) => s.prose),
      snapshotIdB === 'current'
        ? readScene(session.projectRoot, session.db, sceneId).then((r) => r.prose)
        : getSnapshot(session.projectRoot, sceneId, snapshotIdB).then((s) => s.prose)
    ])
    return diffSnapshots(proseA, proseB)
  })
}
