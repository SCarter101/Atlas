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
}
