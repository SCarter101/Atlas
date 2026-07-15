import { mkdtempSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SummaryPromptPair } from '@shared/summaryPrompts'
import { cleanupTestDir } from '../testUtils'

// generateSummaryViaModel() routes through the real OpenRouterAdapter, which
// reads its key via main/security/keyVault.ts's getSecret() — mocked the
// same way providers/openRouterAdapter.test.ts and
// main/agent/simulator.fallback.test.ts do for a hermetic main-process unit
// test (vi.mock calls are hoisted above imports).
const getSecretMock = vi.fn()
vi.mock('../security/keyVault', () => ({
  getSecret: (name: string) => getSecretMock(name)
}))

const { generateSummaryViaModel } = await import('./modelSummaryFallback')

const LM_STUDIO_CHAT_URL = 'http://localhost:1234/v1/chat/completions'
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'

function prompt(): SummaryPromptPair {
  return { systemPrompt: 'You are a summarizer.', userIntent: 'Summarize the following text.' }
}

describe('generateSummaryViaModel', () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-summary-fallback-test-'))
    getSecretMock.mockReset()
    getSecretMock.mockResolvedValue('sk-or-test-key')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    cleanupTestDir(projectRoot)
  })

  it('uses LM Studio when it succeeds and never touches OpenRouter', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === LM_STUDIO_CHAT_URL) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: 'A local summary.' } }],
              usage: { prompt_tokens: 10, completion_tokens: 5 }
            }),
            { status: 200 }
          )
        )
      }
      throw new Error(`unexpected fetch to ${url} — OpenRouter should never be reached`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateSummaryViaModel(projectRoot, 'scene-summary:scene-1', prompt(), 'Some scene prose.')

    expect(result).toEqual({
      text: 'A local summary.',
      modelRef: { provider: 'lm-studio', modelId: 'local-summarizer', viaOpenRouter: false }
    })
    expect(fetchMock.mock.calls.every(([url]) => url === LM_STUDIO_CHAT_URL)).toBe(true)

    const usageLog = await readFile(join(projectRoot, 'settings', 'usage.jsonl'), 'utf-8')
    const entry = JSON.parse(usageLog.trim())
    expect(entry).toMatchObject({
      callKind: 'summary-generation',
      label: 'scene-summary:scene-1',
      modelRef: { provider: 'lm-studio', modelId: 'local-summarizer', viaOpenRouter: false },
      inputTokens: 10,
      outputTokens: 5,
      estimatedCostUsd: 0
    })
  })

  it('falls back to OpenRouter when LM Studio fails', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === LM_STUDIO_CHAT_URL) return Promise.reject(new Error('ECONNREFUSED'))
      if (url === OPENROUTER_CHAT_URL) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: 'A cloud summary.' } }],
              usage: { prompt_tokens: 20, completion_tokens: 8, cost: 0.0012 }
            }),
            { status: 200 }
          )
        )
      }
      throw new Error(`unexpected fetch to ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateSummaryViaModel(projectRoot, 'chapter-summary:ch-1', prompt(), 'Some chapter text.')

    expect(result).toEqual({
      text: 'A cloud summary.',
      modelRef: { provider: 'openrouter', modelId: 'openrouter/auto', viaOpenRouter: true }
    })

    const usageLog = await readFile(join(projectRoot, 'settings', 'usage.jsonl'), 'utf-8')
    const entry = JSON.parse(usageLog.trim())
    expect(entry).toMatchObject({ label: 'chapter-summary:ch-1', estimatedCostUsd: 0.0012 })
  })

  it('returns null (caller should use the heuristic) when both LM Studio and OpenRouter fail', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === LM_STUDIO_CHAT_URL) return Promise.reject(new Error('ECONNREFUSED'))
      if (url === OPENROUTER_CHAT_URL) return Promise.reject(new Error('ECONNREFUSED'))
      throw new Error(`unexpected fetch to ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateSummaryViaModel(projectRoot, 'scene-summary:scene-2', prompt(), 'Some prose.')
    expect(result).toBeNull()
  })

  it('returns null when OpenRouter has no key configured and LM Studio is unreachable', async () => {
    getSecretMock.mockResolvedValue(null)
    const fetchMock = vi.fn((url: string) => {
      if (url === LM_STUDIO_CHAT_URL) return Promise.reject(new Error('ECONNREFUSED'))
      throw new Error(`unexpected fetch to ${url} — OPENROUTER_NO_KEY should throw before any fetch`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateSummaryViaModel(projectRoot, 'scene-summary:scene-3', prompt(), 'Some prose.')
    expect(result).toBeNull()
  })

  it('treats an empty/whitespace-only completion as unusable and tries the next tier', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === LM_STUDIO_CHAT_URL) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ choices: [{ message: { content: '   ' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
            { status: 200 }
          )
        )
      }
      if (url === OPENROUTER_CHAT_URL) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: 'Real content.' } }],
              usage: { prompt_tokens: 5, completion_tokens: 3, cost: 0 }
            }),
            { status: 200 }
          )
        )
      }
      throw new Error(`unexpected fetch to ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateSummaryViaModel(projectRoot, 'scene-summary:scene-4', prompt(), 'Some prose.')
    expect(result?.text).toBe('Real content.')
  })

  it('never throws even when both tiers fail with unexpected errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('completely unexpected failure')
      })
    )

    await expect(generateSummaryViaModel(projectRoot, 'scene-summary:scene-5', prompt(), 'Some prose.')).resolves.toBeNull()
  })
})
