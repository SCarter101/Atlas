import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { UsageEntry } from '@shared/schema/usage'
import { getUsageSummary, recordUsage } from './usageStore'

function entry(partial: Partial<UsageEntry> & Pick<UsageEntry, 'agentRole' | 'modelRef'>): UsageEntry {
  return {
    runId: 'run-1',
    inputTokens: 100,
    outputTokens: 50,
    estimatedCostUsd: 0.01,
    timestamp: '2026-01-01T00:00:00.000Z',
    ...partial
  }
}

describe('usageStore', () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-usage-test-'))
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  it('returns an all-zero summary when no usage has been recorded yet', async () => {
    const summary = await getUsageSummary(projectRoot)
    expect(summary.totalCostUsd).toBe(0)
    expect(summary.totalTokens).toBe(0)
    expect(summary.byAgentRole).toEqual({})
    expect(summary.byModel).toEqual({})
  })

  it('records a single usage entry and reflects it in the summary', async () => {
    await recordUsage(
      projectRoot,
      entry({ agentRole: 'Generator', modelRef: { provider: 'openrouter', modelId: 'anthropic/claude-sonnet', viaOpenRouter: true } })
    )

    const summary = await getUsageSummary(projectRoot)
    expect(summary.totalCostUsd).toBeCloseTo(0.01)
    expect(summary.totalTokens).toBe(150)
    expect(summary.byAgentRole.Generator).toEqual({ costUsd: 0.01, tokens: 150, calls: 1 })
    expect(summary.byModel['openrouter:anthropic/claude-sonnet']).toEqual({ costUsd: 0.01, tokens: 150, calls: 1 })
  })

  it('aggregates multiple entries across roles and models', async () => {
    await recordUsage(
      projectRoot,
      entry({
        runId: 'run-1',
        agentRole: 'Generator',
        modelRef: { provider: 'openrouter', modelId: 'anthropic/claude-sonnet', viaOpenRouter: true },
        inputTokens: 100,
        outputTokens: 50,
        estimatedCostUsd: 0.01
      })
    )
    await recordUsage(
      projectRoot,
      entry({
        runId: 'run-2',
        agentRole: 'Generator',
        modelRef: { provider: 'openrouter', modelId: 'anthropic/claude-sonnet', viaOpenRouter: true },
        inputTokens: 200,
        outputTokens: 100,
        estimatedCostUsd: 0.02
      })
    )
    await recordUsage(
      projectRoot,
      entry({
        runId: 'run-3',
        agentRole: 'Line-Editor',
        modelRef: { provider: 'lm-studio', modelId: 'local-model', viaOpenRouter: false },
        inputTokens: 50,
        outputTokens: 20,
        estimatedCostUsd: 0
      })
    )

    const summary = await getUsageSummary(projectRoot)
    expect(summary.totalCostUsd).toBeCloseTo(0.03)
    expect(summary.totalTokens).toBe(150 + 300 + 70)
    expect(summary.byAgentRole.Generator).toEqual({ costUsd: 0.03, tokens: 450, calls: 2 })
    expect(summary.byAgentRole['Line-Editor']).toEqual({ costUsd: 0, tokens: 70, calls: 1 })
    expect(summary.byModel['openrouter:anthropic/claude-sonnet'].calls).toBe(2)
    expect(summary.byModel['lm-studio:local-model'].calls).toBe(1)
  })

  it('is append-only across process-like separate calls (JSONL survives multiple writes)', async () => {
    for (let i = 0; i < 5; i++) {
      await recordUsage(
        projectRoot,
        entry({
          runId: `run-${i}`,
          agentRole: 'Dialoguer',
          modelRef: { provider: 'openrouter', modelId: 'openai/gpt-5', viaOpenRouter: true },
          inputTokens: 10,
          outputTokens: 10,
          estimatedCostUsd: 0.001
        })
      )
    }

    const summary = await getUsageSummary(projectRoot)
    expect(summary.byAgentRole.Dialoguer.calls).toBe(5)
    expect(summary.totalTokens).toBe(100)
  })
})
