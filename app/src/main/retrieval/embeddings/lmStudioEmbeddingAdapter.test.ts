import { afterEach, describe, expect, it, vi } from 'vitest'
import { LmStudioEmbeddingAdapter } from './lmStudioEmbeddingAdapter'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('LmStudioEmbeddingAdapter.embed', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns a Float32Array built from data[0].embedding on a 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ embedding: [0.1, 0.2, 0.3] }] }))
    vi.stubGlobal('fetch', fetchMock)

    const adapter = new LmStudioEmbeddingAdapter()
    const vector = await adapter.embed('Some scene prose.')

    expect(vector).toBeInstanceOf(Float32Array)
    expect(Array.from(vector)).toEqual([Math.fround(0.1), Math.fround(0.2), Math.fround(0.3)])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:1234/v1/embeddings')
    const body = JSON.parse(init.body)
    expect(body.input).toBe('Some scene prose.')
    expect(typeof body.model).toBe('string')
  })

  it('maps a thrown fetch (server not running) to LM_STUDIO_EMBEDDINGS_UNREACHABLE', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const adapter = new LmStudioEmbeddingAdapter()
    await expect(adapter.embed('text')).rejects.toMatchObject({ code: 'LM_STUDIO_EMBEDDINGS_UNREACHABLE' })
  })

  it('maps a non-2xx response to LM_STUDIO_EMBEDDINGS_UPSTREAM_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad request', { status: 400 })))
    const adapter = new LmStudioEmbeddingAdapter()
    await expect(adapter.embed('text')).rejects.toMatchObject({ code: 'LM_STUDIO_EMBEDDINGS_UPSTREAM_ERROR' })
  })

  it('throws LM_STUDIO_EMBEDDINGS_BAD_RESPONSE when data[0].embedding is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { data: [{}] })))
    const adapter = new LmStudioEmbeddingAdapter()
    await expect(adapter.embed('text')).rejects.toMatchObject({ code: 'LM_STUDIO_EMBEDDINGS_BAD_RESPONSE' })
  })

  it('throws LM_STUDIO_EMBEDDINGS_BAD_RESPONSE when data is missing entirely', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {})))
    const adapter = new LmStudioEmbeddingAdapter()
    await expect(adapter.embed('text')).rejects.toMatchObject({ code: 'LM_STUDIO_EMBEDDINGS_BAD_RESPONSE' })
  })
})

describe('LmStudioEmbeddingAdapter.isAvailable', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns true when GET /models succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
    const adapter = new LmStudioEmbeddingAdapter()
    await expect(adapter.isAvailable()).resolves.toBe(true)
  })

  it('returns false when GET /models responds non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })))
    const adapter = new LmStudioEmbeddingAdapter()
    await expect(adapter.isAvailable()).resolves.toBe(false)
  })

  it('returns false when fetch throws (server not running)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const adapter = new LmStudioEmbeddingAdapter()
    await expect(adapter.isAvailable()).resolves.toBe(false)
  })
})
