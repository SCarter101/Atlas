import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentGoal, AgentRunRecord, SuggestionRef } from '@shared/schema/agent'

const { openIndexDb } = await import('../persistence/db')
const { saveAgentRun } = await import('../persistence/agentRunStore')
const { detectRepeatedToolPattern, applyContradictionWarnings } = await import('./simulator')

function makeGoal(runId: string): AgentGoal {
  return {
    runId,
    agentRole: 'Dialoguer',
    modelRef: { provider: 'anthropic', modelId: 'claude-opus-4', viaOpenRouter: false },
    userIntent: 'Send selected dialogue to Dialogue Editor',
    scope: { sceneIds: ['scene-001'], selectionText: '"Fine," she said.' },
    constraints: {
      maxTurns: 4,
      maxTokens: 4000,
      maxToolCalls: 3,
      maxElapsedMs: 30000,
      allowedCapabilityCategories: ['dialogue-scan']
    }
  }
}

function completedRunWithToolCall(runId: string, toolId: string): AgentRunRecord {
  const goal = makeGoal(runId)
  return {
    schemaVersion: 1,
    goal,
    status: 'completed',
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    steps: [
      {
        stepIndex: 0,
        kind: 'tool-call',
        timestamp: new Date().toISOString(),
        detail: { toolId, input: {} }
      }
    ]
  }
}

describe('detectRepeatedToolPattern', () => {
  let projectRoot: string
  let db: Awaited<ReturnType<typeof openIndexDb>>

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-repeated-pattern-'))
    db = await openIndexDb(projectRoot)
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  it('returns undefined below the occurrence threshold', async () => {
    await saveAgentRun(projectRoot, db, completedRunWithToolCall('run-1', 'global.tools.codex-search'))
    await saveAgentRun(projectRoot, db, completedRunWithToolCall('run-2', 'global.tools.codex-search'))

    const match = await detectRepeatedToolPattern(projectRoot, db, 'Dialoguer')
    expect(match).toBeUndefined()
  })

  it('flags a tool called across 3+ separate completed runs for the same role', async () => {
    await saveAgentRun(projectRoot, db, completedRunWithToolCall('run-1', 'global.tools.codex-search'))
    await saveAgentRun(projectRoot, db, completedRunWithToolCall('run-2', 'global.tools.codex-search'))
    await saveAgentRun(projectRoot, db, completedRunWithToolCall('run-3', 'global.tools.codex-search'))

    const match = await detectRepeatedToolPattern(projectRoot, db, 'Dialoguer')
    expect(match).toBeDefined()
    expect(match?.toolId).toBe('global.tools.codex-search')
    expect(match?.occurrences).toBe(3)
    expect(match?.runIds.sort()).toEqual(['run-1', 'run-2', 'run-3'])
  })

  it('does not count a tool called multiple times within a single run as multiple occurrences', async () => {
    const goal = makeGoal('run-1')
    const record: AgentRunRecord = {
      schemaVersion: 1,
      goal,
      status: 'completed',
      startedAt: new Date().toISOString(),
      steps: [
        { stepIndex: 0, kind: 'tool-call', timestamp: new Date().toISOString(), detail: { toolId: 'global.tools.codex-search', input: {} } },
        { stepIndex: 1, kind: 'tool-call', timestamp: new Date().toISOString(), detail: { toolId: 'global.tools.codex-search', input: {} } }
      ]
    }
    await saveAgentRun(projectRoot, db, record)
    await saveAgentRun(projectRoot, db, completedRunWithToolCall('run-2', 'global.tools.codex-search'))
    await saveAgentRun(projectRoot, db, completedRunWithToolCall('run-3', 'global.tools.codex-search'))

    const match = await detectRepeatedToolPattern(projectRoot, db, 'Dialoguer')
    expect(match?.occurrences).toBe(3)
  })

  it('ignores runs for a different agent role', async () => {
    const otherRoleRecord = completedRunWithToolCall('run-1', 'global.tools.codex-search')
    otherRoleRecord.goal = { ...otherRoleRecord.goal, agentRole: 'Generator' }
    await saveAgentRun(projectRoot, db, otherRoleRecord)
    await saveAgentRun(projectRoot, db, completedRunWithToolCall('run-2', 'global.tools.codex-search'))
    await saveAgentRun(projectRoot, db, completedRunWithToolCall('run-3', 'global.tools.codex-search'))

    const match = await detectRepeatedToolPattern(projectRoot, db, 'Dialoguer')
    expect(match).toBeUndefined()
  })
})

describe('applyContradictionWarnings', () => {
  function proposal(id: string): SuggestionRef {
    return {
      id,
      agentRole: 'World-Builder',
      kind: 'codex-addition',
      payload: { entryType: 'location', name: 'Test Place', summary: 'A place.', citations: [] },
      provenance: { runId: 'run-1' },
      state: 'pending'
    }
  }

  it('appends a low-reliability warning citation only to flagged proposals', () => {
    const proposals = [proposal('a'), proposal('b')]
    const note = { contradictions: [['a', ['Conflicts with "Existing Place" on "summary"']]] as [string, string[]][] }

    const result = applyContradictionWarnings(proposals, note)

    const flagged = result.find((p) => p.id === 'a')!
    const untouched = result.find((p) => p.id === 'b')!
    const flaggedPayload = flagged.payload as { citations: { note: string; reliability: string }[] }
    const untouchedPayload = untouched.payload as { citations: { note: string; reliability: string }[] }

    expect(flaggedPayload.citations).toHaveLength(1)
    expect(flaggedPayload.citations[0].reliability).toBe('low')
    expect(flaggedPayload.citations[0].note).toContain('Existing Place')
    expect(untouchedPayload.citations).toHaveLength(0)
  })

  it('is a no-op when no proposal ids are flagged', () => {
    const proposals = [proposal('a')]
    const result = applyContradictionWarnings(proposals, { contradictions: [] })
    expect(result).toEqual(proposals)
  })
})
