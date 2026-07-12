// Rough per-1K-token blended rates for the pre-flight estimate shown before
// a run starts (spec §8: "Atlas should show a plain-language pre-flight
// estimate"). Illustrative, not billing-accurate — real per-provider
// pricing is a Phase 3+ concern once calls are real.
const RATE_PER_1K_TOKENS: Record<string, number> = {
  'Claude Opus 4': 0.02,
  'Claude Sonnet 4': 0.006,
  'GPT-4.1': 0.005,
  'Gemini 1.5 Pro': 0.0035,
  'Local (LM Studio)': 0
}

export function estimateAgentCost(selectionText: string, modelId: string): { tokens: number; costUsd: number } {
  const tokens = 180 + selectionText.length + 150
  const rate = RATE_PER_1K_TOKENS[modelId] ?? 0.01
  return { tokens, costUsd: (tokens / 1000) * rate }
}
