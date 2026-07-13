import { afterEach, describe, expect, it, vi } from 'vitest'
import { LmStudioAdapter } from './lmStudioAdapter'
import type { ModelCallInput } from './types'

function input(overrides: Partial<ModelCallInput> = {}): ModelCallInput {
  return {
    modelRef: { provider: 'lm-studio', modelId: 'local-model', viaOpenRouter: false },
    userIntent: 'Continue the scene.',
    contextText: 'Some selected prose.',
    ...overrides
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('LmStudioAdapter.runModelCall', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns a ModelCallSummary with outputText on a 200 with usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        choices: [{ message: { content: 'Local continuation.' } }],
        usage: { prompt_tokens: 30, completion_tokens: 12 }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const adapter = new LmStudioAdapter()
    const summary = await adapter.runModelCall(input())

    expect(summary).toEqual({
      modelRef: input().modelRef,
      inputTokens: 30,
      outputTokens: 12,
      estimatedCostUsd: 0,
      outputText: 'Local continuation.'
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:1234/v1/chat/completions')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('local-model')
  })

  it('falls back to a length-based token estimate when usage is absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'ok' } }] })))
    const adapter = new LmStudioAdapter()
    const summary = await adapter.runModelCall(input())

    expect(summary.inputTokens).toBeGreaterThan(0)
    expect(summary.outputTokens).toBeGreaterThan(0)
    expect(summary.estimatedCostUsd).toBe(0)
  })

  it('maps a thrown fetch (server not running) to LM_STUDIO_UNREACHABLE', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const adapter = new LmStudioAdapter()
    await expect(adapter.runModelCall(input())).rejects.toMatchObject({ code: 'LM_STUDIO_UNREACHABLE' })
  })

  it('maps a non-2xx response to a mapped AtlasError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad request', { status: 400 })))
    const adapter = new LmStudioAdapter()
    await expect(adapter.runModelCall(input())).rejects.toMatchObject({ code: 'LM_STUDIO_UPSTREAM_ERROR' })
  })

  it('throws LM_STUDIO_BAD_RESPONSE when choices[0].message.content is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{}] })))
    const adapter = new LmStudioAdapter()
    await expect(adapter.runModelCall(input())).rejects.toMatchObject({ code: 'LM_STUDIO_BAD_RESPONSE' })
  })
})

describe('LmStudioAdapter.isAvailable', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns true when GET /models succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
    const adapter = new LmStudioAdapter()
    await expect(adapter.isAvailable()).resolves.toBe(true)
  })

  it('returns false when GET /models responds non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })))
    const adapter = new LmStudioAdapter()
    await expect(adapter.isAvailable()).resolves.toBe(false)
  })

  it('returns false when fetch throws (server not running)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const adapter = new LmStudioAdapter()
    await expect(adapter.isAvailable()).resolves.toBe(false)
  })
})
