// Phase 7: real embedding providers behind the same kind of swappable
// adapter interface main/agent/providers/types.ts's ProviderAdapter used for
// chat completions in Phase 6. embed() always resolves a Float32Array (never
// throws a raw fetch error — implementations wrap failures in AtlasError) so
// callers in main/retrieval/search.ts don't need per-adapter error handling.
export interface EmbeddingAdapter {
  readonly id: 'lm-studio' | 'openrouter' | 'hashing'
  isAvailable(): Promise<boolean>
  embed(text: string): Promise<Float32Array>
}
