import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelCallInput } from './types'

// openRouterAdapter.ts calls main/security/keyVault.ts's getSecret(), which
// in production does a real Electron safeStorage + filesystem round trip.
// Mocked here the same way registry.test.ts mocks 'electron' for a
// main-process unit test — vi.mock calls are hoisted above imports, so the
// static import of ./openRouterAdapter below picks up this mock.
const getSecretMock = vi.fn()
vi.mock('../../security/keyVault', () => ({
  getSecret: (name: string) => getSecretMock(name)
}))

const { OpenRouterAdapter } = await import('./openRouterAdapter')

function input(overrides: Partial<ModelCallInput> = {}): ModelCallInput {
  return {
    modelRef: { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-5', viaOpenRouter: true },
    userIntent: 'Continue the scene.',
    contextText: 'Some selected prose.',
    ...overrides
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('OpenRouterAdapter.runModelCall', () => {
  beforeEach(() => {
    getSecretMock.mockReset()
    getSecretMock.mockResolvedValue('sk-or-test-key')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns a ModelCallSummary with outputText on a 200 with usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        choices: [{ message: { content: 'Here is the continuation.' } }],
        usage: { prompt_tokens: 42, completion_tokens: 17, cost: 0.0031 }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const adapter = new OpenRouterAdapter()
    const summary = await adapter.runModelCall(input())

    expect(summary).toEqual({
      modelRef: input().modelRef,
      inputTokens: 42,
      outputTokens: 17,
      estimatedCostUsd: 0.0031,
      outputText: 'Here is the continuation.'
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer sk-or-test-key')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('anthropic/claude-sonnet-5')
    expect(body.messages).toEqual([{ role: 'user', content: 'Continue the scene.\n\nSome selected prose.' }])
  })

  it('includes a system message first when systemPrompt is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 } })
    )
    vi.stubGlobal('fetch', fetchMock)

    const adapter = new OpenRouterAdapter()
    await adapter.runModelCall(input({ systemPrompt: 'You are a helpful editor.' }))

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are a helpful editor.' })
    expect(body.messages[1].role).toBe('user')
  })

  it('throws OPENROUTER_NO_KEY when no key is saved', async () => {
    getSecretMock.mockResolvedValue(null)
    const adapter = new OpenRouterAdapter()

    await expect(adapter.runModelCall(input())).rejects.toMatchObject({ code: 'OPENROUTER_NO_KEY' })
  })

  it('maps 401 to OPENROUTER_UNAUTHORIZED', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 })))
    const adapter = new OpenRouterAdapter()
    await expect(adapter.runModelCall(input())).rejects.toMatchObject({ code: 'OPENROUTER_UNAUTHORIZED' })
  })

  it('maps 402 to OPENROUTER_INSUFFICIENT_CREDITS', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no credits', { status: 402 })))
    const adapter = new OpenRouterAdapter()
    await expect(adapter.runModelCall(input())).rejects.toMatchObject({ code: 'OPENROUTER_INSUFFICIENT_CREDITS' })
  })

  it('maps 429 to OPENROUTER_RATE_LIMITED', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('slow down', { status: 429 })))
    const adapter = new OpenRouterAdapter()
    await expect(adapter.runModelCall(input())).rejects.toMatchObject({ code: 'OPENROUTER_RATE_LIMITED' })
  })

  it('maps 500 to OPENROUTER_UPSTREAM_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('server error', { status: 500 })))
    const adapter = new OpenRouterAdapter()
    await expect(adapter.runModelCall(input())).rejects.toMatchObject({ code: 'OPENROUTER_UPSTREAM_ERROR' })
  })

  it('maps a thrown fetch (network failure) to OPENROUTER_NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const adapter = new OpenRouterAdapter()
    await expect(adapter.runModelCall(input())).rejects.toMatchObject({ code: 'OPENROUTER_NETWORK_ERROR' })
  })

  it('throws OPENROUTER_BAD_RESPONSE when choices[0].message.content is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{}] })))
    const adapter = new OpenRouterAdapter()
    await expect(adapter.runModelCall(input())).rejects.toMatchObject({ code: 'OPENROUTER_BAD_RESPONSE' })
  })

  it('reports isAvailable() as true unconditionally', async () => {
    const adapter = new OpenRouterAdapter()
    await expect(adapter.isAvailable()).resolves.toBe(true)
  })
})
