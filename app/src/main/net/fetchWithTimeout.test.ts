import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWithTimeout } from './fetchWithTimeout'

describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('resolves normally when fetch settles before the timeout', async () => {
    const response = new Response('ok', { status: 200 })
    const fetchMock = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchWithTimeout('http://localhost:1234/v1/models', undefined, 2000)

    expect(result).toBe(response)
    // The signal is threaded through so an in-flight request can still be
    // aborted — confirms the timeout wiring is actually present, not just
    // that fetch was called.
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('aborts and rejects when fetch never settles within the timeout', async () => {
    vi.useFakeTimers()
    // A fetch that hangs forever unless its signal is aborted — mirrors a
    // real connection attempt stalling against a dead port.
    const fetchMock = vi.fn((_url: string, opts?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted')))
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const pending = fetchWithTimeout('http://localhost:1234/v1/models', undefined, 1500)
    const assertion = expect(pending).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(1500)
    await assertion
  })
})
