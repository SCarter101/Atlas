import type { EmbeddingProvider, EmbeddingsStatus } from '@shared/schema/embeddings'
import { HashingEmbeddingAdapter } from './hashingEmbeddingAdapter'
import { LmStudioEmbeddingAdapter } from './lmStudioEmbeddingAdapter'
import { OpenRouterEmbeddingAdapter } from './openRouterEmbeddingAdapter'
import type { EmbeddingAdapter } from './types'

const hashingAdapter: EmbeddingAdapter = new HashingEmbeddingAdapter()
const lmStudioAdapter: EmbeddingAdapter = new LmStudioEmbeddingAdapter()
const openRouterAdapter: EmbeddingAdapter = new OpenRouterEmbeddingAdapter()

// Mirrors main/permissions/cloudConsent.ts's CloudConsentSessionStore
// pattern: the writer's Settings choice (synced via the embeddings:
// set-provider IPC channel) is kept as one main-process-side value so code
// that isn't triggered per-call from the renderer — the scene-write
// reindexing hook and the retrieval:search handler's ensureIndexed() call,
// both in main/ipc/handlers.ts — knows which embedding space to use without
// threading an extra argument through every scene-save/search call. Like
// agentModels/lmStudioFallback in renderer/src/state/store.ts, this is
// in-memory only (no disk persistence) and resets to "unset" on relaunch.
let preferredProvider: EmbeddingProvider | undefined

export function setPreferredEmbeddingProvider(provider: EmbeddingProvider | undefined): void {
  preferredProvider = provider
}

export function getPreferredEmbeddingProvider(): EmbeddingProvider | undefined {
  return preferredProvider
}

// Resolves a real EmbeddingAdapter to use right now. `preferred` (a
// writer's Settings choice) wins outright when it's actually available.
// Otherwise falls back through LM Studio (the stated default) to hashing
// (always available, final fallback, never fails).
//
// OpenRouter is deliberately never part of that automatic fallback unless
// the writer's own preference literally was 'openrouter' — an unrelated
// preference (e.g. LM Studio) failing must never silently start sending
// real manuscript text to a cloud endpoint the writer didn't choose. If the
// writer *did* choose OpenRouter and it's currently unavailable (no key,
// network down, etc.), LM Studio is still tried as a same-session local
// fallback before giving up to hashing.
export async function selectEmbeddingAdapter(preferred?: EmbeddingProvider): Promise<EmbeddingAdapter> {
  if (preferred === 'hashing') {
    // Explicit "no network calls" choice — never probe LM Studio/OpenRouter.
    return hashingAdapter
  }

  if (preferred === 'openrouter') {
    if (await openRouterAdapter.isAvailable()) return openRouterAdapter
    if (await lmStudioAdapter.isAvailable()) return lmStudioAdapter
    return hashingAdapter
  }

  // preferred === 'lm-studio', or no preference set yet.
  if (await lmStudioAdapter.isAvailable()) return lmStudioAdapter
  return hashingAdapter
}

export async function getEmbeddingsStatus(preferred?: EmbeddingProvider): Promise<EmbeddingsStatus> {
  const adapter = await selectEmbeddingAdapter(preferred)
  const requested = preferred ?? 'lm-studio'
  // `available` reports whether the writer's requested/default provider is
  // the one actually in use right now — false signals "you asked for X, but
  // it's not reachable, so this fell back to something else," which is the
  // useful thing for the Settings status line to say.
  return { activeProvider: adapter.id, available: adapter.id === requested }
}
