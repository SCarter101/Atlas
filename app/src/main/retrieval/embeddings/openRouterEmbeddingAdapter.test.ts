import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// openRouterEmbeddingAdapter.ts calls main/security/keyVault.ts's
// getSecret()/hasSecret(), which in production do a real Electron
// safeStorage + filesystem round trip. Mocked here the same way
// main/agent/providers/openRouterAdapter.test.ts mocks the vault for its
// chat-completions counterpart — vi.mock calls are hoisted above imports, so
// the static import of ./openRouterEmbeddingAdapter below picks up this mock.
const getSecretMock = vi.fn()
const hasSecretMock = vi.fn()
vi.mock('../../security/keyVault', () => ({
  getSecret: (name: string) => getSecretMock(name),
  hasSecret: (name: string) => hasSecretMock(name)
}))

const { OpenRouterEmbeddingAdapter } = await import('./openRouterEmbeddingAdapter')

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('OpenRouterEmbeddingAdapter.embed', () => {
  beforeEach(() => {
    getSecretMock.mockReset()
    getSecretMock.mockResolvedValue('sk-or-test-key')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns a Float32Array built from data[0].embedding on a 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: [{ embedding: [0.4, 0.5, 0.6], index: 0 }],
        model: 'openai/text-embedding-3-small',
        usage: { prompt_tokens: 6, total_tokens: 6 }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const adapter = new OpenRouterEmbeddingAdapter()
    const vector = await adapter.embed('Some codex entry text.')

    expect(vector).toBeInstanceOf(Float32Array)
    expect(Array.from(vector)).toEqual([Math.fround(0.4), Math.fround(0.5), Math.fround(0.6)])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/embeddings')
    expect(init.headers.Authorization).toBe('Bearer sk-or-test-key')
    const body = JSON.parse(init.body)
    expect(body.input).toBe('Some codex entry text.')
    expect(typeof body.model).toBe('string')
  })

  it('throws OPENROUTER_EMBEDDINGS_NO_KEY when no key is saved', async () => {
    getSecretMock.mockResolvedValue(null)
    const adapter = new OpenRouterEmbeddingAdapter()
    await expect(adapter.embed('text')).rejects.toMatchObject({ code: 'OPENROUTER_EMBEDDINGS_NO_KEY' })
  })

  it('maps 401 to OPENROUTER_EMBEDDINGS_UNAUTHORIZED', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 })))
    const adapter = new OpenRouterEmbeddingAdapter()
    await expect(adapter.embed('text')).rejects.toMatchObject({ code: 'OPENROUTER_EMBEDDINGS_UNAUTHORIZED' })
  })

  it('maps 402 to OPENROUTER_EMBEDDINGS_INSUFFICIENT_CREDITS', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no credits', { status: 402 })))
    const adapter = new OpenRouterEmbeddingAdapter()
    await expect(adapter.embed('text')).rejects.toMatchObject({ code: 'OPENROUTER_EMBEDDINGS_INSUFFICIENT_CREDITS' })
  })

  it('maps 404 to OPENROUTER_EMBEDDINGS_MODEL_NOT_FOUND', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not found', { status: 404 })))
    const adapter = new OpenRouterEmbeddingAdapter()
    await expect(adapter.embed('text')).rejects.toMatchObject({ code: 'OPENROUTER_EMBEDDINGS_MODEL_NOT_FOUND' })
  })

  it('maps 429 to OPENROUTER_EMBEDDINGS_RATE_LIMITED', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('slow down', { status: 429 })))
    const adapter = new OpenRouterEmbeddingAdapter()
    await expect(adapter.embed('text')).rejects.toMatchObject({ code: 'OPENROUTER_EMBEDDINGS_RATE_LIMITED' })
  })

  it('maps 529 to OPENROUTER_EMBEDDINGS_UPSTREAM_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('overloaded', { status: 529 })))
    const adapter = new OpenRouterEmbeddingAdapter()
    await expect(adapter.embed('text')).rejects.toMatchObject({ code: 'OPENROUTER_EMBEDDINGS_UPSTREAM_ERROR' })
  })

  it('maps a thrown fetch (network failure) to OPENROUTER_EMBEDDINGS_NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const adapter = new OpenRouterEmbeddingAdapter()
    await expect(adapter.embed('text')).rejects.toMatchObject({ code: 'OPENROUTER_EMBEDDINGS_NETWORK_ERROR' })
  })

  it('throws OPENROUTER_EMBEDDINGS_BAD_RESPONSE when data[0].embedding is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { data: [{}] })))
    const adapter = new OpenRouterEmbeddingAdapter()
    await expect(adapter.embed('text')).rejects.toMatchObject({ code: 'OPENROUTER_EMBEDDINGS_BAD_RESPONSE' })
  })
})

describe('OpenRouterEmbeddingAdapter.isAvailable', () => {
  beforeEach(() => {
    hasSecretMock.mockReset()
  })

  it('returns true when an OpenRouter key is saved', async () => {
    hasSecretMock.mockResolvedValue(true)
    const adapter = new OpenRouterEmbeddingAdapter()
    await expect(adapter.isAvailable()).resolves.toBe(true)
    expect(hasSecretMock).toHaveBeenCalledWith('openrouter-api-key')
  })

  it('returns false when no key is saved', async () => {
    hasSecretMock.mockResolvedValue(false)
    const adapter = new OpenRouterEmbeddingAdapter()
    await expect(adapter.isAvailable()).resolves.toBe(false)
  })
})
