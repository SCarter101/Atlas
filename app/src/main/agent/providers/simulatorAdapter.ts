import type { ModelCallSummary, ModelRef } from '@shared/schema/agent'
import type { ModelCallInput, ProviderAdapter } from './types'

// Guaranteed fallback adapter — the only one actually reachable in this
// build (see openRouterAdapter.ts / lmStudioAdapter.ts). Replaces the five
// near-duplicate ModelCallSummary-construction blocks that used to be
// inlined in each run<Role>() method in simulator.ts with one shared
// implementation, using the same rough arithmetic style those blocks used
// (a base token count plus a function of the input text's length).
export class SimulatorAdapter implements ProviderAdapter {
  readonly id = 'simulator'

  supports(_modelRef: ModelRef): boolean {
    return true
  }

  async runModelCall(input: ModelCallInput): Promise<ModelCallSummary> {
    const inputTokens = 180 + input.contextText.length
    const outputTokens = 80 + Math.ceil(input.contextText.length / 3)
    const estimatedCostUsd = Number(((inputTokens + outputTokens) * 0.000012).toFixed(4))
    return { modelRef: input.modelRef, inputTokens, outputTokens, estimatedCostUsd }
  }

  async isAvailable(): Promise<boolean> {
    return true
  }
}
