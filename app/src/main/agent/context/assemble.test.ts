import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentGoal } from '@shared/schema/agent'
import type { CodexEntry } from '@shared/schema/codex'

// Chapter-summary generation (previousChapterSummaryItem -> getOrGenerate
// SceneSummary/ChapterSummary) tries a real model call (LM Studio, then
// OpenRouter) before falling back to its extractive heuristic — same
// mocking convention persistence/summaryStore.test.ts and
// agent/simulator.fallback.test.ts already use, so this test's chapter
// summaries are deterministic heuristic text rather than depending on
// whatever local LM Studio instance may or may not actually be running on
// the machine executing this suite.
const getSecretMock = vi.fn()
vi.mock('../../security/keyVault', () => ({
  getSecret: (name: string) => getSecretMock(name)
}))

const { assembleContext } = await import('./assemble')
const { openIndexDb } = await import('../../persistence/db')
const { writeBookMeta, writeChapterMeta, writePartMeta } = await import('../../persistence/manuscriptStore')
const { writeScene } = await import('../../persistence/sceneStore')
const { upsertCodexEntry } = await import('../../persistence/codexStore')
const { setPreferredEmbeddingProvider } = await import('../../retrieval/embeddings/select')
const { cleanupTestDir } = await import('../simulator.testUtils')

const LM_STUDIO_CHAT_URL = 'http://localhost:1234/v1/chat/completions'

function alwaysFailFetchMock(): ReturnType<typeof vi.fn> {
  return vi.fn((url: string) => {
    if (url === LM_STUDIO_CHAT_URL) return Promise.reject(new Error('ECONNREFUSED'))
    throw new Error(`unexpected fetch to ${url}`)
  })
}

function makeCodexEntry(overrides: Partial<CodexEntry>): CodexEntry {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    id: 'entry-1',
    type: 'object',
    name: 'Entry',
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
    ...overrides
  }
}

function makeGoal(overrides: Partial<AgentGoal> = {}): AgentGoal {
  return {
    runId: 'run-assemble-1',
    agentRole: 'Generator',
    modelRef: { provider: 'anthropic', modelId: 'gpt-4.1', viaOpenRouter: false },
    userIntent: 'Continue the confrontation scene about Marcus and the letter',
    scope: { sceneIds: ['scene-2'], selectionText: 'Elena confronted Marcus about the letter.' },
    constraints: {
      maxTurns: 4,
      maxTokens: 4000,
      maxToolCalls: 3,
      maxElapsedMs: 30000,
      allowedCapabilityCategories: ['generation']
    },
    ...overrides
  }
}

describe('assembleContext (Phase 7)', () => {
  let projectRoot: string
  let db: Awaited<ReturnType<typeof openIndexDb>>

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-assemble-test-'))
    db = await openIndexDb(projectRoot)
    getSecretMock.mockReset()
    getSecretMock.mockResolvedValue(null) // OpenRouter has no key -> falls through immediately
    vi.stubGlobal('fetch', alwaysFailFetchMock())
    setPreferredEmbeddingProvider('hashing')

    // Two-chapter manuscript: chapter-1/scene-1 (earlier), chapter-2/scene-2
    // (later) — lets the spoiler-gating and previous-chapter-summary
    // behavior both be exercised against a real reading order.
    await writeBookMeta(projectRoot, { id: 'book-1', projectId: '', title: 'Book One', order: 0 })
    await writePartMeta(projectRoot, 'book-1', { id: 'part-1', bookId: 'book-1', title: 'Part One', order: 0 })
    await writeChapterMeta(projectRoot, 'book-1', 'part-1', {
      id: 'chapter-1',
      partId: 'part-1',
      title: 'Chapter One',
      order: 0,
      summary: '',
      sceneIds: ['scene-1']
    })
    await writeChapterMeta(projectRoot, 'book-1', 'part-1', {
      id: 'chapter-2',
      partId: 'part-1',
      title: 'Chapter Two',
      order: 1,
      summary: '',
      sceneIds: ['scene-2']
    })
    await writeScene(
      projectRoot,
      db,
      'scene-1',
      {
        meta: { schemaVersion: 2, id: 'scene-1', chapterId: 'chapter-1', order: 0, title: 'Scene One', status: 'drafting' },
        prose: 'Ray walked the levee road at dawn. He thought about Dale. The water was low.'
      },
      'book-1/part-1/chapter-1',
      'scene-1'
    )
    await writeScene(
      projectRoot,
      db,
      'scene-2',
      {
        meta: {
          schemaVersion: 2,
          id: 'scene-2',
          chapterId: 'chapter-2',
          order: 0,
          title: 'Scene Two',
          status: 'drafting',
          povCharacterId: 'char-elena'
        },
        prose: 'Elena confronted Marcus in the boathouse.'
      },
      'book-1/part-1/chapter-2',
      'scene-2'
    )

    await upsertCodexEntry(
      projectRoot,
      db,
      makeCodexEntry({
        id: 'char-elena',
        type: 'character',
        name: 'Elena',
        voiceProfile: { vocabulary: 'blunt, plain', rhythm: 'short bursts' }
      })
    )
    await upsertCodexEntry(
      projectRoot,
      db,
      makeCodexEntry({
        id: 'rule-curfew',
        type: 'world-rule',
        name: 'Levee curfew',
        locked: true,
        body: { summary: 'No one crosses the levee after dark.' }
      })
    )
    await upsertCodexEntry(
      projectRoot,
      db,
      makeCodexEntry({
        id: 'spoiler-1',
        type: 'object',
        name: 'The Buried Letter',
        spoilerRevealSceneId: 'scene-2',
        body: { summary: "A hidden letter reveals Marcus's betrayal." }
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    setPreferredEmbeddingProvider(undefined)
    cleanupTestDir(projectRoot)
  })

  it('packs sections in spec §9 priority order and includes the previous chapter summary + relevant Codex entries for a later scene', async () => {
    const goal = makeGoal({ scope: { sceneIds: ['scene-2'], selectionText: 'Elena confronted Marcus about the letter.' } })
    const assembled = await assembleContext(projectRoot, db, goal)

    const classesInOrder = assembled.sections.map((s) => s.class)
    // Priority order is enforced by construction order, not sorted after the
    // fact — assert the relative order for classes that actually produced a
    // section this run (voice-profile and locked-world-rule always do; the
    // exact index of chapter-summary/scene-outline shifts if either is
    // absent, so this checks relative order rather than fixed indices).
    const indexOf = (cls: (typeof classesInOrder)[number]): number => classesInOrder.indexOf(cls)
    expect(indexOf('chapter-summary')).toBeGreaterThanOrEqual(0)
    expect(indexOf('scene-outline')).toBeGreaterThan(indexOf('chapter-summary'))
    expect(indexOf('voice-profile')).toBeGreaterThan(indexOf('scene-outline'))
    expect(indexOf('locked-world-rule')).toBeGreaterThan(indexOf('voice-profile'))
    expect(indexOf('recent-excerpt')).toBeGreaterThan(indexOf('locked-world-rule'))

    // Exit criterion 1: chapter summaries + Codex entries are actually
    // visible in the assembled context.
    const chapterSummarySection = assembled.sections.find((s) => s.class === 'chapter-summary')
    expect(chapterSummarySection?.included).toBe(true)
    expect(assembled.contextText).toContain('Previous chapter summary')
    expect(assembled.contextText).toContain('Ray walked the levee road at dawn')

    const codexSections = assembled.sections.filter((s) => s.class === 'codex-entry')
    expect(codexSections.some((s) => s.label.includes('The Buried Letter') && s.included)).toBe(true)
    expect(assembled.contextText).toContain('The Buried Letter')

    const lockedRuleSection = assembled.sections.find((s) => s.class === 'locked-world-rule')
    expect(lockedRuleSection?.included).toBe(true)
    expect(assembled.contextText).toContain('Levee curfew')

    const voiceSection = assembled.sections.find((s) => s.class === 'voice-profile')
    expect(voiceSection?.included).toBe(true)
    expect(assembled.contextText).toContain('Voice profile')
  })

  it('excludes a spoiler-gated Codex entry for an earlier scene, with a spoiler-filtered reason (exit criterion 2)', async () => {
    const goal = makeGoal({ scope: { sceneIds: ['scene-1'], selectionText: 'Ray thought about the letter and Marcus.' } })
    const assembled = await assembleContext(projectRoot, db, goal)

    const spoilerSection = assembled.sections.find((s) => s.class === 'codex-entry' && s.label.includes('The Buried Letter'))
    expect(spoilerSection).toBeDefined()
    expect(spoilerSection?.included).toBe(false)
    expect(spoilerSection?.excludedReason).toBe('spoiler-filtered for current scene')
    expect(assembled.contextText).not.toContain("hidden letter reveals Marcus's betrayal")

    // scene-1 is the first chapter's only scene — there's no earlier chapter
    // to summarize.
    expect(assembled.sections.some((s) => s.class === 'chapter-summary')).toBe(false)
  })

  it('includes the spoiler-gated entry once the scope scene is at or after its reveal scene', async () => {
    const goal = makeGoal({ scope: { sceneIds: ['scene-2'], selectionText: 'Elena confronted Marcus about the letter.' } })
    const assembled = await assembleContext(projectRoot, db, goal)

    const spoilerSection = assembled.sections.find((s) => s.class === 'codex-entry' && s.label.includes('The Buried Letter'))
    expect(spoilerSection?.included).toBe(true)
  })

  it('excludes lower-priority sections with an over-token-budget reason when the token budget is too small to fit them', async () => {
    const goal = makeGoal({
      scope: { sceneIds: ['scene-2'], selectionText: 'Elena confronted Marcus about the letter.' },
      constraints: {
        maxTurns: 4,
        maxTokens: 0,
        maxToolCalls: 3,
        maxElapsedMs: 30000,
        allowedCapabilityCategories: ['generation']
      }
    })
    const assembled = await assembleContext(projectRoot, db, goal)

    expect(assembled.tokenBudget).toBe(0)
    expect(assembled.contextText).toBe('')

    const budgetExcluded = assembled.sections.filter((s) => s.excludedReason === 'over token budget')
    expect(budgetExcluded.length).toBeGreaterThan(0)
    expect(assembled.sections.every((s) => s.included === false)).toBe(true)
  })

  it('wraps the World Builder interview override text as a single recent-excerpt section, skipping full retrieval', async () => {
    const goal = makeGoal({ scope: { sceneIds: undefined, selectionText: undefined }, agentRole: 'World-Builder' })
    const assembled = await assembleContext(projectRoot, db, goal, {
      overrideText: 'Genre: fantasy kingdom. Answers: a buried crown, a river border.',
      overrideLabel: 'World Builder interview answers'
    })

    expect(assembled.sections).toHaveLength(1)
    expect(assembled.sections[0]).toMatchObject({ class: 'recent-excerpt', label: 'World Builder interview answers', included: true })
    expect(assembled.contextText).toContain('a buried crown, a river border')
    // No retrieval/Codex/chapter-summary machinery should have run for this path.
    expect(assembled.sections.some((s) => s.class === 'codex-entry')).toBe(false)
  })

  it('excludes a local-model-only Codex entry from a cloud-bound run (Codex review fix)', async () => {
    await upsertCodexEntry(
      projectRoot,
      db,
      makeCodexEntry({
        id: 'rule-secret',
        type: 'world-rule',
        name: 'Secret levee tunnel',
        locked: true,
        localModelOnly: true,
        body: { summary: 'A tunnel under the levee only three characters know about.' }
      })
    )

    const cloudGoal = makeGoal({
      scope: { sceneIds: ['scene-2'], selectionText: 'Elena confronted Marcus about the letter.' },
      modelRef: { provider: 'openrouter', modelId: 'anthropic/claude-sonnet', viaOpenRouter: true }
    })
    const assembledForCloud = await assembleContext(projectRoot, db, cloudGoal)

    const secretSection = assembledForCloud.sections.find((s) => s.label.includes('Secret levee tunnel'))
    expect(secretSection?.included).toBe(false)
    expect(secretSection?.excludedReason).toBe('entry is local-model-only')
    expect(assembledForCloud.contextText).not.toContain('Secret levee tunnel')

    // The same entry is fine to include when the run targets a local model —
    // only cloud-bound runs need to exclude it.
    const localGoal = makeGoal({
      scope: { sceneIds: ['scene-2'], selectionText: 'Elena confronted Marcus about the letter.' },
      modelRef: { provider: 'lm-studio', modelId: 'local-model', viaOpenRouter: false }
    })
    const assembledForLocal = await assembleContext(projectRoot, db, localGoal)
    const secretSectionLocal = assembledForLocal.sections.find((s) => s.label.includes('Secret levee tunnel'))
    expect(secretSectionLocal?.included).toBe(true)
  })

  it('reserves headroom below maxTokens for prompt/output overhead rather than packing all the way to the configured budget (Codex review fix)', async () => {
    const maxTokens = 1000
    const goal = makeGoal({
      scope: { sceneIds: ['scene-2'], selectionText: 'Elena confronted Marcus about the letter.' },
      constraints: { maxTurns: 4, maxTokens, maxToolCalls: 3, maxElapsedMs: 30000, allowedCapabilityCategories: ['generation'] }
    })
    const assembled = await assembleContext(projectRoot, db, goal)

    // tokenBudget still reports the writer's real configured maxTokens
    // (what guardModelCall checks against and what Context Inspection
    // should show as "the budget"), but the amount actually packed must
    // leave headroom for the system prompt/userIntent/output overhead
    // runModelCallStep() adds on top — packing all the way to maxTokens
    // would mean the real call's total input already meets or exceeds the
    // configured budget before output even starts.
    expect(assembled.tokenBudget).toBe(maxTokens)
    const usedTokens = assembled.sections.filter((s) => s.included).reduce((sum, s) => sum + s.tokensEstimate, 0)
    expect(usedTokens).toBeLessThan(maxTokens)
  })

  it('degrades gracefully with no sceneId and no Codex data: only the writer selection is included', async () => {
    const emptyProjectRoot = mkdtempSync(join(tmpdir(), 'atlas-assemble-empty-'))
    const emptyDb = await openIndexDb(emptyProjectRoot)
    try {
      const goal = makeGoal({ scope: { sceneIds: undefined, selectionText: 'A lone sentence with nothing else configured.' } })
      const assembled = await assembleContext(emptyProjectRoot, emptyDb, goal)

      expect(assembled.sections.some((s) => s.class === 'scene-outline')).toBe(false)
      expect(assembled.sections.some((s) => s.class === 'full-text')).toBe(false)
      const excerptSection = assembled.sections.find((s) => s.class === 'recent-excerpt')
      expect(excerptSection?.included).toBe(true)
      expect(assembled.contextText).toContain('A lone sentence with nothing else configured.')
    } finally {
      cleanupTestDir(emptyProjectRoot)
    }
  })
})
