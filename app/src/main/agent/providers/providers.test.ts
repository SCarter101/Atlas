import { describe, expect, it } from 'vitest'
import { selectAdapter } from '../simulator'
import { LmStudioAdapter } from './lmStudioAdapter'
import { OpenRouterAdapter } from './openRouterAdapter'
import { SimulatorAdapter } from './simulatorAdapter'

describe('SimulatorAdapter', () => {
  it('supports every model ref and produces a plausible token/cost triple', async () => {
    const adapter = new SimulatorAdapter()
    expect(adapter.supports({ provider: 'anthropic', modelId: 'x', viaOpenRouter: false })).toBe(true)
    expect(adapter.supports({ provider: 'openrouter', modelId: 'x', viaOpenRouter: true })).toBe(true)

    const summary = await adapter.runModelCall({
      modelRef: { provider: 'anthropic', modelId: 'claude-opus-4', viaOpenRouter: false },
      userIntent: 'test',
      contextText: 'Some selected prose.'
    })

    expect(summary.inputTokens).toBeGreaterThan(0)
    expect(summary.outputTokens).toBeGreaterThan(0)
    expect(summary.estimatedCostUsd).toBeGreaterThan(0)
    expect(summary.modelRef.modelId).toBe('claude-opus-4')
  })
})

// runModelCall behavior (success/failure/error-mapping) for the real
// OpenRouter/LM Studio adapters is covered in the dedicated
// openRouterAdapter.test.ts / lmStudioAdapter.test.ts files (Phase 6) — kept
// here to just the provider-matching contract every adapter shares.
describe('OpenRouterAdapter / LmStudioAdapter', () => {
  it('only support their own provider', () => {
    const openRouter = new OpenRouterAdapter()
    expect(openRouter.supports({ provider: 'openrouter', modelId: 'x', viaOpenRouter: true })).toBe(true)
    expect(openRouter.supports({ provider: 'anthropic', modelId: 'x', viaOpenRouter: false })).toBe(false)

    const lmStudio = new LmStudioAdapter()
    expect(lmStudio.supports({ provider: 'lm-studio', modelId: 'x', viaOpenRouter: false })).toBe(true)
    expect(lmStudio.supports({ provider: 'anthropic', modelId: 'x', viaOpenRouter: false })).toBe(false)
  })
})

describe('selectAdapter', () => {
  it('falls back to the simulator adapter for providers with no real adapter', () => {
    expect(selectAdapter({ provider: 'anthropic', modelId: 'x', viaOpenRouter: false }).id).toBe('simulator')
    expect(selectAdapter({ provider: 'google', modelId: 'x', viaOpenRouter: false }).id).toBe('simulator')
  })

  it('selects the real (but unconfigured) adapter when the provider matches', () => {
    expect(selectAdapter({ provider: 'openrouter', modelId: 'x', viaOpenRouter: true }).id).toBe('openrouter')
    expect(selectAdapter({ provider: 'lm-studio', modelId: 'x', viaOpenRouter: false }).id).toBe('lm-studio')
  })
})
