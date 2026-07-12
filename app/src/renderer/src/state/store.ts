import { create } from 'zustand'
import type { AgentGoal, AgentRole, AgentStep, PermissionRequest, SuggestionRef } from '@shared/schema/agent'
import type { FoundationsCodexDraft } from '@shared/ipc'
import type { ManuscriptTree, SceneMeta } from '@shared/schema/manuscript'
import type { ProjectManifest, Theme } from '@shared/schema/project'
import type { SessionApproval } from '@shared/schema/capability'

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

// Per-agent model assignment shown in Settings and read by AgentRail — a
// Phase 2 "mockup" per spec §15 (no real OpenRouter routing behind it yet).
export const DEFAULT_AGENT_MODELS: Record<AgentRole, string> = {
  Generator: 'Claude Opus 4',
  'Dev-Editor': 'Claude Opus 4',
  'Line-Editor': 'GPT-4.1',
  Dialoguer: 'Claude Sonnet 4',
  'World-Builder': 'Gemini 1.5 Pro'
}

function allScenes(tree: ManuscriptTree | null): SceneMeta[] {
  return (tree?.books ?? []).flatMap((b) => b.parts.flatMap((p) => p.chapters.flatMap((c) => c.scenes)))
}

interface AtlasState {
  stage: 'landing' | 'onboarding' | 'app'
  projectRoot: string | null
  manifest: ProjectManifest | null
  manuscriptTree: ManuscriptTree | null
  activeSceneId: string | null
  sceneSaveState: 'saved' | 'saving'
  theme: Theme
  focusMode: boolean
  agentModels: Record<AgentRole, string>
  lmStudioFallback: boolean
  advancedMode: boolean

  pendingPermission: PendingPermission | null
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
  toggleTheme: () => void
  toggleFocusMode: () => void
  setAgentModel: (role: AgentRole, model: string) => void
  toggleLmStudioFallback: () => void
  toggleAdvancedMode: () => void
  startAgentRun: (goal: AgentGoal) => void
  handleAgentStep: (runId: string, step: AgentStep) => void
  resolvePermission: (decision: 'approved-once' | 'approved-session' | 'denied') => void
  revokeSessionApproval: (id: string) => void
  setSuggestionState: (id: string, state: SuggestionRef['state']) => Promise<void>
}

export const useAtlasStore = create<AtlasState>((set, get) => ({
  stage: 'landing',
  projectRoot: null,
  manifest: null,
  manuscriptTree: null,
  activeSceneId: null,
  sceneSaveState: 'saved',
  theme: 'paper',
  focusMode: false,
  agentModels: { ...DEFAULT_AGENT_MODELS },
  lmStudioFallback: true,
  advancedMode: false,

  pendingPermission: null,
  sessionApprovals: [],
  activeSuggestions: [],
  queuedSuggestions: [],
  lastAgentSummary: null,
  currentRunGoal: null,
  currentRunSteps: [],
  sceneProseVersion: 0,

  openSampleProject: async () => {
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
      lastAgentSummary: null
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
  },

  openProjectAtPath: async (path) => {
    const manifest = await window.atlas.project.open(path)
    set({
      projectRoot: path,
      manifest,
      theme: normalizeTheme(manifest.theme),
      stage: 'app',
      activeSuggestions: [],
      queuedSuggestions: [],
      lastAgentSummary: null
    })
    await get().refreshManuscriptTree()
  },

  startNewProject: () => set({ stage: 'onboarding' }),

  createProjectFromFoundations: async (title, genrePrimary, entries) => {
    const { projectRoot, manifest } = await window.atlas.project.createFromFoundations(title, genrePrimary, entries)
    set({
      projectRoot,
      manifest,
      theme: normalizeTheme(manifest.theme),
      stage: 'app',
      activeSceneId: null,
      activeSuggestions: [],
      queuedSuggestions: [],
      lastAgentSummary: null
    })
    await get().refreshManuscriptTree()
  },

  exitToLanding: () => set({ stage: 'landing' }),

  refreshManuscriptTree: async () => {
    const tree = await window.atlas.manuscript.tree()
    set({ manuscriptTree: tree })
  },

  setActiveScene: (sceneId) => set({ activeSceneId: sceneId }),

  setSceneSaveState: (state) => set({ sceneSaveState: state }),

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

  toggleLmStudioFallback: () => set((s) => ({ lmStudioFallback: !s.lmStudioFallback })),

  toggleAdvancedMode: () => set((s) => ({ advancedMode: !s.advancedMode })),

  startAgentRun: (goal) => set({ currentRunGoal: goal, currentRunSteps: [] }),

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
    if (state === 'accepted' && suggestion?.targetSceneId) {
      if (suggestion.kind === 'tracked-change') {
        const payload = suggestion.payload as { before: string; after: string }
        const { prose } = await window.atlas.scenes.read(suggestion.targetSceneId)
        if (prose.includes(payload.before)) {
          const nextProse = prose.replace(payload.before, payload.after)
          await window.atlas.snapshots.create(suggestion.targetSceneId, prose, 'Before suggestion accepted')
          await window.atlas.scenes.write(suggestion.targetSceneId, { prose: nextProse })
          set((s) => ({ sceneProseVersion: s.sceneProseVersion + 1 }))
        }
      } else if (suggestion.kind === 'insertion') {
        const payload = suggestion.payload as { text: string }
        const { prose } = await window.atlas.scenes.read(suggestion.targetSceneId)
        const nextProse = prose.trim().length > 0 ? `${prose}\n\n${payload.text}` : payload.text
        await window.atlas.snapshots.create(suggestion.targetSceneId, prose, 'Before suggestion accepted')
        await window.atlas.scenes.write(suggestion.targetSceneId, { prose: nextProse })
        set((s) => ({ sceneProseVersion: s.sceneProseVersion + 1 }))
      }
    }

    set((s) => ({
      activeSuggestions: s.activeSuggestions.map((sg) => (sg.id === id ? { ...sg, state } : sg))
    }))
  }
}))
