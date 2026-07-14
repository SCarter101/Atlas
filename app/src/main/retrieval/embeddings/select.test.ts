import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// select.ts's OpenRouterEmbeddingAdapter singleton transitively imports
// main/security/keyVault.ts, which imports 'electron' — not available
// outside a real Electron process. Mocked here the same way
// openRouterAdapter.test.ts/openRouterEmbeddingAdapter.test.ts mock the
// vault for a plain node-environment unit test; the relative path resolves
// to the same module regardless of which file under main/retrieval/
// embeddings/ does the importing.
const hasSecretMock = vi.fn()
vi.mock('../../security/keyVault', () => ({
  getSecret: vi.fn().mockResolvedValue(null),
  hasSecret: (name: string) => hasSecretMock(name)
}))

const { getEmbeddingsStatus, getPreferredEmbeddingProvider, selectEmbeddingAdapter, setPreferredEmbeddingProvider } =
  await import('./select')

function stubLmStudioAvailable(available: boolean): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: available ? 200 : 500 })))
}

describe('selectEmbeddingAdapter', () => {
  beforeEach(() => {
    hasSecretMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses hashing directly when explicitly preferred, without probing LM Studio or OpenRouter', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    hasSecretMock.mockResolvedValue(true)

    const adapter = await selectEmbeddingAdapter('hashing')

    expect(adapter.id).toBe('hashing')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(hasSecretMock).not.toHaveBeenCalled()
  })

  it('uses LM Studio when preferred and available', async () => {
    stubLmStudioAvailable(true)
    const adapter = await selectEmbeddingAdapter('lm-studio')
    expect(adapter.id).toBe('lm-studio')
  })

  it('falls back to hashing when LM Studio is preferred but unavailable — never silently tries OpenRouter', async () => {
    stubLmStudioAvailable(false)
    hasSecretMock.mockResolvedValue(true) // OpenRouter WOULD be available, but must not be tried here

    const adapter = await selectEmbeddingAdapter('lm-studio')

    expect(adapter.id).toBe('hashing')
    expect(hasSecretMock).not.toHaveBeenCalled()
  })

  it('defaults to the LM Studio -> hashing chain when no preference is given', async () => {
    stubLmStudioAvailable(false)
    hasSecretMock.mockResolvedValue(true)

    const adapter = await selectEmbeddingAdapter(undefined)

    expect(adapter.id).toBe('hashing')
    expect(hasSecretMock).not.toHaveBeenCalled()
  })

  it('uses OpenRouter when explicitly preferred and a key is saved (the opt-in)', async () => {
    hasSecretMock.mockResolvedValue(true)
    const adapter = await selectEmbeddingAdapter('openrouter')
    expect(adapter.id).toBe('openrouter')
  })

  it('falls back from OpenRouter to LM Studio when preferred but no key is saved', async () => {
    hasSecretMock.mockResolvedValue(false)
    stubLmStudioAvailable(true)

    const adapter = await selectEmbeddingAdapter('openrouter')

    expect(adapter.id).toBe('lm-studio')
  })

  it('falls back all the way to hashing when OpenRouter is preferred and nothing else is available', async () => {
    hasSecretMock.mockResolvedValue(false)
    stubLmStudioAvailable(false)

    const adapter = await selectEmbeddingAdapter('openrouter')

    expect(adapter.id).toBe('hashing')
  })
})

describe('getEmbeddingsStatus', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports available: true when the requested provider is the one actually active', async () => {
    stubLmStudioAvailable(true)
    const status = await getEmbeddingsStatus('lm-studio')
    expect(status).toEqual({ activeProvider: 'lm-studio', available: true })
  })

  it('reports available: false and the real fallback when the requested provider is not reachable', async () => {
    stubLmStudioAvailable(false)
    const status = await getEmbeddingsStatus('lm-studio')
    expect(status).toEqual({ activeProvider: 'hashing', available: false })
  })

  it('treats an unset preference as a request for LM Studio (the stated Settings default)', async () => {
    stubLmStudioAvailable(true)
    const status = await getEmbeddingsStatus(undefined)
    expect(status).toEqual({ activeProvider: 'lm-studio', available: true })
  })
})

describe('preferred embedding provider (main-process mirror of the writer\'s Settings choice)', () => {
  it('round-trips through set/getPreferredEmbeddingProvider', () => {
    expect(getPreferredEmbeddingProvider()).toBeUndefined()
    setPreferredEmbeddingProvider('openrouter')
    expect(getPreferredEmbeddingProvider()).toBe('openrouter')
    setPreferredEmbeddingProvider(undefined)
    expect(getPreferredEmbeddingProvider()).toBeUndefined()
  })
})
