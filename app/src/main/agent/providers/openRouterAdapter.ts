import type { ModelCallSummary, ModelRef } from '@shared/schema/agent'
import type { ModelCallInput, ProviderAdapter } from './types'

// Real seam for a future OpenRouter integration (spec §13). Nothing in this
// codebase constructs an AgentGoal with modelRef.provider === 'openrouter'
// today, so this adapter is never actually selected — it exists purely so
// the adapter shape is provably implementable, per the confirmed product
// decision to keep model calls simulated in this build.
export class OpenRouterAdapter implements ProviderAdapter {
  readonly id = 'openrouter'

  supports(modelRef: ModelRef): boolean {
    return modelRef.provider === 'openrouter'
  }

  async runModelCall(_input: ModelCallInput): Promise<ModelCallSummary> {
    throw new Error('OpenRouter is not configured in this build — no API key vault exists yet (spec §13)')
  }
}
