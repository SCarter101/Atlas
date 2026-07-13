import type { ModelCallSummary, ModelRef } from '@shared/schema/agent'

// Minimal shape a simulator (or, later, a real provider) needs to produce a
// plausible ModelCallSummary — deliberately not a full chat-message-array
// shape, since nothing in this build sends anything more than a single
// selection/intent pair to a "model".
export interface ModelCallInput {
  modelRef: ModelRef
  systemPrompt?: string
  userIntent: string
  contextText: string
}

export interface ProviderAdapter {
  readonly id: string
  supports(modelRef: ModelRef): boolean
  runModelCall(input: ModelCallInput): Promise<ModelCallSummary>
  // Cheap reachability probe (no cost, no model call) — SimulatorAdapter is
  // trivially always available; LmStudioAdapter does a real GET /models
  // probe against its local server; OpenRouterAdapter has no cheap probe
  // endpoint worth calling, so it always reports true and relies on a real
  // runModelCall failing loudly instead (see openRouterAdapter.ts).
  isAvailable(): Promise<boolean>
}
