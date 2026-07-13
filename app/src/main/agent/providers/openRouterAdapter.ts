import type { ModelCallSummary, ModelRef } from '@shared/schema/agent'
import { AtlasError } from '@shared/errors'
import { getSecret } from '../../security/keyVault'
import type { ModelCallInput, ProviderAdapter } from './types'

// Real seam for OpenRouter integration (spec §13), Phase 6. The API key is
// read from the encrypted vault (main/security/keyVault.ts) under the
// literal secret name the renderer's Settings UI already writes to
// ('openrouter-api-key') — the raw key never crosses into this module from
// anywhere but that vault.
//
// API shape verified against OpenRouter's live docs while implementing this
// (docs URL for the chat-completion reference page 404s as of this writing;
// verified instead via openrouter.ai/docs/api-reference/overview,
// openrouter.ai/docs/use-cases/usage-accounting, and a web search corroborating
// both). One deviation from the brief's assumed shape: the brief assumed a
// request-body `usage: { include: true }` flag was required to get token/cost
// accounting. That flag is now DEPRECATED and has no effect — OpenRouter
// "always" includes full usage details (prompt_tokens/completion_tokens/cost)
// in every chat-completion response automatically, so this adapter does not
// send it.
const CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions'

interface OpenRouterMessage {
  role: 'system' | 'user'
  content: string
}

interface OpenRouterResponseBody {
  choices?: Array<{ message?: { content?: string } }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    cost?: number
  }
}

function buildMessages(input: ModelCallInput): OpenRouterMessage[] {
  const messages: OpenRouterMessage[] = []
  if (input.systemPrompt) messages.push({ role: 'system', content: input.systemPrompt })
  messages.push({ role: 'user', content: `${input.userIntent}\n\n${input.contextText}` })
  return messages
}

function errorForStatus(status: number): AtlasError {
  if (status === 401) {
    return new AtlasError('OpenRouter rejected the API key — check the key saved in Settings → OpenRouter.', 'OPENROUTER_UNAUTHORIZED')
  }
  if (status === 402) {
    return new AtlasError('OpenRouter account is out of credits.', 'OPENROUTER_INSUFFICIENT_CREDITS')
  }
  if (status === 429) {
    return new AtlasError('OpenRouter rate-limited this request — try again shortly.', 'OPENROUTER_RATE_LIMITED')
  }
  if (status >= 500) {
    return new AtlasError('OpenRouter is having upstream issues — try again shortly.', 'OPENROUTER_UPSTREAM_ERROR')
  }
  return new AtlasError(`OpenRouter request failed (HTTP ${status}).`, 'OPENROUTER_UPSTREAM_ERROR')
}

export class OpenRouterAdapter implements ProviderAdapter {
  readonly id = 'openrouter'

  supports(modelRef: ModelRef): boolean {
    return modelRef.provider === 'openrouter'
  }

  async runModelCall(input: ModelCallInput): Promise<ModelCallSummary> {
    const apiKey = await getSecret('openrouter-api-key')
    if (!apiKey) {
      throw new AtlasError('OpenRouter is not configured — add a key in Settings → OpenRouter.', 'OPENROUTER_NO_KEY')
    }

    let response: Response
    try {
      response = await fetch(CHAT_COMPLETIONS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: input.modelRef.modelId,
          messages: buildMessages(input)
        })
      })
    } catch {
      throw new AtlasError('Could not reach OpenRouter — check your network connection.', 'OPENROUTER_NETWORK_ERROR')
    }

    if (!response.ok) {
      throw errorForStatus(response.status)
    }

    let body: OpenRouterResponseBody
    try {
      body = (await response.json()) as OpenRouterResponseBody
    } catch {
      throw new AtlasError('OpenRouter returned an unexpected response shape.', 'OPENROUTER_BAD_RESPONSE')
    }

    const outputText = body.choices?.[0]?.message?.content
    if (typeof outputText !== 'string') {
      throw new AtlasError('OpenRouter returned an unexpected response shape.', 'OPENROUTER_BAD_RESPONSE')
    }

    // OpenRouter includes usage accounting in every chat-completion response
    // by default (verified against live docs — see the module comment
    // above), so a successful response with content but no token counts is
    // a genuinely unexpected shape, not a benign omission. Money-spending
    // correctness matters here: silently defaulting missing token counts to
    // 0 would let a real paid call slip past maxCostUsd budget checks and
    // record incorrect usage totals, so fail loudly instead. `cost` alone
    // is still allowed to be absent (e.g. a free/promotional model) without
    // treating the whole response as malformed.
    if (typeof body.usage?.prompt_tokens !== 'number' || typeof body.usage?.completion_tokens !== 'number') {
      throw new AtlasError('OpenRouter response was missing expected usage accounting.', 'OPENROUTER_BAD_RESPONSE')
    }

    const inputTokens = body.usage.prompt_tokens
    const outputTokens = body.usage.completion_tokens
    const estimatedCostUsd = body.usage.cost ?? 0

    return { modelRef: input.modelRef, inputTokens, outputTokens, estimatedCostUsd, outputText }
  }

  async isAvailable(): Promise<boolean> {
    // No cheap probe endpoint worth calling for OpenRouter (the public
    // /api/v1/models catalog doesn't tell us whether *our* key is valid).
    // Callers should rely on a real runModelCall failing with a clear
    // AtlasError instead.
    return true
  }
}
