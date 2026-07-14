import type { ModelRef } from '@shared/schema/agent'
import type { SummaryPromptPair } from '@shared/summaryPrompts'
import { LmStudioAdapter } from '../agent/providers/lmStudioAdapter'
import { OpenRouterAdapter } from '../agent/providers/openRouterAdapter'
import type { ModelCallInput, ProviderAdapter } from '../agent/providers/types'
import { recordUsage } from './usageStore'

// Phase 7: both rolling summaries (summaryStore.ts) and derived summaries
// (derivedSummaryStore.ts) attempt a real model call before falling back to
// their extractive heuristic. Confirmed fallback order (the writer's
// explicit instruction, not up for reinterpretation): local LM Studio first,
// then OpenRouter, then the heuristic. This module is the one place that
// chain is implemented, so both stores stay in sync and there is exactly one
// spot to fix if the order or error handling ever needs to change.
//
// Neither summary generator has a per-project/per-role model selection of
// its own (unlike agent runs, which route through the writer's chosen
// agentModels in main/agent/simulator.ts) — these ModelRefs are fixed
// constants for a low-stakes background utility call.
const LM_STUDIO_MODEL_REF: ModelRef = { provider: 'lm-studio', modelId: 'local-summarizer', viaOpenRouter: false }
// OpenRouter's meta-routing model ("openrouter/auto") is a real, documented
// OpenRouter feature that lets OpenRouter pick a suitable underlying model
// automatically — appropriate here since summary generation has no
// writer-configured model to route through.
const OPENROUTER_MODEL_REF: ModelRef = { provider: 'openrouter', modelId: 'openrouter/auto', viaOpenRouter: true }

export interface ModelSummaryResult {
  text: string
  modelRef: ModelRef
}

interface FallbackTier {
  adapter: ProviderAdapter
  modelRef: ModelRef
}

function tiers(): FallbackTier[] {
  return [
    { adapter: new LmStudioAdapter(), modelRef: LM_STUDIO_MODEL_REF },
    { adapter: new OpenRouterAdapter(), modelRef: OPENROUTER_MODEL_REF }
  ]
}

// Tries LM Studio, then OpenRouter, in order. Returns null (meaning "the
// caller should fall back to its extractive heuristic") only when both real
// tiers fail outright or return unusable output — never throws. A
// successful call's usage is recorded under callKind: 'summary-generation'
// with the given label so it's attributable in Settings' usage/cost view.
export async function generateSummaryViaModel(
  projectRoot: string,
  label: string,
  prompt: SummaryPromptPair,
  contextText: string
): Promise<ModelSummaryResult | null> {
  const baseInput: Omit<ModelCallInput, 'modelRef'> = {
    systemPrompt: prompt.systemPrompt,
    userIntent: prompt.userIntent,
    contextText
  }

  for (const { adapter, modelRef } of tiers()) {
    let result
    try {
      result = await adapter.runModelCall({ ...baseInput, modelRef })
    } catch {
      // This tier failed (not configured, unreachable, upstream error, bad
      // response, ...) — try the next one.
      continue
    }

    const text = result.outputText?.trim()
    if (!text) continue

    await recordUsage(projectRoot, {
      callKind: 'summary-generation',
      label,
      modelRef: result.modelRef,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      estimatedCostUsd: result.estimatedCostUsd,
      timestamp: new Date().toISOString()
    }).catch((err) => console.error('[usage] failed to record summary-generation call', err))

    return { text, modelRef: result.modelRef }
  }

  return null
}
