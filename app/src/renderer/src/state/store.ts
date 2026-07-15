import { create } from 'zustand'
import type {
  AgentGoal,
  AgentRole,
  AgentStep,
  CapabilityRecommendationPayload,
  DialogueAlternativePayload,
  EditorialFindingPayload,
  InsertionPayload,
  MetadataProposalPayload,
  ModelRef,
  PermissionRequest,
  SuggestionRef,
  TrackedChangePayload
} from '@shared/schema/agent'
import type { CodexCandidate, FoundationsCodexDraft } from '@shared/ipc'
import type { OpenRouterCatalogEntry } from '@shared/schema/models'
import type { ManuscriptTree, SceneMeta } from '@shared/schema/manuscript'
import type { ProjectManifest, Theme } from '@shared/schema/project'
import type { SessionApproval } from '@shared/schema/capability'
import type { EmbeddingProvider } from '@shared/schema/embeddings'
import { describeProvider, isCloudModel, type PrivacyModelRef } from '@shared/privacy'
import { normalizeError } from '@shared/errors'

// Single source of truth for both validation and the cycle order used by
// toggleTheme below.
const THEMES: Theme[] = ['paper', 'night', 'typewriter']

// manifest.theme comes off disk via JSON.parse, so even though the type
// says Theme, a manifest written by an older build (back when only
// 'paper'/'night' existed) or hand-edited is safest treated as untrusted —
// fall back to 'paper' rather than handing an unrecognized value straight
// to a [data-theme=...] attribute, which would silently resolve to no
// theme block at all.
function normalizeTheme(theme: Theme | undefined): Theme {
  return theme && THEMES.includes(theme) ? theme : 'paper'
}

interface PendingPermission {
  runId: string
  request: PermissionRequest
}

export type CloudConsentDecision = 'authorized-once' | 'authorized-session' | 'cancelled'

export interface PendingCloudConsent {
  providerLabel: string
  warnCloudUnpublished: boolean
  resolve: (decision: CloudConsentDecision) => void
}

export interface PrivacySettings {
  requireCloudAuth: boolean
  warnCloudUnpublished: boolean
}

// Global renderer notification surface. 'error' toasts persist until the
// writer dismisses them (a failed save/open is worth their attention);
// 'info' toasts auto-dismiss after a few seconds. Rendered bottom-right in
// AppShell.
export interface Toast {
  id: string
  kind: 'error' | 'info'
  message: string
}

const INFO_TOAST_TTL_MS = 5000

// Per-agent model assignment shown in Settings and read by AgentRail.
// Phase 6: every role now holds a real ModelRef (provider + modelId +
// viaOpenRouter) instead of a bare display string — defaults to the
// simulator until the writer routes a role to a real OpenRouter/LM Studio
// model in Settings.
export const DEFAULT_AGENT_MODELS: Record<AgentRole, ModelRef> = {
  Generator: { provider: 'simulator', modelId: 'simulator', viaOpenRouter: false },
  'Dev-Editor': { provider: 'simulator', modelId: 'simulator', viaOpenRouter: false },
  'Line-Editor': { provider: 'simulator', modelId: 'simulator', viaOpenRouter: false },
  Dialoguer: { provider: 'simulator', modelId: 'simulator', viaOpenRouter: false },
  'World-Builder': { provider: 'simulator', modelId: 'simulator', viaOpenRouter: false }
}

function allScenes(tree: ManuscriptTree | null): SceneMeta[] {
  return (tree?.books ?? []).flatMap((b) => b.parts.flatMap((p) => p.chapters.flatMap((c) => c.scenes)))
}

// How many non-overlapping times `needle` appears in `haystack` — used by a
// tracked-change's accept path (Codex adversarial-review, Phase 8) to detect
// when a proposed before/after span isn't unique within the scene, since
// String.replace(str, str) would otherwise silently rewrite whichever
// occurrence happens to come first rather than the one the writer reviewed.
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

// Phase 8: what a Refine re-run treats as "the prior output" for a given
// suggestion kind — fed in as scope.selectionText so the re-invoked agent
// role has the thing the writer is actually asking to refine, not the
// original manuscript selection the first run started from. One switch
// arm per SuggestionRef.kind so a new kind can't silently fall through to
// an unhelpful default without a compiler nudge (the `never` arm below).
function extractSuggestionText(suggestion: SuggestionRef): string {
  switch (suggestion.kind) {
    case 'tracked-change':
      return (suggestion.payload as TrackedChangePayload).after
    case 'insertion':
      return (suggestion.payload as InsertionPayload).text
    case 'editorial-finding': {
      const payload = suggestion.payload as EditorialFindingPayload
      return payload.revisionPlan ? `${payload.body}\n\n${payload.revisionPlan}` : payload.body
    }
    case 'dialogue-alternative':
      return (suggestion.payload as DialogueAlternativePayload).original
    case 'metadata-proposal':
      return (suggestion.payload as MetadataProposalPayload).rationale
    case 'codex-addition':
      return (suggestion.payload as { summary: string }).summary
    case 'capability-recommendation':
      return (suggestion.payload as CapabilityRecommendationPayload).rationale
    default: {
      const _exhaustive: never = suggestion.kind
      return String(_exhaustive)
    }
  }
}

interface AtlasState {
  stage: 'landing' | 'onboarding' | 'app'
  projectRoot: string | null
  manifest: ProjectManifest | null
  manuscriptTree: ManuscriptTree | null
  activeSceneId: string | null
  sceneSaveState: 'saved' | 'saving'
  lastSavedAt: string | null
  theme: Theme
  focusMode: boolean
  agentModels: Record<AgentRole, ModelRef>
  modelCatalog: OpenRouterCatalogEntry[]
  lmStudioFallback: boolean
  // Phase 7: which embedding provider retrieval/search should use — LM
  // Studio (default) / OpenRouter (opt-in) / hashing-only. In-memory only,
  // same non-persisted pattern as agentModels/lmStudioFallback above; mirrored
  // into the main process via window.atlas.embeddings.setProvider() so
  // background work not triggered per-call from the renderer (scene-write
  // reindexing, the lazy ensureIndexed() pass) knows the current choice too.
  embeddingProvider: EmbeddingProvider
  advancedMode: boolean
  privacySettings: PrivacySettings
  cloudAuthGrantedThisSession: boolean
  pendingImportCandidates: CodexCandidate[]
  toasts: Toast[]

  pendingPermission: PendingPermission | null
  pendingCloudConsent: PendingCloudConsent | null
  sessionApprovals: SessionApproval[]
  activeSuggestions: SuggestionRef[]
  queuedSuggestions: SuggestionRef[]
  lastAgentSummary: string | null

  // Full trace of the most recent agent run — feeds the routing
  // visualization and context inspection panel with real run data rather
  // than fabricated placeholders. Replaced (not appended across runs) each
  // time a new run starts.
  currentRunGoal: AgentGoal | null
  currentRunSteps: AgentStep[]

  // Bumped whenever a suggestion's acceptance writes new prose to a scene
  // out from under the open editor, so ManuscriptWorkspace knows to re-read
  // it (see setSuggestionState).
  sceneProseVersion: number

  openSampleProject: () => Promise<void>
  openProjectAtPath: (path: string) => Promise<void>
  startNewProject: () => void
  createProjectFromFoundations: (title: string, genrePrimary: string | undefined, entries: FoundationsCodexDraft[]) => Promise<void>
  exitToLanding: () => void
  refreshManuscriptTree: () => Promise<void>
  setActiveScene: (sceneId: string) => void
  setSceneSaveState: (state: 'saved' | 'saving') => void
  setTheme: (theme: Theme) => void
  updateSceneMeta: (sceneId: string, metaPatch: Partial<SceneMeta>) => Promise<void>
  toggleTheme: () => void
  toggleFocusMode: () => void
  setAgentModel: (role: AgentRole, model: ModelRef) => void
  loadModelCatalog: () => Promise<void>
  toggleLmStudioFallback: () => void
  setEmbeddingProvider: (provider: EmbeddingProvider) => void
  toggleAdvancedMode: () => void
  toggleRequireCloudAuth: () => void
  toggleWarnCloudUnpublished: () => void
  requestCloudConsent: (modelRef: PrivacyModelRef) => Promise<CloudConsentDecision>
  resolveCloudConsent: (decision: CloudConsentDecision) => void
  setPendingImportCandidates: (candidates: CodexCandidate[]) => void
  clearPendingImportCandidates: () => void
  startAgentRun: (goal: AgentGoal) => void
  // Phase 9 (Track 4): resumes a run previously ended with the recoverable
  // 'paused' status. Mirrors startAgentRun/agentRuns.start's dispatch
  // plumbing exactly (see AgentRail.tsx's runAgent) — the caller must supply
  // the run's own persisted goal (AgentRunsView.tsx already has it via
  // agentRuns.get()) since a resumed run re-executes the whole role method
  // from the top, not from a mid-flight checkpoint.
  resumeAgentRun: (runId: string, goal: AgentGoal) => void
  handleAgentStep: (runId: string, step: AgentStep) => void
  resolvePermission: (decision: 'approved-once' | 'approved-session' | 'denied') => void
  revokeSessionApproval: (id: string) => void
  setSuggestionState: (id: string, state: SuggestionRef['state']) => Promise<void>
  // Phase 8: the privacy/cloud-consent gating a run must pass before it's
  // dispatched — lifted out of AgentRail.tsx (which used to own this as a
  // local function backed by a local setPrivacyMessage banner) so the
  // Refine loop (refineSuggestion below) can reuse the exact same gating
  // instead of duplicating it. Returns a result rather than touching UI
  // state directly, since callers surface it differently (AgentRail shows
  // an inline banner; refineSuggestion pushes a toast).
  authorizeAgentRun: (goal: AgentGoal) => Promise<{ ok: boolean; message?: string }>
  // Phase 8: closes the "Refine" loop — every suggestion card's follow-up-
  // instruction textarea previously discarded its typed text and just
  // flipped the card to 'refining'. This actually records the instruction,
  // authorizes and dispatches a scoped re-run of the same agent role
  // (userIntent = instruction, selectionText = the original suggestion's own
  // prior output), through the same agentRuns.start/onStep plumbing
  // AgentRail uses for a fresh invocation.
  refineSuggestion: (id: string, instruction: string) => Promise<void>
  pushToast: (kind: Toast['kind'], message: string) => void
  dismissToast: (id: string) => void
}

export const useAtlasStore = create<AtlasState>((set, get) => ({
  stage: 'landing',
  projectRoot: null,
  manifest: null,
  manuscriptTree: null,
  activeSceneId: null,
  sceneSaveState: 'saved',
  lastSavedAt: null,
  theme: 'paper',
  focusMode: false,
  agentModels: { ...DEFAULT_AGENT_MODELS },
  modelCatalog: [],
  lmStudioFallback: true,
  embeddingProvider: 'lm-studio',
  advancedMode: false,
  privacySettings: { requireCloudAuth: true, warnCloudUnpublished: true },
  cloudAuthGrantedThisSession: false,
  pendingImportCandidates: [],
  toasts: [],

  pendingPermission: null,
  pendingCloudConsent: null,
  sessionApprovals: [],
  activeSuggestions: [],
  queuedSuggestions: [],
  lastAgentSummary: null,
  currentRunGoal: null,
  currentRunSteps: [],
  sceneProseVersion: 0,

  openSampleProject: async () => {
   try {
    const { projectRoot, manifest } = await window.atlas.project.openSample()
    // Reset suggestion state from any previously-open project before
    // reseeding — without this, reopening the sample after exiting to
    // Landing appended the same seed suggestions (same ids) a second time,
    // producing literal duplicate React keys, and any leftover suggestions
    // from a different project would incorrectly carry over.
    set({
      projectRoot,
      manifest,
      theme: normalizeTheme(manifest.theme),
      stage: 'app',
      activeSuggestions: [],
      queuedSuggestions: [],
      lastAgentSummary: null,
      cloudAuthGrantedThisSession: false,
      pendingImportCandidates: []
    })
    await get().refreshManuscriptTree()

    const scenes = allScenes(get().manuscriptTree)
    const mostRecentlyEdited = scenes.reduce<SceneMeta | undefined>(
      (latest, scene) => (!latest || scene.updatedAt > latest.updatedAt ? scene : latest),
      undefined
    )
    if (mostRecentlyEdited) set({ activeSceneId: mostRecentlyEdited.id })

    // Story Editor isn't a wired agent yet (only Line Editor runs for real),
    // so this one editorial finding is seeded demo content — the same
    // finding shown in the Phase 1 prototype for this scene — rather than
    // the output of a live run. It goes through the real Accept/Reject/
    // Refine contract like any other suggestion.
    // Same reasoning for these three tracked changes — the exact Line
    // Editor demo content from the Phase 1 prototype, seeded so the default
    // state has "visible tracked changes" per spec §2's Phase 1 acceptance
    // criteria, rather than only appearing after a live run.
    if (scenes.some((s) => s.id === 'chapter-003-scene-002')) {
      set((s) => ({
        activeSuggestions: [
          ...s.activeSuggestions,
          {
            id: 'seed-story-editor-ch3-scene2',
            agentRole: 'Dev-Editor',
            kind: 'editorial-finding',
            targetSceneId: 'chapter-003-scene-002',
            payload: {
              title: 'Scene lacks a clear turn',
              body: 'Ray leaves with the same information — and the same suspicion — he arrived with. Consider giving Tull a small, checkable lie here that Ray can catch later, so this scene plants a payoff.',
              severity: 'Medium'
            },
            provenance: { runId: 'seed-story-editor-ch3-scene2' },
            state: 'pending'
          },
          {
            id: 'seed-line-editor-ch3-scene2-c1',
            agentRole: 'Line-Editor',
            kind: 'tracked-change',
            targetSceneId: 'chapter-003-scene-002',
            payload: {
              category: 'Filter word',
              before: 'Ray noticed that the ice machine was grinding behind Tull.',
              after: 'The ice machine ground behind Tull.'
            },
            provenance: { capabilityId: 'global.tools.line-edit-scan', capabilityVersion: '1.0.0', runId: 'seed-line-editor-ch3-scene2' },
            state: 'pending'
          },
          {
            id: 'seed-line-editor-ch3-scene2-c2',
            agentRole: 'Line-Editor',
            kind: 'tracked-change',
            targetSceneId: 'chapter-003-scene-002',
            payload: {
              category: 'Adverb overuse',
              before: "Tull said it very casually, like he didn't care.",
              after: "Tull said it like he didn't care."
            },
            provenance: { capabilityId: 'global.tools.line-edit-scan', capabilityVersion: '1.0.0', runId: 'seed-line-editor-ch3-scene2' },
            state: 'pending'
          },
          {
            id: 'seed-line-editor-ch3-scene2-c3',
            agentRole: 'Line-Editor',
            kind: 'tracked-change',
            targetSceneId: 'chapter-003-scene-002',
            payload: {
              category: 'Repeated structure',
              before: 'Ray parked the Bronco. Ray sat there a minute. Ray watched the roof shimmer.',
              after: 'Ray parked the Bronco and sat there a minute, watching the roof shimmer.'
            },
            provenance: { capabilityId: 'global.tools.line-edit-scan', capabilityVersion: '1.0.0', runId: 'seed-line-editor-ch3-scene2' },
            state: 'pending'
          }
        ]
      }))
    }
   } catch (err) {
    // A failed open must not strand the writer in a half-initialized 'app'
    // stage with a null manuscript tree — reset back to Landing and surface
    // the reason.
    console.error('[store] openSampleProject failed', err)
    set({ stage: 'landing' })
    get().pushToast('error', normalizeError(err).message)
   }
  },

  openProjectAtPath: async (path) => {
   try {
    const manifest = await window.atlas.project.open(path)
    set({
      projectRoot: path,
      manifest,
      theme: normalizeTheme(manifest.theme),
      stage: 'app',
      activeSuggestions: [],
      queuedSuggestions: [],
      lastAgentSummary: null,
      cloudAuthGrantedThisSession: false,
      pendingImportCandidates: []
    })
    await get().refreshManuscriptTree()
   } catch (err) {
    console.error('[store] openProjectAtPath failed', err)
    set({ stage: 'landing' })
    get().pushToast('error', normalizeError(err).message)
   }
  },

  startNewProject: () => set({ stage: 'onboarding', cloudAuthGrantedThisSession: false }),

  createProjectFromFoundations: async (title, genrePrimary, entries) => {
   try {
    const { projectRoot, manifest } = await window.atlas.project.createFromFoundations(title, genrePrimary, entries)
    set({
      projectRoot,
      manifest,
      theme: normalizeTheme(manifest.theme),
      stage: 'app',
      activeSceneId: null,
      activeSuggestions: [],
      queuedSuggestions: [],
      lastAgentSummary: null,
      cloudAuthGrantedThisSession: false,
      pendingImportCandidates: []
    })
    await get().refreshManuscriptTree()
   } catch (err) {
    // Stay on the onboarding screen (stage is only advanced to 'app' on
    // success) so the writer's foundations input isn't lost — just report.
    console.error('[store] createProjectFromFoundations failed', err)
    get().pushToast('error', normalizeError(err).message)
   }
  },

  exitToLanding: () => set({ stage: 'landing' }),

  refreshManuscriptTree: async () => {
    const tree = await window.atlas.manuscript.tree()
    set({ manuscriptTree: tree })
  },

  setActiveScene: (sceneId) => set({ activeSceneId: sceneId }),

  setSceneSaveState: (state) =>
    set({ sceneSaveState: state, lastSavedAt: state === 'saved' ? new Date().toISOString() : get().lastSavedAt }),

  setTheme: (theme) => set({ theme }),

  // Cycles Paper → Night → Typewriter → Paper — kept for the command
  // palette's single "cycle theme" entry; AppShell's 3-way pill control
  // uses setTheme directly to jump to a specific theme instead.
  toggleTheme: () =>
    set((s) => {
      const currentIndex = THEMES.indexOf(s.theme)
      const nextTheme = THEMES[(currentIndex + 1) % THEMES.length]
      return { theme: nextTheme }
    }),

  // Used by SceneMetadataPanel to persist writer-authored scene-metadata
  // edits (conflictLevel, presentCharacterIds, ...) — same write-then-
  // refresh pattern as prose edits in ManuscriptWorkspace, so the panel
  // doesn't need its own local copy of the tree.
  updateSceneMeta: async (sceneId, metaPatch) => {
    set({ sceneSaveState: 'saving' })
    try {
      await window.atlas.scenes.write(sceneId, { meta: metaPatch })
      await get().refreshManuscriptTree()
      set({ sceneSaveState: 'saved', lastSavedAt: new Date().toISOString() })
    } catch (err) {
      // Don't leave the save indicator stuck on 'saving…' forever — reset it
      // and tell the writer the metadata write failed.
      console.error('[store] updateSceneMeta failed', err)
      set({ sceneSaveState: 'saved' })
      get().pushToast('error', normalizeError(err).message)
    }
  },

  toggleFocusMode: () =>
    set((s) => {
      if (!s.focusMode) return { focusMode: true }

      // Exiting distraction-free mode: flush anything that queued silently
      // while focused (spec §10) into the visible suggestion list.
      const queueCount = s.queuedSuggestions.length
      return {
        focusMode: false,
        activeSuggestions: [...s.activeSuggestions, ...s.queuedSuggestions],
        queuedSuggestions: [],
        lastAgentSummary:
          queueCount > 0
            ? `While you were focused, ${queueCount} suggestion${queueCount === 1 ? '' : 's'} arrived.`
            : s.lastAgentSummary
      }
    }),

  setAgentModel: (role, model) => set((s) => ({ agentModels: { ...s.agentModels, [role]: model } })),

  // Not called automatically anywhere in this store — Settings.tsx calls
  // this in a useEffect on mount, since the catalog is only needed once the
  // model-routing UI is actually visible.
  loadModelCatalog: async () => {
    const catalog = await window.atlas.models.catalog()
    set({ modelCatalog: catalog })
  },

  toggleLmStudioFallback: () => set((s) => ({ lmStudioFallback: !s.lmStudioFallback })),

  setEmbeddingProvider: (provider) => {
    set({ embeddingProvider: provider })
    void window.atlas.embeddings.setProvider(provider)
  },

  toggleAdvancedMode: () => set((s) => ({ advancedMode: !s.advancedMode })),

  toggleRequireCloudAuth: () =>
    set((s) => {
      const next = !s.privacySettings.requireCloudAuth
      // Phase 6: sync to the main-process CloudConsentSessionStore (see
      // main/permissions/cloudConsent.ts) so AgentRunStart's IPC-level guard
      // reflects the writer's actual current setting, not just the
      // renderer-side default it was constructed with. Fire-and-forget, same
      // reasoning as the consent.grant() call in AgentRail.tsx.
      void window.atlas.consent.setRequireAuth(next).catch(() => {})
      return { privacySettings: { ...s.privacySettings, requireCloudAuth: next } }
    }),

  toggleWarnCloudUnpublished: () =>
    set((s) => ({ privacySettings: { ...s.privacySettings, warnCloudUnpublished: !s.privacySettings.warnCloudUnpublished } })),

  requestCloudConsent: (modelRef) =>
    new Promise((resolve) => {
      set({
        pendingCloudConsent: {
          providerLabel: describeProvider(modelRef),
          warnCloudUnpublished: get().privacySettings.warnCloudUnpublished,
          resolve
        }
      })
    }),

  resolveCloudConsent: (decision) => {
    const pending = get().pendingCloudConsent
    if (!pending) return
    pending.resolve(decision)
    set({
      pendingCloudConsent: null,
      cloudAuthGrantedThisSession: decision === 'authorized-session' ? true : get().cloudAuthGrantedThisSession
    })
  },

  setPendingImportCandidates: (candidates) => set({ pendingImportCandidates: candidates }),

  clearPendingImportCandidates: () => set({ pendingImportCandidates: [] }),

  // Phase 8: lifted from AgentRail.tsx's local authorizeRun() so the Refine
  // loop (refineSuggestion below) can reuse the identical privacy/cloud-
  // consent gating instead of duplicating it — same localModelOnly check and
  // same requestCloudConsent + consent.grant() sync AgentRail's "Invoke on
  // scene" flow already relied on, just returning a result instead of
  // writing to a component-local banner state.
  authorizeAgentRun: async (goal) => {
    const targetSceneIds = goal.scope.sceneIds ?? []
    const targetScenes = allScenes(get().manuscriptTree).filter((scene) => targetSceneIds.includes(scene.id))
    const cloudModel = isCloudModel(goal.modelRef)

    if (cloudModel && targetScenes.some((scene) => scene.localModelOnly)) {
      return { ok: false, message: 'This scene is marked local-model-only; switch that agent to a local model or clear the flag.' }
    }

    if (cloudModel && get().privacySettings.requireCloudAuth && !get().cloudAuthGrantedThisSession) {
      const decision = await get().requestCloudConsent(goal.modelRef)
      if (decision === 'cancelled') {
        return { ok: false, message: 'Cloud model run cancelled.' }
      }
      try {
        await window.atlas.consent.grant(decision, goal.runId)
      } catch {
        // Best-effort sync — if it fails, AgentRunStart's own main-side
        // guard is still the accurate source of truth and will reject the
        // run with a clear error rather than silently proceeding.
      }
    }

    return { ok: true }
  },

  refineSuggestion: async (id, instruction) => {
    const suggestion = get().activeSuggestions.find((sg) => sg.id === id)
    if (!suggestion) return

    const runId = crypto.randomUUID()
    const goal: AgentGoal = {
      runId,
      agentRole: suggestion.agentRole,
      modelRef: get().agentModels[suggestion.agentRole],
      userIntent: instruction,
      scope: {
        sceneIds: suggestion.targetSceneId ? [suggestion.targetSceneId] : undefined,
        selectionText: extractSuggestionText(suggestion)
      },
      constraints: {
        maxTurns: 4,
        maxTokens: 6000,
        maxToolCalls: 3,
        maxElapsedMs: 30000,
        allowedCapabilityCategories: ['line-editing']
      },
      lmStudioFallback: get().lmStudioFallback,
      refinesSuggestionId: suggestion.id
    }

    const { ok, message } = await get().authorizeAgentRun(goal)
    if (!ok) {
      get().pushToast('error', message ?? 'Refinement run was not authorized.')
      return
    }

    set((s) => ({
      activeSuggestions: s.activeSuggestions.map((sg) =>
        sg.id === id ? { ...sg, refineInstruction: instruction, state: 'refining' } : sg
      )
    }))

    get().startAgentRun(goal)
    void window.atlas.agentRuns.start(goal)
    window.atlas.agentRuns.onStep(runId, (step) => get().handleAgentStep(runId, step))
  },

  startAgentRun: (goal) => set({ currentRunGoal: goal, currentRunSteps: [] }),

  resumeAgentRun: (runId, goal) => {
    get().startAgentRun(goal)
    void window.atlas.agentRuns.resume(runId)
    window.atlas.agentRuns.onStep(runId, (step) => get().handleAgentStep(runId, step))
  },

  handleAgentStep: (_runId, step) => {
    set((s) => ({ currentRunSteps: [...s.currentRunSteps, step] }))

    if (step.kind === 'permission-request') {
      const request = step.detail as PermissionRequest

      // Spec §13: a session approval only covers the exact named
      // capability, action type, data scope, and destination it was
      // granted for — matching on capabilityId alone would silently widen
      // the grant to unrelated actions/scopes on the same capability.
      const matchingApproval = get().sessionApprovals.find(
        (a) =>
          a.capabilityId === request.capabilityId &&
          a.actionType === request.actionType &&
          a.dataScope === request.dataScope &&
          a.destination === request.destination
      )

      if (matchingApproval && request.decision === 'pending') {
        void window.atlas.agentRuns.respondToPermission(_runId, request.requestId, 'approved-session')
      } else {
        set({ pendingPermission: request.decision === 'pending' ? { runId: _runId, request } : null })
      }
    }
    if (step.kind === 'result') {
      const result = step.detail as { summary: string; proposedManuscriptChanges?: SuggestionRef[] }

      // Spec §10: suggestions arriving during distraction-free mode queue
      // silently and only surface after the writer exits focus mode — no
      // lastAgentSummary update here, or "silently" wouldn't be true.
      if (get().focusMode) {
        set((s) => ({
          queuedSuggestions: [...s.queuedSuggestions, ...(result.proposedManuscriptChanges ?? [])]
        }))
      } else {
        set((s) => ({
          lastAgentSummary: result.summary,
          activeSuggestions: [...s.activeSuggestions, ...(result.proposedManuscriptChanges ?? [])]
        }))
      }
    }
  },

  resolvePermission: (decision) => {
    const pending = get().pendingPermission
    if (!pending) return
    void window.atlas.agentRuns.respondToPermission(pending.runId, pending.request.requestId, decision)

    if (decision === 'approved-session') {
      const { request } = pending
      // PermissionRequest has no separate version field today — the
      // capabilityId strings in this codebase already embed the version as
      // a "@x.y.z" suffix (e.g. "global.tools.line-edit-scan@1.0.0"), so we
      // parse that if present and fall back to the whole capabilityId
      // otherwise, rather than inventing a version the request doesn't carry.
      const atIndex = request.capabilityId.lastIndexOf('@')
      const capabilityVersion = atIndex >= 0 ? request.capabilityId.slice(atIndex + 1) : request.capabilityId

      const approval: SessionApproval = {
        id: crypto.randomUUID(),
        capabilityId: request.capabilityId,
        capabilityVersion,
        actionType: request.actionType,
        dataScope: request.dataScope,
        destination: request.destination,
        grantedAt: new Date().toISOString(),
        expiresAtSessionEnd: true
      }
      set((s) => ({ sessionApprovals: [...s.sessionApprovals, approval] }))
    }

    set({ pendingPermission: null })
  },

  // Fires the main-process revoke (the real SessionApprovalStore backing
  // requestPermission()'s auto-approve check — see permissions/
  // sessionApprovals.ts) and updates local state immediately rather than
  // waiting on a refetch, so the Settings list still redraws right away.
  // The renderer's sessionApprovals array and main's SessionApprovalStore
  // are two views of "the same grant," populated by two separate code paths
  // reacting to the same user action (see resolvePermission below) — a
  // mismatch between them is low-stakes for this prototype.
  revokeSessionApproval: (id) => {
    void window.atlas.permissions.revoke(id)
    set((s) => ({ sessionApprovals: s.sessionApprovals.filter((a) => a.id !== id) }))
  },

  setSuggestionState: async (id, state) => {
    const suggestion = get().activeSuggestions.find((sg) => sg.id === id)

    // Accepting a suggestion that carries literal manuscript text should
    // actually touch the manuscript — otherwise "Accept" is cosmetic and the
    // whole suggestion contract is theater. tracked-change (Line Editor)
    // replaces a before/after span; insertion (Generator continuations)
    // appends the generated text — previously only tracked-change was
    // wired, so accepting a Generator suggestion silently did nothing to
    // the scene. Other kinds (editorial findings, dialogue alternatives,
    // codex additions) are reports/options, not a single literal text to
    // apply automatically.
    try {
    if (state === 'accepted' && suggestion?.targetSceneId) {
      if (suggestion.kind === 'tracked-change') {
        const payload = suggestion.payload as { before: string; after: string }
        const { prose } = await window.atlas.scenes.read(suggestion.targetSceneId)
        const occurrences = countOccurrences(prose, payload.before)
        if (occurrences === 0) {
          // Stale suggestion: the original span is gone (the writer edited it,
          // a concurrent save landed, or it was already accepted). Skipping
          // the write but still flipping the card to 'accepted' would claim a
          // change that never happened, so treat it as a conflict — surface a
          // toast and leave the card pending instead of updating state below.
          get().pushToast('error', 'This edit no longer matches the current text — re-run the agent to refresh the suggestion.')
          return
        }
        if (occurrences > 1) {
          // Codex adversarial-review (Phase 8): String.replace(str, str) only
          // ever rewrites the FIRST match in the whole scene. Phase 8's
          // real Line-Editor path now routinely proposes short, specific
          // spans (a few words) rather than one whole-selection block, so a
          // span repeating elsewhere in the scene is a real, common case —
          // accepting blind could silently edit an earlier identical phrase
          // instead of the one the writer actually reviewed. Bail the same
          // way a stale (zero-match) suggestion does rather than guessing.
          get().pushToast(
            'error',
            'This exact text appears more than once in the scene — edit it manually rather than risk changing the wrong occurrence.'
          )
          return
        }
        const nextProse = prose.replace(payload.before, payload.after)
        await window.atlas.snapshots.create(suggestion.targetSceneId, prose, 'Before suggestion accepted')
        await window.atlas.scenes.write(suggestion.targetSceneId, { prose: nextProse })
        set((s) => ({ sceneProseVersion: s.sceneProseVersion + 1 }))
      } else if (suggestion.kind === 'insertion') {
        const payload = suggestion.payload as { text: string }
        const { prose } = await window.atlas.scenes.read(suggestion.targetSceneId)
        const nextProse = prose.trim().length > 0 ? `${prose}\n\n${payload.text}` : payload.text
        await window.atlas.snapshots.create(suggestion.targetSceneId, prose, 'Before suggestion accepted')
        await window.atlas.scenes.write(suggestion.targetSceneId, { prose: nextProse })
        set((s) => ({ sceneProseVersion: s.sceneProseVersion + 1 }))
      } else if (suggestion.kind === 'metadata-proposal') {
        // Spec Phase 4 (~line 183): the writer must approve before proposed
        // metadata is applied — this only runs on accept. Reuses the same
        // scenes.write({ meta }) call SceneWritePatch already supports (the
        // same IPC channel scenes.write uses for prose, just the `meta`
        // field) and the same snapshot-before-write pattern as the other two
        // branches, then refreshes the tree so SceneMetadataPanel picks up
        // the new values immediately.
        const payload = suggestion.payload as MetadataProposalPayload
        const { prose } = await window.atlas.scenes.read(suggestion.targetSceneId)
        await window.atlas.snapshots.create(suggestion.targetSceneId, prose, 'Before suggestion accepted')
        await window.atlas.scenes.write(suggestion.targetSceneId, { meta: payload.proposedMeta })
        await get().refreshManuscriptTree()
      }
    }

    // capability-recommendation is not scene-scoped (no targetSceneId), so it
    // can't live inside the block above — accepting one installs the draft
    // manifest as a real project-scoped capability via the same
    // `capabilities:create` IPC Library.tsx's "New Capability" form uses.
    // Centralizing this here (rather than in CapabilityRecommendationCard's
    // own Accept button) means the individual Accept button and the
    // per-section "Accept all" batch action both take this same path —
    // otherwise batch-accepting a Recommended Capabilities section would
    // silently flip suggestion state without ever installing anything.
    if (state === 'accepted' && suggestion?.kind === 'capability-recommendation') {
      const payload = suggestion.payload as CapabilityRecommendationPayload
      await window.atlas.capabilities.create(payload.draftManifest)
    }
    } catch (err) {
      // If the manuscript/capability write behind an "Accept" fails, bail
      // BEFORE flipping the card to 'accepted' below — otherwise the UI would
      // claim the change landed when it didn't. The card stays pending so the
      // writer can retry.
      console.error('[store] setSuggestionState write failed', err)
      get().pushToast('error', normalizeError(err).message)
      return
    }

    // Drafts sharing a draftGroupId (the opt-in "Generate Alternatives" mode
    // — see AgentGoal.generateAlternatives) are mutually exclusive: only one
    // continuation should actually land in the manuscript. Accepting one
    // auto-rejects its still-pending siblings so the writer doesn't have to
    // clean up the rest of the group by hand.
    const draftGroupId =
      state === 'accepted' && suggestion?.kind === 'insertion'
        ? (suggestion.payload as InsertionPayload).draftGroupId
        : undefined

    set((s) => ({
      activeSuggestions: s.activeSuggestions.map((sg) => {
        if (sg.id === id) return { ...sg, state }
        if (
          draftGroupId &&
          sg.kind === 'insertion' &&
          sg.state === 'pending' &&
          (sg.payload as InsertionPayload).draftGroupId === draftGroupId
        ) {
          return { ...sg, state: 'rejected' }
        }
        return sg
      })
    }))
  },

  pushToast: (kind, message) => {
    const id = crypto.randomUUID()
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }))
    // 'error' toasts persist until dismissed (a failed save is worth the
    // writer's attention); 'info' toasts self-clear so they don't pile up.
    if (kind === 'info') {
      setTimeout(() => get().dismissToast(id), INFO_TOAST_TTL_MS)
    }
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))
