import type { ModelCallSummary, ModelRef } from '@shared/schema/agent'
import { AtlasError } from '@shared/errors'
import type { ModelCallInput, ProviderAdapter } from './types'

// Real seam for a local LM Studio integration (Settings' "LM Studio
// fallback" toggle, Phase 6). LM Studio exposes an OpenAI-compatible local
// server; no configurability UI exists yet for the base URL, so it's a
// simple internal constant for now.
const BASE_URL = 'http://localhost:1234/v1'

interface LmStudioMessage {
  role: 'system' | 'user'
  content: string
}

interface LmStudioResponseBody {
  choices?: Array<{ message?: { content?: string } }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
  }
}

function buildMessages(input: ModelCallInput): LmStudioMessage[] {
  const messages: LmStudioMessage[] = []
  if (input.systemPrompt) messages.push({ role: 'system', content: input.systemPrompt })
  const userContent =
    input.responseFormat?.type === 'json'
      ? `${input.userIntent}\n\n${input.contextText}\n\n${input.responseFormat.instructions}`
      : `${input.userIntent}\n\n${input.contextText}`
  messages.push({ role: 'user', content: userContent })
  return messages
}

// Rough length-based estimate, same style SimulatorAdapter uses — only used
// as a fallback when LM Studio's OpenAI-compat server doesn't report real
// usage counts (not all local server builds do).
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

export class LmStudioAdapter implements ProviderAdapter {
  readonly id = 'lm-studio'

  supports(modelRef: ModelRef): boolean {
    return modelRef.provider === 'lm-studio'
  }

  async runModelCall(input: ModelCallInput): Promise<ModelCallSummary> {
    let response: Response
    try {
      response = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: input.modelRef.modelId,
          messages: buildMessages(input),
          ...(input.responseFormat?.type === 'json' ? { response_format: { type: 'json_object' } } : {})
        })
      })
    } catch {
      throw new AtlasError(
        `LM Studio is not connected — could not reach ${BASE_URL}. Start its local server in LM Studio's Developer tab.`,
        'LM_STUDIO_UNREACHABLE'
      )
    }

    if (!response.ok) {
      throw new AtlasError(`LM Studio request failed (HTTP ${response.status}).`, 'LM_STUDIO_UPSTREAM_ERROR')
    }

    let body: LmStudioResponseBody
    try {
      body = (await response.json()) as LmStudioResponseBody
    } catch {
      throw new AtlasError('LM Studio returned an unexpected response shape.', 'LM_STUDIO_BAD_RESPONSE')
    }

    const outputText = body.choices?.[0]?.message?.content
    if (typeof outputText !== 'string') {
      throw new AtlasError('LM Studio returned an unexpected response shape.', 'LM_STUDIO_BAD_RESPONSE')
    }

    const messageText = buildMessages(input)
      .map((m) => m.content)
      .join('\n')
    const inputTokens = body.usage?.prompt_tokens ?? estimateTokens(messageText)
    const outputTokens = body.usage?.completion_tokens ?? estimateTokens(outputText)
    // LM Studio runs models locally — there is no per-token billing, so cost
    // is always 0 rather than an estimate that would imply real spend.
    const estimatedCostUsd = 0

    return { modelRef: input.modelRef, inputTokens, outputTokens, estimatedCostUsd, outputText }
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
