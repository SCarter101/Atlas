// Phase 7: which embedding source is actually active for this project
// session, surfaced in Settings so a writer can see whether retrieval is
// running on real local/cloud embeddings or has fallen back to the
// pre-Phase-7 hashing trick (main/retrieval/vectorize.ts).
export type EmbeddingProvider = 'lm-studio' | 'openrouter' | 'hashing'

export interface EmbeddingsStatus {
  activeProvider: EmbeddingProvider
  available: boolean
}
