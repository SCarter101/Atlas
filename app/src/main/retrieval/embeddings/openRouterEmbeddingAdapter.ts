import { AtlasError } from '@shared/errors'
import { getSecret, hasSecret } from '../../security/keyVault'
import type { EmbeddingAdapter } from './types'

// Real seam for OpenRouter's embeddings endpoint — opt-in only. A writer
// must explicitly select "OpenRouter" in Settings' embeddings-provider
// picker before main/retrieval/embeddings/select.ts ever tries this
// adapter; it is never reached as a silent fallback from an unrelated
// preference (e.g. LM Studio going down does not on its own cause real
// manuscript text to start being sent to a cloud endpoint the writer never
// opted into).
//
// API shape verified against OpenRouter's live docs while implementing this
// (openrouter.ai/docs/api/reference/embeddings, July 2026): a real,
// generally-available, OpenAI-compatible embeddings endpoint distinct from
// the chat-completions endpoint main/agent/providers/openRouterAdapter.ts
// uses. Request: { model, input }. Response: { data: [{ embedding, index }],
// model, usage: { prompt_tokens, total_tokens } } — no `cost` field is
// documented on the embeddings response the way chat completions include
// one, so (unlike the chat adapter) this adapter doesn't attempt cost
// accounting; EmbeddingAdapter's embed() only returns the vector.
// Documented error statuses: 400/401/402/404/429/529.
const EMBEDDINGS_URL = 'https://openrouter.ai/api/v1/embeddings'

// A small, inexpensive, widely-available OpenRouter embedding model — a
// sensible default absent any per-role model-routing UI for embeddings
// (spec scope for this wave is adapter connectivity, not a model picker).
const DEFAULT_MODEL = 'openai/text-embedding-3-small'

interface OpenRouterEmbeddingsResponseBody {
  data?: Array<{ embedding?: number[] }>
}

function errorForStatus(status: number): AtlasError {
  if (status === 401) {
    return new AtlasError(
      'OpenRouter rejected the API key — check the key saved in Settings → OpenRouter.',
      'OPENROUTER_EMBEDDINGS_UNAUTHORIZED'
    )
  }
  if (status === 402) {
    return new AtlasError('OpenRouter account is out of credits.', 'OPENROUTER_EMBEDDINGS_INSUFFICIENT_CREDITS')
  }
  if (status === 404) {
    return new AtlasError(
      'The configured OpenRouter embeddings model is not available.',
      'OPENROUTER_EMBEDDINGS_MODEL_NOT_FOUND'
    )
  }
  if (status === 429) {
    return new AtlasError('OpenRouter rate-limited this request — try again shortly.', 'OPENROUTER_EMBEDDINGS_RATE_LIMITED')
  }
  if (status >= 500) {
    return new AtlasError('OpenRouter is having upstream issues — try again shortly.', 'OPENROUTER_EMBEDDINGS_UPSTREAM_ERROR')
  }
  return new AtlasError(`OpenRouter embeddings request failed (HTTP ${status}).`, 'OPENROUTER_EMBEDDINGS_UPSTREAM_ERROR')
}

export class OpenRouterEmbeddingAdapter implements EmbeddingAdapter {
  readonly id = 'openrouter' as const

  async embed(text: string): Promise<Float32Array> {
    const apiKey = await getSecret('openrouter-api-key')
    if (!apiKey) {
      throw new AtlasError('OpenRouter is not configured — add a key in Settings → OpenRouter.', 'OPENROUTER_EMBEDDINGS_NO_KEY')
    }

    let response: Response
    try {
      response = await fetch(EMBEDDINGS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model: DEFAULT_MODEL, input: text })
      })
    } catch {
      throw new AtlasError('Could not reach OpenRouter — check your network connection.', 'OPENROUTER_EMBEDDINGS_NETWORK_ERROR')
    }

    if (!response.ok) {
      throw errorForStatus(response.status)
    }

    let body: OpenRouterEmbeddingsResponseBody
    try {
      body = (await response.json()) as OpenRouterEmbeddingsResponseBody
    } catch {
      throw new AtlasError('OpenRouter returned an unexpected embeddings response shape.', 'OPENROUTER_EMBEDDINGS_BAD_RESPONSE')
    }

    const embedding = body.data?.[0]?.embedding
    if (!Array.isArray(embedding)) {
      throw new AtlasError('OpenRouter returned an unexpected embeddings response shape.', 'OPENROUTER_EMBEDDINGS_BAD_RESPONSE')
    }

    return Float32Array.from(embedding)
  }

  async isAvailable(): Promise<boolean> {
    // Distinct from the chat OpenRouterAdapter.isAvailable(), which always
    // returns true because no cheap probe exists there. Embeddings feed real
    // fallback-selection logic (select.ts), where a meaningful no-network
    // check is worth doing: there's no point ever selecting OpenRouter as
    // the active embeddings provider when no key is saved at all.
    return hasSecret('openrouter-api-key')
  }
}
