import { describe, expect, it } from 'vitest'
import { vectorize } from '../vectorize'
import { HashingEmbeddingAdapter } from './hashingEmbeddingAdapter'

describe('HashingEmbeddingAdapter', () => {
  it('is always available (no network, no failure mode)', async () => {
    const adapter = new HashingEmbeddingAdapter()
    await expect(adapter.isAvailable()).resolves.toBe(true)
  })

  it('embed() matches vectorize() exactly', async () => {
    const adapter = new HashingEmbeddingAdapter()
    const text = 'Ray walked the levee road at dawn'
    await expect(adapter.embed(text)).resolves.toEqual(vectorize(text))
  })

  it('reports id "hashing"', () => {
    const adapter = new HashingEmbeddingAdapter()
    expect(adapter.id).toBe('hashing')
  })
})
