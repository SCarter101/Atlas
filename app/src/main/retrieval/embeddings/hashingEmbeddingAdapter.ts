import { vectorize } from '../vectorize'
import type { EmbeddingAdapter } from './types'

// Wraps the pre-Phase-7 hashing-trick vectorizer (main/retrieval/
// vectorize.ts) behind the EmbeddingAdapter interface so it can serve as the
// guaranteed final fallback in main/retrieval/embeddings/select.ts's chain —
// no network call, no configuration, no failure mode. Still not a real
// embedding model (see vectorize.ts's own header comment); this class exists
// purely to make "no real provider is available" a normal, typed adapter
// rather than a special case every caller has to branch on separately.
export class HashingEmbeddingAdapter implements EmbeddingAdapter {
  readonly id = 'hashing' as const

  async isAvailable(): Promise<boolean> {
    return true
  }

  async embed(text: string): Promise<Float32Array> {
    return vectorize(text)
  }
}
