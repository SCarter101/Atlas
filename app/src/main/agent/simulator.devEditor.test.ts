import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentGoal, AgentStep, EditorialFindingPayload, PermissionRequest, SuggestionRef, ToolCall } from '@shared/schema/agent'
import type { CodexEntry } from '@shared/schema/codex'

// See registry.test.ts — 'electron' resolves to a path string outside a
// running Electron process, so app.getPath('userData') (used by
// main/capabilities/registry.ts's globalCapabilitiesDir()) is mocked here.
let userDataDir = ''
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return userDataDir
      throw new Error(`unexpected app.getPath(${name}) in test`)
    }
  }
}))

// Phase 8: the real-branch tests below route through OpenRouterAdapter,
// which reads its key via main/security/keyVault.ts's getSecret() — same
// mocking convention simulator.fallback.test.ts already established.
const getSecretMock = vi.fn()
vi.mock('../security/keyVault', () => ({
  getSecret: (name: string) => getSecretMock(name)
}))

const { installSeedCapabilities } = await import('../capabilities/seedTools')
const { openIndexDb } = await import('../persistence/db')
const { upsertCodexEntry } = await import('../persistence/codexStore')
const { setPreferredEmbeddingProvider } = await import('../retrieval/embeddings/select')
const { AgentRunManager } = await import('./simulator')
const { waitForResultStep } = await import('./simulator.testUtils')

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'

describe('AgentRunManager — Dev-Editor real Codex contradiction check', () => {
  let userDataRoot: string
  let projectRoot: string
  let db: Awaited<ReturnType<typeof openIndexDb>>

  beforeEach(async () => {
    userDataRoot = mkdtempSync(join(tmpdir(), 'atlas-userdata-'))
    userDataDir = userDataRoot
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-deveditor-'))
    db = await openIndexDb(projectRoot)
    await installSeedCapabilities()
    // Phase 7: force the network-free hashing embedding adapter — see
    // simulator.budget.test.ts for the fuller rationale.
    setPreferredEmbeddingProvider('hashing')
  })

  afterEach(() => {
    setPreferredEmbeddingProvider(undefined)
    rmSync(userDataRoot, { recursive: true, force: true })
    rmSync(projectRoot, { recursive: true, force: true })
  })

  function makeGoal(): AgentGoal {
    return {
      runId: 'run-dev-editor-1',
      agentRole: 'Dev-Editor',
      modelRef: { provider: 'anthropic', modelId: 'claude-opus-4', viaOpenRouter: false },
      userIntent: 'Send selected text to Story Editor',
      scope: { sceneIds: ['scene-002'], selectionText: 'Ray watched the door.' },
      constraints: {
        maxTurns: 4,
        maxTokens: 4000,
        maxToolCalls: 3,
        maxElapsedMs: 30000,
        allowedCapabilityCategories: ['structural-analysis']
      }
    }
  }

  function codexEntry(partial: Partial<CodexEntry> & Pick<CodexEntry, 'id' | 'name'>): CodexEntry {
    const now = new Date().toISOString()
    return {
      schemaVersion: 1,
      type: 'character',
      status: 'canon',
      body: {},
      isPrivate: false,
      localModelOnly: false,
      locked: false,
      source: 'author',
      relationships: [],
      manuscriptLinks: [],
      createdAt: now,
      updatedAt: now,
      history: [],
      ...partial
    }
  }

  it('folds a real Codex contradiction count into the tool-call output and result when contradictions exist', async () => {
    await upsertCodexEntry(projectRoot, db, codexEntry({ id: 'ray', name: 'Ray', relationships: [{ id: 'r1', targetEntryId: 'tull', kind: 'contradicts' }] }))
    await upsertCodexEntry(projectRoot, db, codexEntry({ id: 'tull', name: 'Tull' }))

    const manager = new AgentRunManager(projectRoot, db)
    const steps: AgentStep[] = []
    const goal = makeGoal()

    manager.start(goal)
    manager.onStep(goal.runId, (step) => steps.push(step))

    const request = steps.find((s) => s.kind === 'permission-request')!.detail as PermissionRequest
    manager.respondToPermission(goal.runId, request.requestId, 'approved-once')
    await waitForResultStep(steps)

    const toolCallStep = steps.find((s) => s.kind === 'tool-call')
    const output = (toolCallStep!.detail as ToolCall).output as { codexContradictionCheck?: { summary: string } }
    expect(output.codexContradictionCheck?.summary).toContain('contradiction')

    const resultStep = steps.find((s) => s.kind === 'result')
    const result = resultStep!.detail as { summary: string; warnings?: string[] }
    expect(result.summary).toContain('contradiction')
    expect(result.warnings?.some((w) => w.includes('contradiction'))).toBe(true)
  })

  it('still completes normally with no contradiction note when the Codex has none', async () => {
    await upsertCodexEntry(projectRoot, db, codexEntry({ id: 'ray', name: 'Ray' }))

    const manager = new AgentRunManager(projectRoot, db)
    const steps: AgentStep[] = []
    const goal = makeGoal()

    manager.start(goal)
    manager.onStep(goal.runId, (step) => steps.push(step))

    const request = steps.find((s) => s.kind === 'permission-request')!.detail as PermissionRequest
    manager.respondToPermission(goal.runId, request.requestId, 'approved-once')
    await waitForResultStep(steps)

    const toolCallStep = steps.find((s) => s.kind === 'tool-call')
    const output = (toolCallStep!.detail as ToolCall).output
    expect(Array.isArray(output)).toBe(true)

    const resultStep = steps.find((s) => s.kind === 'result')
    expect(resultStep).toBeDefined()
    const result = resultStep!.detail as { summary: string }
    expect(result.summary).not.toContain('contradiction')
  })
})

// Phase 8 §7.2: real structured JSON findings. Follows
// simulator.fallback.test.ts's convention of stubbing global fetch to
// exercise the real OpenRouterAdapter request/response shape (rather than
// mocking the whole adapter module), so these tests also double as coverage
// that responseFormat is actually sent on the wire.
describe('AgentRunManager — Dev-Editor real structured JSON findings (Phase 8)', () => {
  let userDataRoot: string
  let projectRoot: string
  let db: Awaited<ReturnType<typeof openIndexDb>>

  beforeEach(async () => {
    userDataRoot = mkdtempSync(join(tmpdir(), 'atlas-userdata-'))
    userDataDir = userDataRoot
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-deveditor-real-'))
    db = await openIndexDb(projectRoot)
    await installSeedCapabilities()
    setPreferredEmbeddingProvider('hashing')
    getSecretMock.mockReset()
    getSecretMock.mockResolvedValue('sk-or-test-key')
  })

  afterEach(() => {
    setPreferredEmbeddingProvider(undefined)
    vi.unstubAllGlobals()
    rmSync(userDataRoot, { recursive: true, force: true })
    rmSync(projectRoot, { recursive: true, force: true })
  })

  function makeRealGoal(overrides: Partial<AgentGoal> = {}): AgentGoal {
    return {
      runId: 'run-dev-editor-real-1',
      agentRole: 'Dev-Editor',
      modelRef: { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-5', viaOpenRouter: true },
      userIntent: 'Send selected text to Story Editor',
      scope: { sceneIds: ['scene-002'], selectionText: 'Ray watched the door.' },
      constraints: {
        maxTurns: 4,
        maxTokens: 4000,
        maxToolCalls: 3,
        maxElapsedMs: 30000,
        allowedCapabilityCategories: ['structural-analysis']
      },
      ...overrides
    }
  }

  async function runToCompletion(manager: InstanceType<typeof AgentRunManager>, goal: AgentGoal): Promise<AgentStep[]> {
    const steps: AgentStep[] = []
    manager.start(goal)
    manager.onStep(goal.runId, (step) => steps.push(step))

    const request = steps.find((s) => s.kind === 'permission-request')!.detail as PermissionRequest
    manager.respondToPermission(goal.runId, request.requestId, 'approved-once')
    await waitForResultStep(steps)
    return steps
  }

  function findings(steps: AgentStep[]): SuggestionRef[] {
    const resultStep = steps.find((s) => s.kind === 'result')!
    const changes = (resultStep.detail as { proposedManuscriptChanges?: SuggestionRef[] }).proposedManuscriptChanges ?? []
    return changes.filter((s) => s.kind === 'editorial-finding')
  }

  function stubChatResponse(content: string): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn((url: string) => {
      if (url === OPENROUTER_CHAT_URL) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content } }],
              usage: { prompt_tokens: 40, completion_tokens: 60, cost: 0.001 }
            }),
            { status: 200 }
          )
        )
      }
      throw new Error(`unexpected fetch to ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  const WELL_FORMED_FINDINGS_JSON = JSON.stringify({
    findings: [
      {
        issueCategory: 'continuity',
        title: 'Timeline slip',
        body: "Ray reacts as though the storm has already passed, but the prior scene ended mid-storm.",
        severity: 'high',
        revisionPlan: "Adjust Ray's reference to the storm so it matches the prior scene's timeline, or add a transition beat.",
        craftConceptIds: ['causality']
      },
      {
        issueCategory: 'stakes',
        title: 'Unclear stakes at the door',
        body: 'It is not clear what Ray loses if he fails to reach the door in time.',
        severity: 'medium',
        revisionPlan: 'State explicitly what happens if Ray is too late — a concrete consequence, not just tension.'
      }
    ]
  })

  it('emits one editorial-finding per parsed finding, with issueCategory/revisionPlan populated, when the adapter returns well-formed JSON', async () => {
    const fetchMock = stubChatResponse(WELL_FORMED_FINDINGS_JSON)

    const manager = new AgentRunManager(projectRoot, db)
    const goal = makeRealGoal()
    const steps = await runToCompletion(manager, goal)

    const structuralFindings = findings(steps)
    expect(structuralFindings).toHaveLength(2)

    const [first, second] = structuralFindings
    const firstPayload = first.payload as EditorialFindingPayload
    expect(firstPayload.issueCategory).toBe('continuity')
    expect(firstPayload.title).toBe('Timeline slip')
    expect(firstPayload.severity).toBe('high')
    expect(firstPayload.revisionPlan).toContain('timeline')
    expect(firstPayload.craftConceptIds).toEqual(['causality'])
    expect(first.provenance.runId).toBe(goal.runId)

    const secondPayload = second.payload as EditorialFindingPayload
    expect(secondPayload.issueCategory).toBe('stakes')
    expect(secondPayload.revisionPlan).toContain('consequence')
    // No craftConceptIds supplied for this one — falls back to the
    // issueCategory -> CRAFT_CONCEPTS mapping (stakes -> stakes).
    expect(secondPayload.craftConceptIds).toEqual(['stakes'])

    // Confirm response_format was actually sent on the wire, and that the
    // JSON-mode instructions were folded into the user message too
    // (belt-and-suspenders, per openRouterAdapter.ts's buildMessages).
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    const requestBody = JSON.parse(requestInit.body as string)
    expect(requestBody.response_format).toEqual({ type: 'json_object' })
    expect(requestBody.messages[requestBody.messages.length - 1].content).toContain('issueCategory')
  })

  it('threads goal.refinesSuggestionId onto every real finding\'s provenance when present', async () => {
    stubChatResponse(WELL_FORMED_FINDINGS_JSON)

    const manager = new AgentRunManager(projectRoot, db)
    const goal = makeRealGoal({ runId: 'run-dev-editor-refine-1', refinesSuggestionId: 'original-suggestion-1' })
    const steps = await runToCompletion(manager, goal)

    const structuralFindings = findings(steps)
    expect(structuralFindings).toHaveLength(2)
    for (const s of structuralFindings) {
      expect(s.provenance.refinesSuggestionId).toBe('original-suggestion-1')
    }
  })

  it('falls back to the simulateStructuralFindings() template when the real adapter returns non-JSON prose', async () => {
    stubChatResponse('Sure — here are some general thoughts on your scene, but not in any particular structured format.')

    const manager = new AgentRunManager(projectRoot, db)
    const goal = makeRealGoal({ runId: 'run-dev-editor-malformed-1' })
    const steps = await runToCompletion(manager, goal)

    const structuralFindings = findings(steps)
    expect(structuralFindings).toHaveLength(1)
    const payload = structuralFindings[0].payload as EditorialFindingPayload
    // The template path never sets issueCategory/revisionPlan — that's the
    // signal this fell through to simulateStructuralFindings(), not a
    // real-but-oddly-shaped parse.
    expect(payload.issueCategory).toBeUndefined()
    expect(payload.revisionPlan).toBeUndefined()
    // Deterministic for this selection text (no dialogue markers): see
    // simulateStructuralFindings()'s hasDialogue check.
    expect(payload.title).toBe('No dialogue in this passage')
  })

  it('falls back to the simulateStructuralFindings() template when the real adapter returns valid JSON with no usable findings', async () => {
    stubChatResponse(JSON.stringify({ findings: [] }))

    const manager = new AgentRunManager(projectRoot, db)
    const goal = makeRealGoal({ runId: 'run-dev-editor-empty-1' })
    const steps = await runToCompletion(manager, goal)

    const structuralFindings = findings(steps)
    expect(structuralFindings).toHaveLength(1)
    const payload = structuralFindings[0].payload as EditorialFindingPayload
    expect(payload.issueCategory).toBeUndefined()
  })

  it('still produces the old simulated single-finding template behavior unchanged via the simulator adapter', async () => {
    const manager = new AgentRunManager(projectRoot, db)
    const goal = makeRealGoal({
      runId: 'run-dev-editor-simulated-1',
      modelRef: { provider: 'anthropic', modelId: 'claude-opus-4', viaOpenRouter: false }
    })
    const steps = await runToCompletion(manager, goal)

    const structuralFindings = findings(steps)
    expect(structuralFindings).toHaveLength(1)
    const payload = structuralFindings[0].payload as EditorialFindingPayload
    expect(payload.issueCategory).toBeUndefined()
    expect(payload.revisionPlan).toBeUndefined()
  })
})
