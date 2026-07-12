import { randomUUID } from 'node:crypto'
import type {
  AgentGoal,
  AgentResult,
  AgentRunRecord,
  AgentStep,
  ModelCallSummary,
  ModelRef,
  PermissionDecision,
  PermissionRequest,
  SuggestionRef,
  ToolCall
} from '@shared/schema/agent'
import type { AtlasDb } from '../persistence/db'
import { saveAgentRun } from '../persistence/agentRunStore'
import { listCodexEntries } from '../persistence/codexStore'
import { configuredMcpServers } from '@shared/mcp'
import { listCapabilities } from '../capabilities/registry'
import { runSandboxed } from '../capabilities/sandbox'
import { getSeedTool } from '../capabilities/seedTools'
import { buildSessionApproval, SessionApprovalStore } from '../permissions/sessionApprovals'
import { LmStudioAdapter } from './providers/lmStudioAdapter'
import { OpenRouterAdapter } from './providers/openRouterAdapter'
import { SimulatorAdapter } from './providers/simulatorAdapter'
import type { ProviderAdapter } from './providers/types'

// Phase 2 scope (data-contracts §6): the AgentGoal -> AgentStep[] ->
// AgentRunRecord pipeline, and the permission/session-approval flow, are
// real. Phase 3 makes the provider *architecture* real and swappable — see
// providers/ — while keeping the model call itself simulated (a confirmed
// product decision, not revisited here): selectAdapter() below tries a real
// OpenRouter/LM Studio adapter first and falls back to SimulatorAdapter,
// which is the only one ever actually reached today since nothing
// constructs an AgentGoal with those providers. Phase 3 also adds enforced
// budgets/duplicate-action detection and a real capability registry +
// sandbox (see ../capabilities) — Dev-Editor's run now folds one real data
// point (a live Codex contradiction check) into its otherwise-simulated
// findings.

const adapters: ProviderAdapter[] = [new OpenRouterAdapter(), new LmStudioAdapter(), new SimulatorAdapter()]

export function selectAdapter(modelRef: ModelRef): ProviderAdapter {
  for (const adapter of adapters) {
    if (adapter.supports(modelRef)) return adapter
  }
  return adapters[adapters.length - 1]
}

function toolSignature(toolId: string, input: unknown): string {
  return `${toolId}:${JSON.stringify(input)}`
}

// Risk 4 ("detect repeated or circular actions, stop runaway loops"): true
// once `newSignature` would be the threshold-th occurrence among
// `recentSignatures`. Every current run<Role>() method only ever makes one
// tool call per run (they're single-shot, not iterative loops), so this
// never actually fires on a real run path today — it's exercised directly
// by simulator.budget.test.ts as a pure function instead.
export function detectDuplicateAction(recentSignatures: string[], newSignature: string, threshold = 3): boolean {
  const occurrences = recentSignatures.filter((s) => s === newSignature).length
  return occurrences >= threshold - 1
}

interface PendingPermission {
  requestId: string
  resolve: (decision: PermissionDecision) => void
}

interface RunBudget {
  turnsUsed: number
  toolCallsUsed: number
  tokensUsed: number
  costUsdUsed: number
  startedAtMs: number
  recentSignatures: string[]
}

interface RunState {
  record: AgentRunRecord
  pendingPermission?: PendingPermission
  listeners: Set<(step: AgentStep) => void>
  budget: RunBudget
}

export class AgentRunManager {
  private runs = new Map<string, RunState>()

  constructor(
    private readonly projectRoot: string,
    private readonly db: AtlasDb,
    private readonly approvals: SessionApprovalStore = new SessionApprovalStore()
  ) {}

  start(goal: AgentGoal): { runId: string } {
    const record: AgentRunRecord = {
      schemaVersion: 1,
      goal,
      steps: [],
      status: 'running',
      startedAt: new Date().toISOString()
    }
    this.runs.set(goal.runId, {
      record,
      listeners: new Set(),
      budget: { turnsUsed: 0, toolCallsUsed: 0, tokensUsed: 0, costUsdUsed: 0, startedAtMs: Date.now(), recentSignatures: [] }
    })

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

    // Spec §13: an existing session approval covering the exact named
    // capability/actionType/dataScope/destination skips the round-trip
    // entirely — matches the renderer's existing auto-resolve behavior
    // (state/store.ts's handleAgentStep), now backed by a real main-process
    // store instead of only a client-side fake.
    const existing = this.approvals.checkApproval({
      capabilityId: request.capabilityId,
      actionType: request.actionType,
      dataScope: request.dataScope,
      destination: request.destination
    })
    if (existing) {
      this.emit(goal.runId, {
        stepIndex: state.record.steps.length,
        kind: 'permission-request',
        timestamp: new Date().toISOString(),
        detail: { ...request, decision: 'approved-session' }
      })
      return 'approved-session'
    }

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

    if (decision === 'approved-session') {
      this.approvals.grantApproval(buildSessionApproval(request))
    }

    return decision
  }

  // Checked right before each tool-call emission — do NOT execute the tool
  // call if it would exceed maxToolCalls or the run is already past
  // maxElapsedMs. A distinct terminal path from permission-denied: distinct
  // message, and status 'cancelled' rather than an error.
  private async guardToolCall(goal: AgentGoal, agentDisplayName: string): Promise<boolean> {
    const state = this.runs.get(goal.runId)
    if (!state) return true
    const budget = state.budget

    let reason: string | undefined
    if (budget.toolCallsUsed + 1 > goal.constraints.maxToolCalls) {
      reason = `tool-call budget (${goal.constraints.maxToolCalls}) reached before a result could be produced.`
    } else if (Date.now() - budget.startedAtMs > goal.constraints.maxElapsedMs) {
      reason = `time budget (${goal.constraints.maxElapsedMs}ms) was exceeded before a result could be produced.`
    }

    if (!reason) return false
    await this.stopForBudget(goal, agentDisplayName, reason)
    return true
  }

  // Checked right before each model-call emission, using the adapter's
  // already-computed token/cost numbers rather than a pre-estimate.
  private async guardModelCall(goal: AgentGoal, agentDisplayName: string, modelCall: ModelCallSummary): Promise<boolean> {
    const state = this.runs.get(goal.runId)
    if (!state) return true
    const budget = state.budget

    let reason: string | undefined
    if (budget.tokensUsed + modelCall.inputTokens + modelCall.outputTokens > goal.constraints.maxTokens) {
      reason = `token budget (${goal.constraints.maxTokens}) would be exceeded before a result could be produced.`
    } else if (Date.now() - budget.startedAtMs > goal.constraints.maxElapsedMs) {
      reason = `time budget (${goal.constraints.maxElapsedMs}ms) was exceeded before a result could be produced.`
    } else if (
      goal.constraints.maxCostUsd !== undefined &&
      budget.costUsdUsed + modelCall.estimatedCostUsd > goal.constraints.maxCostUsd
    ) {
      reason = `cost budget ($${goal.constraints.maxCostUsd.toFixed(2)}) would be exceeded before a result could be produced.`
    }

    if (!reason) return false
    await this.stopForBudget(goal, agentDisplayName, reason)
    return true
  }

  private async guardDuplicateAction(goal: AgentGoal, agentDisplayName: string, signature: string): Promise<boolean> {
    const state = this.runs.get(goal.runId)
    if (!state) return true
    if (detectDuplicateAction(state.budget.recentSignatures, signature)) {
      await this.stopForBudget(
        goal,
        agentDisplayName,
        'the same tool call was attempted repeatedly — stopping to avoid a runaway loop.',
        'duplicate-action-detected'
      )
      return true
    }
    state.budget.recentSignatures.push(signature)
    return false
  }

  private async stopForBudget(
    goal: AgentGoal,
    agentDisplayName: string,
    reason: string,
    warningCode: string = 'budget-exceeded'
  ): Promise<void> {
    const state = this.runs.get(goal.runId)
    if (!state) return
    this.emit(goal.runId, {
      stepIndex: state.record.steps.length,
      kind: 'result',
      timestamp: new Date().toISOString(),
      detail: { summary: `${agentDisplayName} stopped: ${reason}`, warnings: [warningCode] } satisfies AgentResult
    })
    await this.finish(goal.runId, 'cancelled')
  }

  private async runModelCallStep(goal: AgentGoal, selection: string): Promise<ModelCallSummary> {
    return selectAdapter(goal.modelRef).runModelCall({
      modelRef: goal.modelRef,
      userIntent: goal.userIntent,
      contextText: selection
    })
  }

  private recordModelCall(goal: AgentGoal, modelCall: ModelCallSummary): void {
    const state = this.runs.get(goal.runId)
    if (!state) return
    state.budget.tokensUsed += modelCall.inputTokens + modelCall.outputTokens
    state.budget.costUsdUsed += modelCall.estimatedCostUsd
    state.budget.turnsUsed += 1
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

    switch (goal.agentRole) {
      case 'Line-Editor':
        await this.runLineEditor(goal)
        return
      case 'Generator':
        await this.runGenerator(goal)
        return
      case 'Dev-Editor':
        await this.runDevEditor(goal)
        return
      case 'Dialoguer':
        await this.runDialoguer(goal)
        return
      case 'World-Builder':
        await this.runWorldBuilder(goal)
        return
    }
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

    if (await this.guardToolCall(goal, 'Line Editor')) return

    const selection = goal.scope.selectionText ?? ''
    const toolInput = { selection }
    if (await this.guardDuplicateAction(goal, 'Line Editor', toolSignature('global.tools.line-edit-scan@1.0.0', toolInput))) {
      return
    }

    const suggestions = simulateLineEditFindings(selection, goal.scope.sceneIds?.[0])

    const toolCall: ToolCall = {
      toolId: 'global.tools.line-edit-scan@1.0.0',
      input: toolInput,
      output: suggestions
    }
    this.emit(goal.runId, {
      stepIndex: state.record.steps.length,
      kind: 'tool-call',
      timestamp: new Date().toISOString(),
      detail: toolCall
    })
    state.budget.toolCallsUsed += 1

    const modelCall = await this.runModelCallStep(goal, selection)
    if (await this.guardModelCall(goal, 'Line Editor', modelCall)) return
    this.emit(goal.runId, {
      stepIndex: state.record.steps.length,
      kind: 'model-call',
      timestamp: new Date().toISOString(),
      detail: modelCall
    })
    this.recordModelCall(goal, modelCall)

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

  private async runGenerator(goal: AgentGoal): Promise<void> {
    const requestId = randomUUID()
    const decision = await this.requestPermission(goal, {
      requestId,
      capabilityId: 'global.tools.prose-continuation@1.0.0',
      actionType: 'generate-continuation',
      dataScope: goal.scope.sceneIds?.[0] ? `scene:${goal.scope.sceneIds[0]}` : 'selection',
      destination: 'local'
    })

    if (decision === 'denied') {
      this.emit(goal.runId, {
        stepIndex: 0,
        kind: 'result',
        timestamp: new Date().toISOString(),
        detail: {
          summary: 'Generator was not authorized to read this selection.',
          warnings: ['Permission denied — no changes were made.']
        } satisfies AgentResult
      })
      await this.finish(goal.runId, 'cancelled')
      return
    }

    const state = this.runs.get(goal.runId)
    if (!state) return

    if (await this.guardToolCall(goal, 'Generator')) return

    const selection = goal.scope.selectionText ?? ''
    const toolInput = { selection }
    if (
      await this.guardDuplicateAction(goal, 'Generator', toolSignature('global.tools.prose-continuation@1.0.0', toolInput))
    ) {
      return
    }

    const suggestions = simulateGeneratorContinuation(selection, goal.scope.sceneIds?.[0])

    const toolCall: ToolCall = {
      toolId: 'global.tools.prose-continuation@1.0.0',
      input: toolInput,
      output: suggestions
    }
    this.emit(goal.runId, {
      stepIndex: state.record.steps.length,
      kind: 'tool-call',
      timestamp: new Date().toISOString(),
      detail: toolCall
    })
    state.budget.toolCallsUsed += 1

    const modelCall = await this.runModelCallStep(goal, selection)
    if (await this.guardModelCall(goal, 'Generator', modelCall)) return
    this.emit(goal.runId, {
      stepIndex: state.record.steps.length,
      kind: 'model-call',
      timestamp: new Date().toISOString(),
      detail: modelCall
    })
    this.recordModelCall(goal, modelCall)

    const result: AgentResult = {
      summary: `Generator drafted ${suggestions.length} continuation${suggestions.length === 1 ? '' : 's'}.`,
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

  private async runDevEditor(goal: AgentGoal): Promise<void> {
    const requestId = randomUUID()
    const decision = await this.requestPermission(goal, {
      requestId,
      capabilityId: 'global.tools.structural-analysis@1.0.0',
      actionType: 'analyze-structure',
      dataScope: goal.scope.sceneIds?.[0] ? `scene:${goal.scope.sceneIds[0]}` : 'selection',
      destination: 'local'
    })

    if (decision === 'denied') {
      this.emit(goal.runId, {
        stepIndex: 0,
        kind: 'result',
        timestamp: new Date().toISOString(),
        detail: {
          summary: 'Story Editor was not authorized to analyze this selection.',
          warnings: ['Permission denied — no changes were made.']
        } satisfies AgentResult
      })
      await this.finish(goal.runId, 'cancelled')
      return
    }

    const state = this.runs.get(goal.runId)
    if (!state) return

    if (await this.guardToolCall(goal, 'Story Editor')) return

    const selection = goal.scope.selectionText ?? ''
    const toolInput = { selection }
    if (
      await this.guardDuplicateAction(goal, 'Story Editor', toolSignature('global.tools.structural-analysis@1.0.0', toolInput))
    ) {
      return
    }

    const suggestions = simulateStructuralFindings(selection, goal.scope.sceneIds?.[0])

    // The one real thing Story Editor does in this build: discover the real
    // codex-contradiction-check capability via the registry and, if it's
    // enabled and compatible with this role, actually run it (through the
    // sandbox) against the project's real Codex entries — augmenting the
    // simulated structural findings with one genuine data point, not
    // replacing them.
    const contradictionNote = await this.checkCodexContradictions(goal)

    const toolCall: ToolCall = {
      toolId: 'global.tools.structural-analysis@1.0.0',
      input: toolInput,
      output: contradictionNote ? { findings: suggestions, codexContradictionCheck: contradictionNote } : suggestions
    }
    this.emit(goal.runId, {
      stepIndex: state.record.steps.length,
      kind: 'tool-call',
      timestamp: new Date().toISOString(),
      detail: toolCall
    })
    state.budget.toolCallsUsed += 1

    const modelCall = await this.runModelCallStep(goal, selection)
    if (await this.guardModelCall(goal, 'Story Editor', modelCall)) return
    this.emit(goal.runId, {
      stepIndex: state.record.steps.length,
      kind: 'model-call',
      timestamp: new Date().toISOString(),
      detail: modelCall
    })
    this.recordModelCall(goal, modelCall)

    const result: AgentResult = {
      summary: `Story Editor found ${suggestions.length} structural note${suggestions.length === 1 ? '' : 's'}.${
        contradictionNote ? ` ${contradictionNote.summary}` : ''
      }`,
      proposedManuscriptChanges: suggestions,
      warnings: contradictionNote ? [contradictionNote.summary] : undefined
    }
    this.emit(goal.runId, {
      stepIndex: state.record.steps.length,
      kind: 'result',
      timestamp: new Date().toISOString(),
      detail: result
    })

    await this.finish(goal.runId, 'completed')
  }

  private async checkCodexContradictions(
    goal: AgentGoal
  ): Promise<{ summary: string; contradictions: [string, string[]][] } | undefined> {
    try {
      const capabilities = await listCapabilities(this.projectRoot)
      const capability = capabilities.find(
        (c) =>
          c.id === 'global.tools.codex-contradiction-check' &&
          c.lifecycleState === 'enabled' &&
          c.compatibleAgentRoles.includes(goal.agentRole)
      )
      if (!capability) return undefined

      const tool = getSeedTool(capability.id)
      if (!tool) return undefined

      const entries = await listCodexEntries(this.projectRoot)
      const { output, error } = await runSandboxed(tool, { entries })
      if (error || !output) return undefined

      const { contradictions } = output as { contradictions: [string, string[]][] }
      if (contradictions.length === 0) return undefined

      return {
        summary: `${contradictions.length} contradiction${contradictions.length === 1 ? '' : 's'} detected in the Codex.`,
        contradictions
      }
    } catch {
      return undefined
    }
  }

  private async runDialoguer(goal: AgentGoal): Promise<void> {
    const requestId = randomUUID()
    const decision = await this.requestPermission(goal, {
      requestId,
      capabilityId: 'global.tools.dialogue-scan@1.0.0',
      actionType: 'analyze-dialogue',
      dataScope: goal.scope.sceneIds?.[0] ? `scene:${goal.scope.sceneIds[0]}` : 'selection',
      destination: 'local'
    })

    if (decision === 'denied') {
      this.emit(goal.runId, {
        stepIndex: 0,
        kind: 'result',
        timestamp: new Date().toISOString(),
        detail: {
          summary: 'Dialogue Editor was not authorized to scan this selection.',
          warnings: ['Permission denied — no changes were made.']
        } satisfies AgentResult
      })
      await this.finish(goal.runId, 'cancelled')
      return
    }

    const state = this.runs.get(goal.runId)
    if (!state) return

    if (await this.guardToolCall(goal, 'Dialogue Editor')) return

    const selection = goal.scope.selectionText ?? ''
    const toolInput = { selection }
    if (
      await this.guardDuplicateAction(goal, 'Dialogue Editor', toolSignature('global.tools.dialogue-scan@1.0.0', toolInput))
    ) {
      return
    }

    const suggestions = simulateDialogueAlternatives(selection, goal.scope.sceneIds?.[0])

    const toolCall: ToolCall = {
      toolId: 'global.tools.dialogue-scan@1.0.0',
      input: toolInput,
      output: suggestions
    }
    this.emit(goal.runId, {
      stepIndex: state.record.steps.length,
      kind: 'tool-call',
      timestamp: new Date().toISOString(),
      detail: toolCall
    })
    state.budget.toolCallsUsed += 1

    const modelCall = await this.runModelCallStep(goal, selection)
    if (await this.guardModelCall(goal, 'Dialogue Editor', modelCall)) return
    this.emit(goal.runId, {
      stepIndex: state.record.steps.length,
      kind: 'model-call',
      timestamp: new Date().toISOString(),
      detail: modelCall
    })
    this.recordModelCall(goal, modelCall)

    const result: AgentResult = {
      summary: `Dialogue Editor proposed ${suggestions.length} alternative reading${suggestions.length === 1 ? '' : 's'}.`,
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

  private async runWorldBuilder(goal: AgentGoal): Promise<void> {
    const requestId = randomUUID()
    const decision = await this.requestPermission(goal, {
      requestId,
      capabilityId: 'global.tools.world-research@1.0.0',
      actionType: 'propose-codex-addition',
      dataScope: goal.scope.sceneIds?.[0] ? `scene:${goal.scope.sceneIds[0]}` : 'selection',
      destination: 'local'
    })

    if (decision === 'denied') {
      this.emit(goal.runId, {
        stepIndex: 0,
        kind: 'result',
        timestamp: new Date().toISOString(),
        detail: {
          summary: 'World Builder was not authorized to research this selection.',
          warnings: ['Permission denied — no changes were made.']
        } satisfies AgentResult
      })
      await this.finish(goal.runId, 'cancelled')
      return
    }

    const state = this.runs.get(goal.runId)
    if (!state) return

    if (await this.guardToolCall(goal, 'World Builder')) return

    const selection = goal.scope.selectionText ?? ''
    const toolInput = { selection }
    if (
      await this.guardDuplicateAction(goal, 'World Builder', toolSignature('global.tools.world-research@1.0.0', toolInput))
    ) {
      return
    }

    const suggestions = simulateCodexAdditions(selection, goal.scope.sceneIds?.[0])

    const toolCall: ToolCall = {
      toolId: 'global.tools.world-research@1.0.0',
      input: toolInput,
      output: suggestions
    }
    this.emit(goal.runId, {
      stepIndex: state.record.steps.length,
      kind: 'tool-call',
      timestamp: new Date().toISOString(),
      detail: toolCall
    })
    state.budget.toolCallsUsed += 1

    const modelCall = await this.runModelCallStep(goal, selection)
    if (await this.guardModelCall(goal, 'World Builder', modelCall)) return
    this.emit(goal.runId, {
      stepIndex: state.record.steps.length,
      kind: 'model-call',
      timestamp: new Date().toISOString(),
      detail: modelCall
    })
    this.recordModelCall(goal, modelCall)

    const result: AgentResult = {
      // Routed through proposedManuscriptChanges (rather than
      // proposedCodexChanges) because that is the only field the renderer
      // store currently folds into activeSuggestions — see
      // handleAgentStep() in state/store.ts. The suggestion's own `kind`
      // ('codex-addition') is what the UI actually branches on.
      summary: `World Builder proposed ${suggestions.length} Codex addition${suggestions.length === 1 ? '' : 's'}.`,
      proposedManuscriptChanges: suggestions,
      proposedCodexChanges: suggestions
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

// Deterministic, template-based continuation — not a real model call. Anchors
// on the last sentence of the selection when one is present so the result
// reads as a plausible next beat rather than a non-sequitur; falls back to a
// generic scene-continuation opener when there is no selection to anchor on.
function simulateGeneratorContinuation(selection: string, sceneId?: string): SuggestionRef[] {
  const runId = randomUUID()
  const trimmed = selection.trim()
  const sentences = trimmed.split(/(?<=[.!?])\s+/).filter(Boolean)
  const anchor = sentences[sentences.length - 1] ?? trimmed

  const text =
    anchor.length > 0
      ? `${anchor} A beat passed before the moment demanded a response — and the scene pressed forward into what came next.`
      : 'The scene continues: a beat of quiet tension before the next decision forces itself into the open.'

  return [
    {
      id: randomUUID(),
      agentRole: 'Generator',
      kind: 'insertion',
      targetSceneId: sceneId,
      payload: { text },
      provenance: { capabilityId: 'global.tools.prose-continuation', capabilityVersion: '1.0.0', runId },
      state: 'pending'
    }
  ]
}

// Heuristic structural pass styled on the Phase 1 prototype's Story Editor
// sample findings — a single deterministic check (dialogue presence) with a
// generic pacing note as the fallback, not a real model call.
function simulateStructuralFindings(selection: string, sceneId?: string): SuggestionRef[] {
  const runId = randomUUID()
  const trimmed = selection.trim()
  const hasDialogue = /["“”]/.test(trimmed)

  const finding = hasDialogue
    ? {
        title: 'Pacing check',
        body: 'This passage alternates dialogue and action — confirm the beat lands where intended before moving on to the next scene.',
        severity: 'low'
      }
    : {
        title: 'No dialogue in this passage',
        body: 'This selection reads as pure narration with no dialogue. If characters are present, consider whether a line of dialogue would ground the reader more directly in the scene.',
        severity: trimmed.length > 0 ? 'medium' : 'low'
      }

  return [
    {
      id: randomUUID(),
      agentRole: 'Dev-Editor',
      kind: 'editorial-finding',
      targetSceneId: sceneId,
      payload: finding,
      provenance: { capabilityId: 'global.tools.structural-analysis', capabilityVersion: '1.0.0', runId },
      state: 'pending'
    }
  ]
}

// Deterministic string-transform "alternatives" — a stand-in for a real
// dialogue-rewrite model call. Derives 2-3 phrasing variants from the
// selection itself so results are reproducible for the same input.
function simulateDialogueAlternatives(selection: string, sceneId?: string): SuggestionRef[] {
  const runId = randomUUID()
  const original = selection.trim().length > 0 ? selection.trim() : "I don't know what else to say."
  const stripped = original.replace(/[.?!]+$/, '')

  const alternatives = [
    `${stripped}.`,
    `${stripped} — you know that.`,
    `Look, ${stripped.charAt(0).toLowerCase()}${stripped.slice(1)}.`
  ]

  return [
    {
      id: randomUUID(),
      agentRole: 'Dialoguer',
      kind: 'dialogue-alternative',
      targetSceneId: sceneId,
      payload: { original, alternatives },
      provenance: { capabilityId: 'global.tools.dialogue-scan', capabilityVersion: '1.0.0', runId },
      state: 'pending'
    }
  ]
}

// Heuristic proper-noun extraction — a stand-in for real research/model
// inference. Looks for a capitalized token in the selection to use as the
// proposed entry name, and a small set of location keywords to guess the
// entry type; falls back to a generic placeholder when nothing matches.
// The citation is explicitly labeled as simulated per spec §15 — it must
// never be presented as a real source.
function simulateCodexAdditions(selection: string, sceneId?: string): SuggestionRef[] {
  const runId = randomUUID()
  const trimmed = selection.trim()
  const properNounMatch = trimmed.match(/\b[A-Z][a-zA-Z'-]{2,}\b/)
  const name = properNounMatch ? properNounMatch[0] : 'Unnamed Element'
  const entryType = /\b(city|town|village|kingdom|realm|forest|castle|island|harbor|province)\b/i.test(trimmed)
    ? 'location'
    : 'character'
  const summary =
    trimmed.length > 0
      ? `Referenced in this passage: "${trimmed.slice(0, 140)}${trimmed.length > 140 ? '…' : ''}" — proposed as a ${entryType} entry worth tracking in the Codex.`
      : `This selection referenced an element not yet tracked in the Codex — proposed as a ${entryType} entry pending review.`

  return [
    {
      id: randomUUID(),
      agentRole: 'World-Builder',
      kind: 'codex-addition',
      targetSceneId: sceneId,
      payload: {
        entryType,
        name,
        summary,
        citations: [
          {
            note: 'Simulated inference from the selected passage — no external research was performed.',
            reliability: 'low'
          }
        ]
      },
      provenance: { capabilityId: 'global.tools.world-research', capabilityVersion: '1.0.0', runId },
      state: 'pending'
    }
  ]
}
