import { AtlasError } from '@shared/errors'
import type { EmbeddingAdapter } from './types'

// Real seam for a local LM Studio embeddings integration — the same local
// server main/agent/providers/lmStudioAdapter.ts already talks to for chat
// completions (OpenAI-compatible), just a different endpoint. Same base-URL
// convention: no configurability UI exists yet, so it's a simple internal
// constant, matching lmStudioAdapter.ts.
const BASE_URL = 'http://localhost:1234/v1'

// LM Studio doesn't report which embedding model is currently loaded via a
// cheap probe, so this is a sensible default matching a commonly-bundled
// local embedding model — a writer running a different one can still get a
// working embed() call as long as LM Studio's server accepts any `model`
// value for its single loaded model (typical local-server behavior), but
// this is the assumed identifier absent any configuration UI.
const DEFAULT_MODEL = 'text-embedding-nomic-embed-text-v1.5'

interface LmStudioEmbeddingsResponseBody {
  data?: Array<{ embedding?: number[] }>
}

export class LmStudioEmbeddingAdapter implements EmbeddingAdapter {
  readonly id = 'lm-studio' as const

  async embed(text: string): Promise<Float32Array> {
    let response: Response
    try {
      response = await fetch(`${BASE_URL}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: DEFAULT_MODEL, input: text })
      })
    } catch {
      throw new AtlasError("LM Studio isn't running — start its local server.", 'LM_STUDIO_EMBEDDINGS_UNREACHABLE')
    }

    if (!response.ok) {
      throw new AtlasError(`LM Studio embeddings request failed (HTTP ${response.status}).`, 'LM_STUDIO_EMBEDDINGS_UPSTREAM_ERROR')
    }

    let body: LmStudioEmbeddingsResponseBody
    try {
      body = (await response.json()) as LmStudioEmbeddingsResponseBody
    } catch {
      throw new AtlasError('LM Studio returned an unexpected embeddings response shape.', 'LM_STUDIO_EMBEDDINGS_BAD_RESPONSE')
    }

    const embedding = body.data?.[0]?.embedding
    if (!Array.isArray(embedding)) {
      throw new AtlasError('LM Studio returned an unexpected embeddings response shape.', 'LM_STUDIO_EMBEDDINGS_BAD_RESPONSE')
    }

    return Float32Array.from(embedding)
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${BASE_URL}/models`)
      return response.ok
    } catch {
      return false
    }
  }
}
