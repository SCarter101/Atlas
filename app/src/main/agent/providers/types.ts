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
  // Phase 8: opt-in structured-output request for roles that need a
  // machine-parseable multi-field result (Dev-Editor findings, Dialoguer
  // alternatives, World-Builder proposals, Line-Editor's upgraded
  // multi-finding output) instead of one whole-selection block of prose.
  // `instructions` is appended to the user message describing the exact
  // JSON shape expected — deliberately redundant with the API-level
  // `response_format` flag the real adapters also set, since some
  // OpenRouter-routed models only honor prompt-based formatting
  // instructions, not the API flag. Never sent to the LM Studio fallback
  // call in runModelCallStep() (see simulator.ts) — retrying the same JSON
  // demand on a different local model after the primary already failed for
  // JSON-related reasons is unlikely to help.
  responseFormat?: { type: 'json'; instructions: string }
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
