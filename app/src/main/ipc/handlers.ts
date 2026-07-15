import { app, dialog, ipcMain, type WebContents } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { release } from 'node:os'
import { join } from 'node:path'
import { IpcChannel, type CodexExportFormat, type FoundationsCodexDraft, type ManuscriptExportFormat } from '@shared/ipc'
import { AtlasError } from '@shared/errors'
import { isCloudModel } from '@shared/privacy'
import type { AgentGoal, AgentRole, AgentRunRecord, PermissionDecision } from '@shared/schema/agent'
import type { CapabilityManifest, LifecycleState } from '@shared/schema/capability'
import type { CodexEntry, CodexEntryType, FactStatus } from '@shared/schema/codex'
import type { SceneMeta } from '@shared/schema/manuscript'
import type { DerivedSummaryKind } from '@shared/schema/retrieval'
import type { SessionGoal } from '@shared/schema/session'
import type { EmbeddingProvider } from '@shared/schema/embeddings'
import {
  AgentGoalSchema,
  BackupScheduleSchema,
  CapabilityManifestSchema,
  CodexEntrySchema,
  ProjectManifestSeedSchema,
  SceneWritePatchSchema,
  SessionGoalSchema as SessionGoalValidationSchema
} from '@shared/validation'
import { createCapability, listCapabilities, setLifecycleState, updateCapability } from '../capabilities/registry'
import { listAgentRuns, loadAgentRun } from '../persistence/agentRunStore'
import { deleteCodexEntry, listCodexEntries, upsertCodexEntry } from '../persistence/codexStore'
import { createProjectFromFoundations, slugify } from '../persistence/createProjectFromFoundations'
import { findSceneLocation } from '../persistence/db'
import { readManuscriptTree } from '../persistence/manuscriptStore'
import {
  createProject,
  deleteProject,
  listProjects,
  openProject,
  projectsRootDir,
  sampleProjectRoot,
  updateProjectManifest
} from '../persistence/projectStore'
import { assertWithinProjectsRoot } from './pathGuard'
import { createSnapshot, diffSnapshots, getSnapshot, listSnapshots } from '../persistence/revisionStore'
import { readScene, writeScene } from '../persistence/sceneStore'
import { seedCottonmouthProject } from '../persistence/seedSampleProject'
import { getSessionSummary, logSessionActivity } from '../persistence/sessionStore'
import { getOrGenerateDerivedSummary } from '../persistence/derivedSummaryStore'
import { chapterSummaryExists, getOrGenerateChapterSummary, getOrGenerateSceneSummary } from '../persistence/summaryStore'
import { computeContextWarnings } from '../retrieval/contextWarnings'
import { ensureIndexed, indexedKey, indexText, markIndexed, search } from '../retrieval/search'
import {
  getEmbeddingsStatus,
  getPreferredEmbeddingProvider,
  setPreferredEmbeddingProvider
} from '../retrieval/embeddings/select'
import { getCurrentProjectSession, ProjectSession, setCurrentProjectSession } from '../projectSession'
import { loadCodex, loadManuscript } from '../export/loadProjectData'
import { renderCodex } from '../export/renderCodex'
import { renderManuscript } from '../export/renderManuscript'
import { importManuscriptFromFile } from '../import/importManuscript'
import { createBackup, getSessionRecoveryStatus, listBackups, markProjectSessionOpened, restoreBackup } from '../persistence/backupStore'
import { projectPaths } from '../persistence/paths'
import { clearSecret, hasSecret, setSecret } from '../security/keyVault'
import { getActivePrompt, resetPrompt, setPrompt } from '../persistence/promptStore'
import { getUsageSummary } from '../persistence/usageStore'
import { fetchOpenRouterCatalog } from '../agent/providers/openRouterCatalog'
import {
  buildFeedbackBundle,
  defaultFeedbackFileName,
  getTelemetryEnabled,
  recordEvent,
  sanitizeRunTrace,
  setTelemetryEnabled,
  type SanitizedRunTrace
} from '../telemetry/telemetryStore'

const MANUSCRIPT_EXPORT_FORMATS: ManuscriptExportFormat[] = ['md', 'txt', 'pdf', 'docx', 'epub']
const CODEX_EXPORT_FORMATS: CodexExportFormat[] = ['json', 'codex-md', 'series-bible', 'series-bible-pdf', 'series-bible-epub']

export function registerIpcHandlers(getWebContents: () => WebContents): void {
  ipcMain.handle(IpcChannel.ProjectOpen, async (_evt, path: string) => {
    assertWithinProjectsRoot(path)
    setCurrentProjectSession(await ProjectSession.create(path))
    await markProjectSessionOpened(path)
    return openProject(path)
  })

  ipcMain.handle(IpcChannel.ProjectCreate, async (_evt, path: string, seed) => {
    assertWithinProjectsRoot(path)
    const validatedSeed = ProjectManifestSeedSchema.parse(seed)
    const manifest = await createProject(path, validatedSeed)
    setCurrentProjectSession(await ProjectSession.create(path))
    await markProjectSessionOpened(path)
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
    await markProjectSessionOpened(projectRoot)
    const manifest = await openProject(projectRoot)
    return { projectRoot, manifest }
  })

  ipcMain.handle(IpcChannel.ProjectList, async () => {
    const projects = await listProjects()
    const sampleRoot = sampleProjectRoot()
    return projects.filter((p) => p.projectRoot !== sampleRoot)
  })

  ipcMain.handle(IpcChannel.ProjectDelete, async (_evt, projectRoot: string) => {
    // The one genuinely destructive handler here — recursively removes
    // whatever folder it's given (see deleteProject() below) — so this is
    // the highest-value place for the containment guard to sit.
    assertWithinProjectsRoot(projectRoot)
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
      const projectRoot = join(projectsRootDir(), `${slugify(title)}.atlas`)
      const session = await ProjectSession.create(projectRoot)
      setCurrentProjectSession(session)
      const manifest = await createProjectFromFoundations(projectRoot, session.db, title, genrePrimary, entries)
      await markProjectSessionOpened(projectRoot)
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

        // Phase 7: reindex this scene's real embedding immediately on save
        // instead of waiting for the next lazy ensureIndexed() pass (which
        // only ever runs once per project session) — otherwise a scene
        // edited mid-session would keep returning stale retrieval:search
        // results until the app restarted. markIndexed() records this so
        // that lazy pass doesn't waste a second, possibly-billed real
        // embedding call re-indexing the same scene.
        const embeddingProvider: EmbeddingProvider = getPreferredEmbeddingProvider() ?? 'lm-studio'
        const resolvedModelId = await indexText(session.db, sceneId, 'scene', `${after.meta.title}\n${after.prose}`, embeddingProvider)
        markIndexed(session.db, indexedKey('scene', sceneId, resolvedModelId))
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

  ipcMain.handle(IpcChannel.ExportManuscript, async (_evt, format: ManuscriptExportFormat) => {
    try {
      if (!MANUSCRIPT_EXPORT_FORMATS.includes(format)) throw new Error(`Unknown manuscript export format: ${format}`)

      const session = getCurrentProjectSession()
      const exportsDir = projectPaths(session.projectRoot).exportsDir
      await mkdir(exportsDir, { recursive: true })
      const manuscript = await loadManuscript(session.projectRoot, session.db)
      const fileName = `${safeFileName(manuscript.title)}-manuscript.${extensionForManuscript(format)}`
      const result = await dialog.showSaveDialog({
        defaultPath: join(exportsDir, fileName),
        filters: manuscriptFilters(format)
      })
      if (result.canceled || !result.filePath) return { ok: false, canceled: true }

      const rendered = await renderManuscript(manuscript, format)
      await writeFile(result.filePath, rendered)
      return { ok: true, filePath: result.filePath }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle(IpcChannel.ExportCodex, async (_evt, format: CodexExportFormat) => {
    try {
      if (!CODEX_EXPORT_FORMATS.includes(format)) throw new Error(`Unknown codex export format: ${format}`)

      const session = getCurrentProjectSession()
      const exportsDir = projectPaths(session.projectRoot).exportsDir
      await mkdir(exportsDir, { recursive: true })
      const codex = await loadCodex(session.projectRoot)
      const fileName = `${safeFileName(codex.manifest.title)}-${codexNameForFormat(format)}.${extensionForCodex(format)}`
      const result = await dialog.showSaveDialog({
        defaultPath: join(exportsDir, fileName),
        filters: codexFilters(format)
      })
      if (result.canceled || !result.filePath) return { ok: false, canceled: true }

      const rendered = await renderCodex(codex.entries, codex.manifest, format)
      await writeFile(result.filePath, rendered)
      return { ok: true, filePath: result.filePath }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle(IpcChannel.ImportManuscript, async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Manuscript', extensions: ['md', 'markdown', 'txt', 'docx'] }]
      })
      if (result.canceled || !result.filePaths[0]) return { canceled: true }

      const { projectRoot, manifest, codexCandidates } = await importManuscriptFromFile(result.filePaths[0])
      return { canceled: false, projectRoot, manifest, codexCandidates }
    } catch (err) {
      return { canceled: false, error: String(err) }
    }
  })

  ipcMain.handle(IpcChannel.CapabilitiesList, async () => {
    const session = getCurrentProjectSession()
    return listCapabilities(session.projectRoot)
  })

  ipcMain.handle(IpcChannel.CapabilitiesCreate, async (_evt, manifest: CapabilityManifest) => {
    const validatedManifest = CapabilityManifestSchema.parse(manifest)
    const session = getCurrentProjectSession()
    await createCapability(session.projectRoot, validatedManifest)
  })

  ipcMain.handle(IpcChannel.CapabilitiesUpdate, async (_evt, manifest: CapabilityManifest) => {
    const validatedManifest = CapabilityManifestSchema.parse(manifest)
    const session = getCurrentProjectSession()
    await updateCapability(session.projectRoot, validatedManifest)
  })

  ipcMain.handle(IpcChannel.CapabilitiesSetLifecycleState, async (_evt, id: string, state: LifecycleState) => {
    const session = getCurrentProjectSession()
    await setLifecycleState(session.projectRoot, id, state)
  })

  ipcMain.handle(IpcChannel.PermissionsList, async () => {
    const session = getCurrentProjectSession()
    return session.approvals.listApprovals()
  })

  ipcMain.handle(IpcChannel.PermissionsRevoke, async (_evt, id: string) => {
    const session = getCurrentProjectSession()
    session.approvals.revokeApproval(id)
  })

  ipcMain.handle(IpcChannel.AgentRunStart, async (_evt, goal: AgentGoal) => {
    const validatedGoal = AgentGoalSchema.parse(goal)
    const session = getCurrentProjectSession()

    // Defense-in-depth for the writer's per-scene "local model only" marking
    // (spec §13). The renderer already gates this in AgentRail, but the IPC
    // boundary owns execution, so enforce the invariant here too: a
    // cloud-classified model must never run against a scene the writer flagged
    // local-only, even via a direct bridge call. (The consent *modal* itself
    // stays renderer-side — see the Round 6 deferral note; model calls are
    // simulated, so there's no real transmission to gate main-side yet.)
    if (isCloudModel(validatedGoal.modelRef)) {
      for (const sceneId of validatedGoal.scope.sceneIds ?? []) {
        const scene = await readScene(session.projectRoot, session.db, sceneId).catch(() => null)
        if (scene?.meta.localModelOnly) {
          throw new AtlasError(
            'This scene is marked local-model-only and cannot be sent to a cloud model.',
            'LOCAL_MODEL_ONLY'
          )
        }
      }

      // Phase 6: mirrors the localModelOnly defense-in-depth check above —
      // the renderer already gates cloud consent in AgentRail's
      // authorizeRun(), but the IPC boundary owns execution, so enforce it
      // here too. See main/permissions/cloudConsent.ts.
      if (session.cloudConsent.requireCloudAuth && !session.cloudConsent.hasConsent(validatedGoal.runId)) {
        throw new AtlasError(
          'This run requires cloud-model consent, which was not recorded for this session.',
          'CLOUD_CONSENT_REQUIRED'
        )
      }
    }

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

  ipcMain.handle(IpcChannel.RetrievalSearch, async (_evt, query: string, opts?: { kind?: string; limit?: number }) => {
    const session = getCurrentProjectSession()
    const embeddingProvider: EmbeddingProvider = getPreferredEmbeddingProvider() ?? 'lm-studio'
    await ensureIndexed(session.db, session.projectRoot, embeddingProvider)
    return search(session.db, query, { ...opts, model: embeddingProvider })
  })

  ipcMain.handle(IpcChannel.SummariesGetScene, async (_evt, sceneId: string) => {
    const session = getCurrentProjectSession()
    const { prose } = await readScene(session.projectRoot, session.db, sceneId)
    return getOrGenerateSceneSummary(session.projectRoot, sceneId, prose)
  })

  ipcMain.handle(IpcChannel.SummariesGetChapter, async (_evt, chapterId: string) => {
    const session = getCurrentProjectSession()
    const tree = await readManuscriptTree(session.projectRoot)
    const chapter = tree.books.flatMap((b) => b.parts.flatMap((p) => p.chapters)).find((c) => c.id === chapterId)
    if (!chapter) throw new Error(`Chapter ${chapterId} is not in the project index`)

    const sceneSummaries = await Promise.all(
      chapter.scenes.map(async (scene) => {
        const { prose } = await readScene(session.projectRoot, session.db, scene.id)
        return getOrGenerateSceneSummary(session.projectRoot, scene.id, prose)
      })
    )
    return getOrGenerateChapterSummary(session.projectRoot, chapterId, sceneSummaries)
  })

  ipcMain.handle(IpcChannel.ContextWarnings, async (_evt, goal: AgentGoal) => {
    const session = getCurrentProjectSession()
    const codexEntries = await listCodexEntries(session.projectRoot)

    const sceneId = goal.scope.sceneIds?.[0]
    if (!sceneId) return computeContextWarnings({ codexEntries, hasChapterSummary: false })

    const tree = await readManuscriptTree(session.projectRoot)
    const scenesWithChapter = tree.books.flatMap((b) =>
      b.parts.flatMap((p) => p.chapters.flatMap((c) => c.scenes.map((scene) => ({ scene, chapterId: c.id }))))
    )
    const found = scenesWithChapter.find((s) => s.scene.id === sceneId)

    return computeContextWarnings({
      scene: found?.scene,
      codexEntries,
      hasChapterSummary: found ? chapterSummaryExists(session.projectRoot, found.chapterId) : false
    })
  })

  ipcMain.handle(IpcChannel.SummariesGetDerived, async (_evt, kind: DerivedSummaryKind, subjectId: string) => {
    const session = getCurrentProjectSession()
    return getOrGenerateDerivedSummary(session.projectRoot, kind, subjectId)
  })

  ipcMain.handle(IpcChannel.EmbeddingsStatus, async () => {
    return getEmbeddingsStatus(getPreferredEmbeddingProvider())
  })

  ipcMain.handle(IpcChannel.EmbeddingsSetProvider, async (_evt, provider: EmbeddingProvider) => {
    setPreferredEmbeddingProvider(provider)
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

  ipcMain.handle(IpcChannel.BackupCreate, async (_evt, label?: string) => {
    const session = getCurrentProjectSession()
    return createBackup(session.projectRoot, label)
  })

  ipcMain.handle(IpcChannel.BackupList, async () => {
    const session = getCurrentProjectSession()
    return listBackups(session.projectRoot)
  })

  ipcMain.handle(IpcChannel.BackupRestore, async (_evt, backupId: string) => {
    const session = getCurrentProjectSession()
    return restoreBackup(session.projectRoot, backupId)
  })

  ipcMain.handle(IpcChannel.SessionRecoveryStatus, async () => getSessionRecoveryStatus())

  ipcMain.handle(IpcChannel.SecretsSet, async (_evt, name: string, value: string) => {
    try {
      await setSecret(name, value)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IpcChannel.SecretsHas, async (_evt, name: string) => hasSecret(name))

  ipcMain.handle(IpcChannel.SecretsClear, async (_evt, name: string) => {
    await clearSecret(name)
  })

  // Prompts are global (not project-scoped, no getCurrentProjectSession()
  // dependency) — same simplicity as the secrets.* handlers above.
  ipcMain.handle(IpcChannel.PromptsGet, async (_evt, role: AgentRole) => getActivePrompt(role))

  ipcMain.handle(IpcChannel.PromptsSet, async (_evt, role: AgentRole, text: string) => setPrompt(role, text))

  ipcMain.handle(IpcChannel.PromptsReset, async (_evt, role: AgentRole) => resetPrompt(role))

  ipcMain.handle(IpcChannel.UsageSummary, async () => {
    const session = getCurrentProjectSession()
    return getUsageSummary(session.projectRoot)
  })

  ipcMain.handle(IpcChannel.ModelsCatalog, async () => fetchOpenRouterCatalog())

  // Phase 6: mirrors the writer's cloud-consent decision (made in the
  // renderer's CloudConsentDialog, see AgentRail.tsx's authorizeRun) into
  // the main-process CloudConsentSessionStore so AgentRunStart's guard above
  // can enforce it even for a direct bridge call. No project-session
  // independence concern here (unlike secrets.*) — consent is inherently
  // tied to whichever project session is currently open.
  ipcMain.handle(
    IpcChannel.ConsentGrant,
    async (_evt, decision: 'authorized-once' | 'authorized-session', runId: string) => {
      const session = getCurrentProjectSession()
      if (decision === 'authorized-session') session.cloudConsent.grantSession()
      else if (decision === 'authorized-once') session.cloudConsent.grantOnce(runId)
    }
  )

  ipcMain.handle(IpcChannel.ConsentSetRequireAuth, async (_evt, value: boolean) => {
    const session = getCurrentProjectSession()
    session.cloudConsent.setRequireCloudAuth(value)
  })

  // Phase 9 Track E: local-only telemetry/feedback — see
  // main/telemetry/telemetryStore.ts's module comment for why there's no
  // network call anywhere in this feature. Global (not project-scoped),
  // same simplicity as prompts.*/secrets.* above.
  ipcMain.handle(IpcChannel.TelemetryGetEnabled, async () => getTelemetryEnabled())

  ipcMain.handle(IpcChannel.TelemetrySetEnabled, async (_evt, enabled: boolean) => {
    await setTelemetryEnabled(enabled)
    // Only ever logs the moment telemetry was turned ON — recordEvent()
    // itself checks the opt-in flag, so turning it off never logs anything.
    if (enabled) await recordEvent('telemetry_enabled')
  })

  ipcMain.handle(IpcChannel.TelemetryExportFeedback, async () => {
    try {
      let runTraces: SanitizedRunTrace[] = []
      try {
        const session = getCurrentProjectSession()
        const summaries = listAgentRuns(session.projectRoot, session.db)
        const records = await Promise.all(
          summaries.slice(0, 20).map((s) => loadAgentRun(session.projectRoot, s.runId).catch(() => null))
        )
        runTraces = records.filter((r): r is AgentRunRecord => r !== null).map(sanitizeRunTrace)
      } catch {
        // No project open (or this run's steps failed to load) — the
        // feedback bundle still works, just without run traces.
      }

      const bundle = await buildFeedbackBundle({
        appVersion: app.getVersion(),
        electronVersion: process.versions.electron ?? 'unknown',
        platform: process.platform,
        osRelease: release(),
        telemetryEnabled: await getTelemetryEnabled(),
        runTraces
      })

      const result = await dialog.showSaveDialog({
        defaultPath: join(app.getPath('documents'), defaultFeedbackFileName()),
        filters: [{ name: 'Zip Archive', extensions: ['zip'] }]
      })
      if (result.canceled || !result.filePath) return { ok: false, canceled: true }

      await writeFile(result.filePath, bundle)
      await recordEvent('feedback_bundle_exported')
      return { ok: true, filePath: result.filePath }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  // Round 10/Phase 9: scheduled automatic backups — Settings' "Backups &
  // snapshots" section reads/writes this via the backups.getSchedule/
  // setSchedule bridge; main/index.ts's periodic timer independently reads
  // the manifest itself (it isn't triggered per-IPC-call, same reasoning as
  // embeddings.setProvider's main-process mirroring above).
  ipcMain.handle(IpcChannel.BackupScheduleGet, async () => {
    const session = getCurrentProjectSession()
    const manifest = await openProject(session.projectRoot)
    return manifest.backupSchedule ?? { enabled: false, intervalMinutes: 60 }
  })

  ipcMain.handle(IpcChannel.BackupScheduleSet, async (_evt, schedule: unknown) => {
    const validated = BackupScheduleSchema.parse(schedule)
    const session = getCurrentProjectSession()
    await updateProjectManifest(session.projectRoot, { backupSchedule: validated })
  })
}

function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\s+/g, ' ').trim() || 'Atlas Export'
}

function extensionForManuscript(format: ManuscriptExportFormat): string {
  const extensions: Record<ManuscriptExportFormat, string> = {
    md: 'md',
    txt: 'txt',
    pdf: 'pdf',
    docx: 'docx',
    epub: 'epub'
  }
  return extensions[format]
}

function extensionForCodex(format: CodexExportFormat): string {
  const extensions: Record<CodexExportFormat, string> = {
    json: 'json',
    'codex-md': 'md',
    'series-bible': 'md',
    'series-bible-pdf': 'pdf',
    'series-bible-epub': 'epub'
  }
  return extensions[format]
}

function codexNameForFormat(format: CodexExportFormat): string {
  return format === 'codex-md' ? 'codex' : format
}

function manuscriptFilters(format: ManuscriptExportFormat): Electron.FileFilter[] {
  const filters: Record<ManuscriptExportFormat, Electron.FileFilter> = {
    md: { name: 'Markdown', extensions: ['md'] },
    txt: { name: 'Plain Text', extensions: ['txt'] },
    pdf: { name: 'PDF', extensions: ['pdf'] },
    docx: { name: 'Word Document', extensions: ['docx'] },
    epub: { name: 'EPUB', extensions: ['epub'] }
  }
  return [filters[format]]
}

function codexFilters(format: CodexExportFormat): Electron.FileFilter[] {
  const filters: Record<CodexExportFormat, Electron.FileFilter> = {
    json: { name: 'JSON', extensions: ['json'] },
    'codex-md': { name: 'Markdown', extensions: ['md'] },
    'series-bible': { name: 'Markdown', extensions: ['md'] },
    'series-bible-pdf': { name: 'PDF', extensions: ['pdf'] },
    'series-bible-epub': { name: 'EPUB', extensions: ['epub'] }
  }
  return [filters[format]]
}
