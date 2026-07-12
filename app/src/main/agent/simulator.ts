import { randomUUID } from 'node:crypto'
import type {
  AgentGoal,
  AgentResult,
  AgentRunRecord,
  AgentStep,
  ModelCallSummary,
  PermissionDecision,
  PermissionRequest,
  SuggestionRef,
  ToolCall
} from '@shared/schema/agent'
import type { AtlasDb } from '../persistence/db'
import { saveAgentRun } from '../persistence/agentRunStore'
import { configuredMcpServers } from '@shared/mcp'

// Phase 2 scope (data-contracts §6): the AgentGoal -> AgentStep[] ->
// AgentRunRecord pipeline, and the permission/session-approval flow, are
// real. Only the model-call step is answered by a canned simulator instead
// of a live OpenRouter/LM Studio request. Swapping in a real provider call
// in Phase 3 means replacing runModelCallSimulated() below — nothing about
// the schema, IPC contract, or UI needs to change.

interface PendingPermission {
  requestId: string
  resolve: (decision: PermissionDecision) => void
}

interface RunState {
  record: AgentRunRecord
  pendingPermission?: PendingPermission
  listeners: Set<(step: AgentStep) => void>
}

export class AgentRunManager {
  private runs = new Map<string, RunState>()

  constructor(
    private readonly projectRoot: string,
    private readonly db: AtlasDb
  ) {}

  start(goal: AgentGoal): { runId: string } {
    const record: AgentRunRecord = {
      schemaVersion: 1,
      goal,
      steps: [],
      status: 'running',
      startedAt: new Date().toISOString()
    }
    this.runs.set(goal.runId, { record, listeners: new Set() })

    // Fire and forget — the renderer subscribes to steps via onStep().
    void this.execute(goal).catch((err) => {
      void this.finish(goal.runId, 'error', { code: 'simulator-error', message: String(err), recoverable: false })
    })

    return { runId: goal.runId }
  }

  onStep(runId: string, cb: (step: AgentStep) => void): () => void {
    const state = this.runs.get(runId)
    if (!state) return () => {}
    // Replay steps already emitted before this subscriber attached.
    for (const step of state.record.steps) cb(step)
    state.listeners.add(cb)
    return () => state.listeners.delete(cb)
  }

  respondToPermission(runId: string, requestId: string, decision: PermissionDecision): void {
    const state = this.runs.get(runId)
    if (!state?.pendingPermission || state.pendingPermission.requestId !== requestId) return
    state.pendingPermission.resolve(decision)
    state.pendingPermission = undefined
  }

  // The only suspension point in the current simulated flow is a pending
  // permission request, so cancelling reuses that same resolution path.
  // Once an agent has real async work between steps (a genuine long-running
  // tool call), this needs a cooperative-cancellation flag checked between
  // steps in execute() — not needed yet since nothing here actually awaits
  // anything but the writer's own decision.
  cancel(runId: string): void {
    const state = this.runs.get(runId)
    if (state?.pendingPermission) {
      state.pendingPermission.resolve('denied')
      state.pendingPermission = undefined
    }
  }

  private emit(runId: string, step: AgentStep): void {
    const state = this.runs.get(runId)
    if (!state) return
    state.record.steps.push(step)
    for (const cb of state.listeners) cb(step)
  }

  private async requestPermission(
    goal: AgentGoal,
    request: Omit<PermissionRequest, 'decision'>
  ): Promise<PermissionDecision> {
    const state = this.runs.get(goal.runId)
    if (!state) return 'denied'

    const decision = await new Promise<PermissionDecision>((resolve) => {
      state.pendingPermission = { requestId: request.requestId, resolve }
      this.emit(goal.runId, {
        stepIndex: state.record.steps.length,
        kind: 'permission-request',
        timestamp: new Date().toISOString(),
        detail: { ...request, decision: 'pending' }
      })
    })

    this.emit(goal.runId, {
      stepIndex: state.record.steps.length,
      kind: 'permission-request',
      timestamp: new Date().toISOString(),
      detail: { ...request, decision }
    })
    return decision
  }

  private async execute(goal: AgentGoal): Promise<void> {
    const state = this.runs.get(goal.runId)
    if (!state) return

    this.emit(goal.runId, {
      stepIndex: state.record.steps.length,
      kind: 'plan',
      timestamp: new Date().toISOString(),
      detail: { summary: planSummaryFor(goal) } satisfies AgentResult
    })

    // Capability discovery checks configured MCP servers alongside the
    // built-in tool/skill library (spec §8) — real extension point, just
    // nothing is configured in this build, so this is a no-op today.
    for (const server of configuredMcpServers) {
      // A real McpAdapter for `server` would be looked up and its
      // discoverTools() merged into the candidate tool list here.
      void server
    }

    if (goal.agentRole === 'Line-Editor') {
      await this.runLineEditor(goal)
      return
    }

    // Other agent roles get a minimal canned result for now — proving the
    // full permission + tool-call pipeline once (Line Editor) is this
    // increment's scope; the remaining roles follow the same pattern.
    const result: AgentResult = {
      summary: `${goal.agentRole} simulation is not yet wired to a canned response for this scope.`,
      warnings: ['This agent role only has a placeholder simulated response in the current build.']
    }
    this.emit(goal.runId, {
      stepIndex: state.record.steps.length,
      kind: 'result',
      timestamp: new Date().toISOString(),
      detail: result
    })
    await this.finish(goal.runId, 'completed')
  }

  private async runLineEditor(goal: AgentGoal): Promise<void> {
    const requestId = randomUUID()
    const decision = await this.requestPermission(goal, {
      requestId,
      capabilityId: 'global.tools.line-edit-scan@1.0.0',
      actionType: 'read-manuscript-selection',
      dataScope: goal.scope.sceneIds?.[0] ? `scene:${goal.scope.sceneIds[0]}` : 'selection',
      destination: 'local'
    })

    if (decision === 'denied') {
      this.emit(goal.runId, {
        stepIndex: 0,
        kind: 'result',
        timestamp: new Date().toISOString(),
        detail: {
          summary: 'Line Editor was not authorized to scan this selection.',
          warnings: ['Permission denied — no changes were made.']
        } satisfies AgentResult
      })
      await this.finish(goal.runId, 'cancelled')
      return
    }

    const state = this.runs.get(goal.runId)
    if (!state) return

    const selection = goal.scope.selectionText ?? ''
    const suggestions = simulateLineEditFindings(selection, goal.scope.sceneIds?.[0])

    const toolCall: ToolCall = {
      toolId: 'global.tools.line-edit-scan@1.0.0',
      input: { selection },
      output: suggestions
    }
    this.emit(goal.runId, {
      stepIndex: state.record.steps.length,
      kind: 'tool-call',
      timestamp: new Date().toISOString(),
      detail: toolCall
    })

    const modelCall: ModelCallSummary = {
      modelRef: goal.modelRef,
      inputTokens: 180 + selection.length,
      outputTokens: 60 + suggestions.length * 40,
      estimatedCostUsd: 0.0021
    }
    this.emit(goal.runId, {
      stepIndex: state.record.steps.length,
      kind: 'model-call',
      timestamp: new Date().toISOString(),
      detail: modelCall
    })

    const result: AgentResult = {
      summary:
        suggestions.length > 0
          ? `Line Editor found ${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'}.`
          : 'Line Editor found no issues in this selection.',
      proposedManuscriptChanges: suggestions
    }
    this.emit(goal.runId, {
      stepIndex: state.record.steps.length,
      kind: 'result',
      timestamp: new Date().toISOString(),
      detail: result
    })

    await this.finish(goal.runId, 'completed')
  }

  private async finish(
    runId: string,
    status: AgentRunRecord['status'],
    error?: { code: string; message: string; recoverable: boolean }
  ): Promise<void> {
    const state = this.runs.get(runId)
    if (!state) return
    state.record.status = status
    state.record.endedAt = new Date().toISOString()
    if (error) {
      this.emit(runId, {
        stepIndex: state.record.steps.length,
        kind: 'result',
        timestamp: state.record.endedAt,
        detail: { summary: error.message, warnings: [error.code] } satisfies AgentResult
      })
    }
    await saveAgentRun(this.projectRoot, this.db, state.record)
  }
}

function planSummaryFor(goal: AgentGoal): string {
  return `${goal.agentRole} received goal "${goal.userIntent}" with a budget of ${goal.constraints.maxToolCalls} tool calls and ${goal.constraints.maxTokens} tokens.`
}

// Canned findings styled on the Phase 1 prototype's sample Line Editor
// suggestions (filter words, adverb overuse, repeated sentence structure) —
// deterministic pattern checks, not a real model call.
function simulateLineEditFindings(selection: string, sceneId?: string): SuggestionRef[] {
  const findings: SuggestionRef[] = []
  const runId = randomUUID()

  if (/\bnoticed that\b/i.test(selection)) {
    findings.push(
      trackedChange(runId, sceneId, 'Filter word', selection, selection.replace(/\bnoticed that\b/i, '').trim())
    )
  }
  if (/\bvery\b/i.test(selection)) {
    findings.push(
      trackedChange(runId, sceneId, 'Adverb overuse', selection, selection.replace(/\bvery\s+/gi, '').trim())
    )
  }
  if (findings.length === 0 && selection.trim().length > 0) {
    findings.push(
      trackedChange(
        runId,
        sceneId,
        'Standard copyedit',
        selection,
        selection // no confident rewrite — placeholder pass-through
      )
    )
  }
  return findings
}

function trackedChange(
  runId: string,
  sceneId: string | undefined,
  category: string,
  before: string,
  after: string
): SuggestionRef {
  return {
    id: randomUUID(),
    agentRole: 'Line-Editor',
    kind: 'tracked-change',
    targetSceneId: sceneId,
    payload: { category, before, after },
    provenance: { capabilityId: 'global.tools.line-edit-scan', capabilityVersion: '1.0.0', runId },
    state: 'pending'
  }
}
