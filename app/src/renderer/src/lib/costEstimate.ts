import type { ModelRef } from '@shared/schema/agent'
import type { OpenRouterCatalogEntry } from '@shared/schema/models'

// Fallback blended per-1K-token rate used when a model isn't found in the
// OpenRouter catalog (e.g. the catalog fetch failed, or the writer typed a
// model id that predates the last cache refresh) — same order of magnitude
// as the old flat illustrative table this replaced, so the UI never shows
// $0 for a real cloud model just because the catalog lookup came up empty.
const FALLBACK_RATE_PER_1K_TOKENS = 0.01

// Pre-flight cost estimate shown before a run starts (spec §8: "Atlas
// should show a plain-language pre-flight estimate"). Simulator and LM
// Studio (local) calls are always free; OpenRouter calls are priced off the
// live catalog when available. Illustrative, not billing-accurate.
export function estimateAgentCost(
  selectionText: string,
  modelRef: ModelRef,
  catalog: OpenRouterCatalogEntry[]
): { tokens: number; costUsd: number } {
  const tokens = 180 + selectionText.length + 150

  if (modelRef.provider === 'simulator' || modelRef.provider === 'lm-studio') {
    return { tokens, costUsd: 0 }
  }

  if (modelRef.provider === 'openrouter') {
    const catalogEntry = catalog.find((entry) => entry.id === modelRef.modelId)
    if (catalogEntry) {
      // OpenRouter reports pricing.prompt / pricing.completion as per-token
      // USD strings (e.g. "0.000001"), not per-1K or per-1M — verified
      // directly against the live /api/v1/models response. This estimate
      // doesn't split the token count into input/output, so it blends the
      // two per-token rates into one average before applying it.
      const promptRate = Number(catalogEntry.pricing.prompt)
      const completionRate = Number(catalogEntry.pricing.completion)
      const blendedPerTokenRate =
        Number.isFinite(promptRate) && Number.isFinite(completionRate) ? (promptRate + completionRate) / 2 : NaN
      if (Number.isFinite(blendedPerTokenRate)) {
        return { tokens, costUsd: tokens * blendedPerTokenRate }
      }
    }
    return { tokens, costUsd: (tokens / 1000) * FALLBACK_RATE_PER_1K_TOKENS }
  }

  // anthropic/openai/google direct (non-OpenRouter) provider refs: no
  // catalog for these yet in this build, so use the same illustrative
  // fallback rate.
  return { tokens, costUsd: (tokens / 1000) * FALLBACK_RATE_PER_1K_TOKENS }
}
