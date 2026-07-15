import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanupTestDir } from '../testUtils'

// Phase 7: getOrGenerateSceneSummary/getOrGenerateChapterSummary now attempt
// a real model call (LM Studio, then OpenRouter — see
// modelSummaryFallback.ts) before falling back to the extractive heuristic.
// A developer who happens to have LM Studio open locally must not get
// nondeterministic real-model output in this unit test, so both real tiers
// are made to fail deterministically here (no key configured, fetch always
// rejects) unless a specific test opts a tier back in — same mocking
// convention main/agent/simulator.fallback.test.ts and
// providers/openRouterAdapter.test.ts already use.
const getSecretMock = vi.fn()
vi.mock('../security/keyVault', () => ({
  getSecret: (name: string) => getSecretMock(name)
}))

const { getOrGenerateChapterSummary, getOrGenerateSceneSummary } = await import('./summaryStore')

const LM_STUDIO_CHAT_URL = 'http://localhost:1234/v1/chat/completions'
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'

function alwaysFailFetchMock(): ReturnType<typeof vi.fn> {
  return vi.fn((url: string) => {
    if (url === LM_STUDIO_CHAT_URL) return Promise.reject(new Error('ECONNREFUSED'))
    throw new Error(`unexpected fetch to ${url}`)
  })
}

describe('getOrGenerateSceneSummary', () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-summary-test-'))
    getSecretMock.mockReset()
    getSecretMock.mockResolvedValue(null) // OpenRouter has no key -> falls through immediately
    vi.stubGlobal('fetch', alwaysFailFetchMock())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    cleanupTestDir(projectRoot)
  })

  it('generates a heuristic summary on first call when no real provider is available', async () => {
    const summary = await getOrGenerateSceneSummary(
      projectRoot,
      'scene-1',
      'Ray walked the levee road at dawn. He thought about Dale. The water was low.'
    )
    expect(summary.sceneId).toBe('scene-1')
    expect(summary.summary.length).toBeGreaterThan(0)
    expect(summary.summary).toContain('Ray walked the levee road at dawn')
    expect(summary.generatedBy).toBe('heuristic')
    expect(summary.modelRef).toBeUndefined()
  })

  it('does not regenerate when the source prose is unchanged', async () => {
    const prose = 'Ray walked the levee road at dawn. He thought about Dale.'
    const first = await getOrGenerateSceneSummary(projectRoot, 'scene-1', prose)
    const second = await getOrGenerateSceneSummary(projectRoot, 'scene-1', prose)

    expect(second).toEqual(first)
  })

  it('regenerates when the source prose changes', async () => {
    const first = await getOrGenerateSceneSummary(projectRoot, 'scene-1', 'Original prose about the levee road.')
    const second = await getOrGenerateSceneSummary(projectRoot, 'scene-1', 'Completely rewritten prose about catfish.')

    expect(second.sourceUpdatedAt).not.toBe(first.sourceUpdatedAt)
    expect(second.summary).toContain('catfish')
  })

  it('uses a real model completion and records usage when LM Studio is available', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === LM_STUDIO_CHAT_URL) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                choices: [{ message: { content: 'A real local summary of the scene.' } }],
                usage: { prompt_tokens: 30, completion_tokens: 12 }
              }),
              { status: 200 }
            )
          )
        }
        throw new Error(`unexpected fetch to ${url}`)
      })
    )

    const summary = await getOrGenerateSceneSummary(projectRoot, 'scene-real', 'Some scene prose to summarize.')
    expect(summary.generatedBy).toBe('model')
    expect(summary.summary).toBe('A real local summary of the scene.')
    expect(summary.modelRef).toEqual({ provider: 'lm-studio', modelId: 'local-summarizer', viaOpenRouter: false })

    const usageLog = await readFile(join(projectRoot, 'settings', 'usage.jsonl'), 'utf-8')
    const entry = JSON.parse(usageLog.trim().split('\n').pop()!)
    expect(entry).toMatchObject({
      callKind: 'summary-generation',
      label: 'scene-summary:scene-real',
      inputTokens: 30,
      outputTokens: 12
    })
  })

  it('treats blank prose as nothing to summarize and skips the model call entirely', async () => {
    const fetchMock = vi.fn(() => {
      throw new Error('fetch should not be called for blank prose')
    })
    vi.stubGlobal('fetch', fetchMock)

    const summary = await getOrGenerateSceneSummary(projectRoot, 'scene-blank', '   ')
    expect(summary.generatedBy).toBe('heuristic')
    expect(summary.summary).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('getOrGenerateChapterSummary', () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-summary-test-'))
    getSecretMock.mockReset()
    getSecretMock.mockResolvedValue(null)
    vi.stubGlobal('fetch', alwaysFailFetchMock())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    cleanupTestDir(projectRoot)
  })

  it('generates a heuristic summary on first call from its scene summaries', async () => {
    const s1 = await getOrGenerateSceneSummary(projectRoot, 'scene-1', 'The fish house was cold and quiet.')
    const s2 = await getOrGenerateSceneSummary(projectRoot, 'scene-2', 'Ray confronted his brother by the water.')

    const chapter = await getOrGenerateChapterSummary(projectRoot, 'chapter-1', [s1, s2])
    expect(chapter.chapterId).toBe('chapter-1')
    expect(chapter.summary.length).toBeGreaterThan(0)
    expect(chapter.generatedBy).toBe('heuristic')
  })

  it('does not regenerate when its scene summaries are unchanged', async () => {
    const s1 = await getOrGenerateSceneSummary(projectRoot, 'scene-1', 'The fish house was cold and quiet.')
    const first = await getOrGenerateChapterSummary(projectRoot, 'chapter-1', [s1])
    const second = await getOrGenerateChapterSummary(projectRoot, 'chapter-1', [s1])

    expect(second).toEqual(first)
  })

  it('regenerates when a scene summary changes', async () => {
    const s1 = await getOrGenerateSceneSummary(projectRoot, 'scene-1', 'The fish house was cold and quiet.')
    const first = await getOrGenerateChapterSummary(projectRoot, 'chapter-1', [s1])

    const s1Updated = await getOrGenerateSceneSummary(projectRoot, 'scene-1', 'The fish house burned down overnight.')
    const second = await getOrGenerateChapterSummary(projectRoot, 'chapter-1', [s1Updated])

    expect(second.sourceUpdatedAt).not.toBe(first.sourceUpdatedAt)
    expect(second.summary).toContain('burned down')
  })

  it('uses a real model completion for the chapter summary when LM Studio is available', async () => {
    const s1 = await getOrGenerateSceneSummary(projectRoot, 'scene-1', 'The fish house was cold and quiet.')

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === LM_STUDIO_CHAT_URL) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                choices: [{ message: { content: 'A real chapter-level summary.' } }],
                usage: { prompt_tokens: 40, completion_tokens: 15 }
              }),
              { status: 200 }
            )
          )
        }
        throw new Error(`unexpected fetch to ${url}`)
      })
    )

    const chapter = await getOrGenerateChapterSummary(projectRoot, 'chapter-real', [s1])
    expect(chapter.generatedBy).toBe('model')
    expect(chapter.summary).toBe('A real chapter-level summary.')
    expect(chapter.modelRef).toEqual({ provider: 'lm-studio', modelId: 'local-summarizer', viaOpenRouter: false })
  })
})
