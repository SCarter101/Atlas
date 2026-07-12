import type { ModelCallSummary, ModelRef } from '@shared/schema/agent'
import type { ModelCallInput, ProviderAdapter } from './types'

// Real seam for a future local LM Studio integration (Settings' "LM Studio
// fallback" toggle). Nothing in this codebase constructs an AgentGoal with
// modelRef.provider === 'lm-studio' today, so this adapter is never actually
// selected — it exists purely so the adapter shape is provably
// implementable, per the confirmed product decision to keep model calls
// simulated in this build.
export class LmStudioAdapter implements ProviderAdapter {
  readonly id = 'lm-studio'

  supports(modelRef: ModelRef): boolean {
    return modelRef.provider === 'lm-studio'
  }

  async runModelCall(_input: ModelCallInput): Promise<ModelCallSummary> {
    throw new Error('LM Studio is not connected in this build — no local server connection exists yet')
  }
}
