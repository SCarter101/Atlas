import { randomUUID } from 'node:crypto'
import type {
  AgentGoal,
  AgentResult,
  AgentRole,
  AgentRunRecord,
  AgentStep,
  CapabilityRecommendationPayload,
  DialogueAlternativeOption,
  DialogueAlternativePayload,
  DialogueTensionTier,
  EditorialFindingPayload,
  InsertionPayload,
  MetadataProposalPayload,
  ModelCallSummary,
  ModelRef,
  PermissionDecision,
  PermissionRequest,
  SuggestionRef,
  ToolCall,
  TrackedChangePayload
} from '@shared/schema/agent'
import type { CapabilityManifest } from '@shared/schema/capability'
import type { SceneCraftMeta, SceneMeta } from '@shared/schema/manuscript'
import type { CharacterVoiceProfile, CodexEntry, CodexEntryType } from '@shared/schema/codex'
import type { RetrievalResult } from '@shared/schema/retrieval'
import type { AtlasDb } from '../persistence/db'
import { loadAgentRun, listAgentRuns, saveAgentRun } from '../persistence/agentRunStore'
import { listCodexEntries } from '../persistence/codexStore'
import { readScene } from '../persistence/sceneStore'
import { getActivePrompt } from '../persistence/promptStore'
import { recordUsage } from '../persistence/usageStore'
import { configuredMcpServers } from '@shared/mcp'
import { decodeWorldBuilderInterview, genreTemplateLabel, type WorldBuilderInterviewAnswers } from '@shared/worldBuilderInterview'
import { listCapabilities } from '../capabilities/registry'
import { ensureIndexed, search } from '../retrieval/search'
import { runSandboxed } from '../capabilities/sandbox'
import { getSeedTool } from '../capabilities/seedTools'
import { buildSessionApproval, SessionApprovalStore } from '../permissions/sessionApprovals'
import { LmStudioAdapter } from './providers/lmStudioAdapter'
import { OpenRouterAdapter } from './providers/openRouterAdapter'
import { SimulatorAdapter } from './providers/simulatorAdapter'
import type { ModelCallInput, ProviderAdapter } from './providers/types'
import { assembleContext, type AssembledContext } from './context/assemble'
import { tryParseJson } from './structuredOutput'

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

export interface RepeatedToolPatternMatch {
  toolId: string
  occurrences: number
  runIds: string[]
}

// Spec Phase 4 ("Capability recommendations based on repeated real writing
// workflows") — distinct from detectDuplicateAction above, which aborts a
// single run that repeats itself *within* that run. This looks *across*
// separate completed runs over time: did this role reach for the same tool
// in `threshold`-or-more distinct past runs? A real emergent workflow, not a
// runaway loop.
//
// Grouping is deliberately coarser than toolSignature() (toolId + input) —
// two calls' inputs (a selection, a scene id) almost never match verbatim
// across separate runs, so signature-level grouping would essentially never
// fire. The brief for this feature explicitly allows "simple exact-match on
// toolId... fine to start," so a run counts toward toolId's occurrence total
// at most once (a run that calls the same tool twice shouldn't inflate the
// count — that's detectDuplicateAction's job within that run).
export async function detectRepeatedToolPattern(
  projectRoot: string,
  db: AtlasDb,
  agentRole: AgentRole,
  threshold = 3
): Promise<RepeatedToolPatternMatch | undefined> {
  const completedRuns = listAgentRuns(projectRoot, db).filter(
    (r) => r.agentRole === agentRole && r.status === 'completed'
  )

  const runIdsByToolId = new Map<string, Set<string>>()
  for (const runMeta of completedRuns) {
    let record: AgentRunRecord
    try {
      record = await loadAgentRun(projectRoot, runMeta.runId)
    } catch {
      // The run index and the on-disk run file can drift (e.g. a deleted
      // agent-runs/*.json) — skip rather than fail the whole detection pass.
      continue
    }

    const toolIdsThisRun = new Set<string>()
    for (const step of record.steps) {
      if (step.kind !== 'tool-call') continue
      toolIdsThisRun.add((step.detail as ToolCall).toolId)
    }
    for (const toolId of toolIdsThisRun) {
      const runIds = runIdsByToolId.get(toolId) ?? new Set<string>()
      runIds.add(runMeta.runId)
      runIdsByToolId.set(toolId, runIds)
    }
  }

  let best: RepeatedToolPatternMatch | undefined
  for (const [toolId, runIds] of runIdsByToolId) {
    if (runIds.size < threshold) continue
    if (!best || runIds.size > best.occurrences) {
      best = { toolId, occurrences: runIds.size, runIds: [...runIds] }
    }
  }
  return best
}

// Phase 6: thrown by runModelCallStep() when a real provider call fails and
// no (or an unavailable) LM Studio fallback leaves nothing else to try.
// Caught in start()'s top-level catch and translated to a distinct 'paused'
// terminal status (recoverable — the writer can retry once the underlying
// provider issue is fixed) rather than the generic 'error' status every
// other unexpected exception produces.
class ModelCallFailure extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message)
  }
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

    // Fire and forget — the renderer subscribes to steps via onStep(). Every
    // finish() call below is itself fire-and-forget-from-here (this whole
    // block runs inside a .catch(), nothing left to propagate a rejection
    // to), so each gets its own .catch() logging any disk-write failure
    // rather than becoming an unhandled promise rejection — same
    // never-throw-into-the-caller contract as recordModelCall's
    // recordUsage() call below.
    void this.execute(goal).catch((err) => {
      if (err instanceof ModelCallFailure) {
        // Phase 6: a real provider failure (with no usable fallback) is
        // recoverable — the writer can fix the underlying issue (start LM
        // Studio, check network, etc.) and retry — so this gets its own
        // 'paused' status rather than the generic 'error' terminal state.
        void this.finish(goal.runId, 'paused', { code: err.code, message: err.message, recoverable: true }).catch(
          (finishErr) => console.error('[simulator] failed to persist paused run', finishErr)
        )
      } else {
        void this.finish(goal.runId, 'error', { code: 'simulator-error', message: String(err), recoverable: false }).catch(
          (finishErr) => console.error('[simulator] failed to persist errored run', finishErr)
        )
      }
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

  // Phase 6: the single choke point for prompt resolution, real-provider
  // fallback, and error classification — every run<Role>() method still
  // calls this exactly once per model-call step, same as before. Phase 7:
  // also the single choke point for attaching what main/agent/context/
  // assemble.ts actually packed into this call's contextText onto the
  // returned ModelCallSummary, for real Context Inspection display — usedTokens
  // is the adapter's own real inputTokens rather than assemble.ts's own
  // estimate, since the real count (once the call has actually completed) is
  // more honest than a pre-estimate.
  private async runModelCallStep(
    goal: AgentGoal,
    assembled: AssembledContext,
    responseFormat?: ModelCallInput['responseFormat']
  ): Promise<ModelCallSummary> {
    const primary = selectAdapter(goal.modelRef)

    // Best-effort: getActivePrompt() reads from the OS user-data directory
    // via Electron's `app.getPath`, which isn't available in every context
    // this method can run in (e.g. a unit test that doesn't mock 'electron').
    // Same "augment, don't block" pattern as the real-tool calls below
    // (checkWordCount, checkCodexContradictions, ...) — falling back to no
    // system prompt is a safe degradation, never worth failing the run over.
    let systemPrompt: string | undefined
    try {
      systemPrompt = (await getActivePrompt(goal.agentRole)).text
    } catch {
      systemPrompt = undefined
    }

    const input: ModelCallInput = {
      modelRef: goal.modelRef,
      systemPrompt,
      userIntent: goal.userIntent,
      contextText: assembled.contextText,
      responseFormat
    }

    let summary: ModelCallSummary
    try {
      summary = await primary.runModelCall(input)
    } catch (err) {
      // No fallback worth attempting when the primary adapter already *is*
      // the fallback target (lm-studio) or the simulator (which never
      // throws in practice), or when the writer hasn't opted in.
      if (primary.id === 'simulator' || primary.id === 'lm-studio' || !goal.lmStudioFallback) {
        throw new ModelCallFailure(String(err instanceof Error ? err.message : err), 'model-call-failed')
      }

      const lmStudio = new LmStudioAdapter()
      if (!(await lmStudio.isAvailable())) {
        throw new ModelCallFailure('LM Studio fallback is unavailable.', 'fallback-unavailable')
      }
      try {
        // Deliberately drop responseFormat on the fallback call: a JSON-mode
        // request that failed on the primary for JSON-related reasons is
        // unlikely to succeed by retrying the same JSON demand on a
        // different (local) model — let the fallback degrade to plain prose
        // rather than compounding the failure mode.
        summary = await lmStudio.runModelCall({
          ...input,
          modelRef: { provider: 'lm-studio', modelId: 'local-fallback', viaOpenRouter: false },
          responseFormat: undefined
        })
      } catch (fallbackErr) {
        // The fallback call itself can still fail after isAvailable() passed
        // (e.g. the model errors mid-request) — that failure must also
        // become a recoverable 'paused' run, not fall through to the
        // generic unhandled-error path, which is what happened before this
        // was wrapped: an un-rethrown AtlasError from here skipped the
        // ModelCallFailure branch in start()'s catch entirely.
        throw new ModelCallFailure(
          String(fallbackErr instanceof Error ? fallbackErr.message : fallbackErr),
          'fallback-failed'
        )
      }
    }

    return {
      ...summary,
      assembledContext: {
        sections: assembled.sections,
        tokenBudget: assembled.tokenBudget,
        usedTokens: summary.inputTokens
      }
    }
  }

  private recordModelCall(goal: AgentGoal, modelCall: ModelCallSummary): void {
    const state = this.runs.get(goal.runId)
    if (!state) return
    state.budget.tokensUsed += modelCall.inputTokens + modelCall.outputTokens
    state.budget.costUsdUsed += modelCall.estimatedCostUsd
    state.budget.turnsUsed += 1

    // Phase 6: fire-and-forget persistence of this call into the
    // project-scoped usage log (main/persistence/usageStore.ts) — built by
    // Wave 1B with no caller yet; this is that caller. Must never block or
    // throw into the caller, same contract as every other real-tool call in
    // this file (checkWordCount, checkCodexContradictions, ...).
    void recordUsage(this.projectRoot, {
      callKind: 'agent-run',
      runId: goal.runId,
      agentRole: goal.agentRole,
      modelRef: modelCall.modelRef,
      inputTokens: modelCall.inputTokens,
      outputTokens: modelCall.outputTokens,
      estimatedCostUsd: modelCall.estimatedCostUsd,
      timestamp: new Date().toISOString()
    }).catch((err) => console.error('[usage] failed to record', err))
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

    // The one real thing Line Editor does in this build: run the real
    // word-count tool on the passage being edited (see checkWordCount above)
    // and fold the count into the tool-call output and result summary —
    // augmenting, not replacing, the simulated findings.
    const wordCountResult = await this.checkWordCount('Line-Editor', selection)

    const toolCall: ToolCall = {
      toolId: 'global.tools.line-edit-scan@1.0.0',
      input: toolInput,
      output: wordCountResult ? { findings: suggestions, wordCount: wordCountResult } : suggestions
    }
    this.emit(goal.runId, {
      stepIndex: state.record.steps.length,
      kind: 'tool-call',
      timestamp: new Date().toISOString(),
      detail: toolCall
    })
    state.budget.toolCallsUsed += 1

    const assembledContext = await assembleContext(this.projectRoot, this.db, goal)
    const modelCall = await this.runModelCallStep(goal, assembledContext)
    if (await this.guardModelCall(goal, 'Line Editor', modelCall)) return
    this.emit(goal.runId, {
      stepIndex: state.record.steps.length,
      kind: 'model-call',
      timestamp: new Date().toISOString(),
      detail: modelCall
    })
    this.recordModelCall(goal, modelCall)

    // Phase 6: when a real adapter actually produced text, use it instead of
    // the simulated multi-finding categorized list — a deliberate
    // simplification for this phase (one tracked-change spanning the whole
    // selection, category 'Model revision') rather than attempting to parse
    // a real model's output back into the simulator's granular per-issue
    // findings. Full structured-output extraction for multi-finding reports
    // is deferred. Falls back to the existing simulated behavior whenever
    // there's no real output to use (simulator adapter, or a real adapter
    // that for some reason returned no text).
    const isReal = selectAdapter(goal.modelRef).id !== 'simulator' && !!modelCall.outputText
    const finalSuggestions: SuggestionRef[] = isReal
      ? [
          {
            id: randomUUID(),
            agentRole: 'Line-Editor',
            kind: 'tracked-change',
            targetSceneId: goal.scope.sceneIds?.[0],
            payload: {
              category: 'Model revision',
              before: selection,
              after: modelCall.outputText as string
            } satisfies TrackedChangePayload,
            provenance: { capabilityId: 'global.tools.line-edit-scan', capabilityVersion: '1.0.0', runId: goal.runId },
            state: 'pending'
          }
        ]
      : suggestions

    const wordCountNote = wordCountResult ? ` (scanned a ${wordCountResult.wordCount}-word passage)` : ''
    const result: AgentResult = {
      summary:
        finalSuggestions.length > 0
          ? `Line Editor found ${finalSuggestions.length} suggestion${finalSuggestions.length === 1 ? '' : 's'}${wordCountNote}.`
          : `Line Editor found no issues in this selection${wordCountNote}.`,
      proposedManuscriptChanges: finalSuggestions
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

    // "Generate Alternatives" (Required UI Features: "Enable multiple drafts
    // only as an optional advanced feature") is opt-in via
    // goal.generateAlternatives, set by AgentRail.tsx only when the writer
    // has Advanced Mode on. Default path is unchanged: exactly one draft.
    const suggestions = simulateGeneratorContinuation(
      selection,
      goal.scope.sceneIds?.[0],
      goal.generateAlternatives ? 3 : 1
    )

    // The one real thing Generator does in this build: run the real
    // word-count tool on the primary (first) draft (see checkWordCount
    // above) and fold the count into the tool-call output and result
    // summary — an unstated "a continuation" becomes a stated "a 42-word
    // continuation," without changing what was actually generated.
    const primaryDraftText = (suggestions[0]?.payload as InsertionPayload | undefined)?.text ?? ''
    const wordCountResult = await this.checkWordCount('Generator', primaryDraftText)

    const toolCall: ToolCall = {
      toolId: 'global.tools.prose-continuation@1.0.0',
      input: toolInput,
      output: wordCountResult ? { drafts: suggestions, wordCount: wordCountResult } : suggestions
    }
    this.emit(goal.runId, {
      stepIndex: state.record.steps.length,
      kind: 'tool-call',
      timestamp: new Date().toISOString(),
      detail: toolCall
    })
    state.budget.toolCallsUsed += 1

    const assembledContext = await assembleContext(this.projectRoot, this.db, goal)
    const modelCall = await this.runModelCallStep(goal, assembledContext)
    if (await this.guardModelCall(goal, 'Generator', modelCall)) return
    this.emit(goal.runId, {
      stepIndex: state.record.steps.length,
      kind: 'model-call',
      timestamp: new Date().toISOString(),
      detail: modelCall
    })
    this.recordModelCall(goal, modelCall)

    // Phase 6: when a real adapter produced text AND the writer didn't opt
    // into multi-draft mode, emit exactly one insertion built from the real
    // output instead of the simulated draft(s). Real multi-draft-against-a-
    // real-model is explicitly out of scope this phase — it would mean N
    // separate HTTP calls per run, which the budget-guard accounting above
    // (a single guardModelCall check per run) isn't designed to account for.
    // generateAlternatives therefore always keeps the simulated path, same
    // as a real adapter that returned no text.
    const isReal = selectAdapter(goal.modelRef).id !== 'simulator' && !!modelCall.outputText
    const finalSuggestions: SuggestionRef[] =
      isReal && !goal.generateAlternatives
        ? [
            {
              id: randomUUID(),
              agentRole: 'Generator',
              kind: 'insertion',
              targetSceneId: goal.scope.sceneIds?.[0],
              payload: { text: modelCall.outputText as string } satisfies InsertionPayload,
              provenance: { capabilityId: 'global.tools.prose-continuation', capabilityVersion: '1.0.0', runId: goal.runId },
              state: 'pending'
            }
          ]
        : suggestions

    const wordCountNote = wordCountResult
      ? ` Generated a ${wordCountResult.wordCount}-word continuation${finalSuggestions.length > 1 ? ' (first draft)' : ''}.`
      : ''
    const result: AgentResult = {
      summary: `Generator drafted ${finalSuggestions.length} continuation${finalSuggestions.length === 1 ? '' : 's'}.${wordCountNote}`,
      proposedManuscriptChanges: finalSuggestions
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

    // Phase 4 (spec ~line 183): Story Editor may also propose scene metadata
    // based on the current draft, but the writer must approve — so this is
    // only ever a pending `metadata-proposal` suggestion, never a direct
    // write. Reads the target scene's real current metadata to decide what's
    // worth proposing (see proposeSceneMetadataPatch); silently skipped if
    // there's no target scene or it can't be read (e.g. not yet indexed).
    const metadataSuggestion = await this.proposeMetadataSuggestion(goal, selection)

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

    const assembledContext = await assembleContext(this.projectRoot, this.db, goal)
    const modelCall = await this.runModelCallStep(goal, assembledContext)
    if (await this.guardModelCall(goal, 'Story Editor', modelCall)) return
    this.emit(goal.runId, {
      stepIndex: state.record.steps.length,
      kind: 'model-call',
      timestamp: new Date().toISOString(),
      detail: modelCall
    })
    this.recordModelCall(goal, modelCall)

    // Spec Phase 4 ("Capability recommendations based on repeated real
    // writing workflows"): checked once per Dev-Editor run, at the end,
    // against this role's own run history — natural spot since Dev-Editor
    // already has the most real-tool machinery of the five roles (the
    // Codex contradiction check above). A hit surfaces as its own pending
    // suggestion the writer can approve/reject like anything else.
    const recommendation = await this.maybeRecommendCapability(goal)

    const allSuggestions = [
      ...suggestions,
      ...(metadataSuggestion ? [metadataSuggestion] : []),
      ...(recommendation ? [recommendation] : [])
    ]

    const result: AgentResult = {
      summary: `Story Editor found ${suggestions.length} structural note${suggestions.length === 1 ? '' : 's'}.${
        contradictionNote ? ` ${contradictionNote.summary}` : ''
      }${metadataSuggestion ? ' Also proposed a scene metadata update for the writer to review.' : ''}${
        recommendation ? ' Also recommended a new capability based on a repeated tool-call pattern.' : ''
      }`,
      proposedManuscriptChanges: allSuggestions,
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

  // Shared real-tool call for Generator and Line Editor: discover the real
  // word-count capability via the registry and, if it's enabled and
  // compatible with `role`, actually run it (through the sandbox) against
  // `text` — the same discover/confirm/invoke shape checkCodexContradictions
  // uses above, just with the simplest of the three seed tools. Returns
  // undefined (never throws) whenever the capability isn't installed/enabled
  // for this role, matching the "augment, don't replace" pattern: callers
  // fold the count into an existing tool-call's output and summary, they
  // never gate on it.
  private async checkWordCount(role: AgentRole, text: string): Promise<{ wordCount: number } | undefined> {
    try {
      const capabilities = await listCapabilities(this.projectRoot)
      const capability = capabilities.find(
        (c) => c.id === 'global.tools.word-count' && c.lifecycleState === 'enabled' && c.compatibleAgentRoles.includes(role)
      )
      if (!capability) return undefined

      const tool = getSeedTool(capability.id)
      if (!tool) return undefined

      const { output, error } = await runSandboxed(tool, { text })
      if (error || !output) return undefined

      return output as { wordCount: number }
    } catch {
      return undefined
    }
  }

  // Dialoguer's real tool call. codex-search has no matching SandboxedTool
  // (see the comment above buildSeedManifests in seedTools.ts — it needs a
  // live AtlasDb the vm.Script sandbox can't safely receive), so this calls
  // ensureIndexed()/search() from retrieval/search.ts directly instead of
  // going through runSandboxed(), same as that comment instructs. Still
  // gated on the same registry discover/confirm-compatible check the other
  // real tool calls use, so disabling the capability in Library.tsx actually
  // turns this off. Returns undefined when there's no resolved character to
  // search for, the capability isn't available, or nothing related turns up.
  private async searchRelatedCodexForCharacter(
    character: { id: string; name: string } | undefined
  ): Promise<RetrievalResult[] | undefined> {
    if (!character || character.name.trim().length === 0) return undefined
    try {
      const capabilities = await listCapabilities(this.projectRoot)
      const capability = capabilities.find(
        (c) => c.id === 'global.tools.codex-search' && c.lifecycleState === 'enabled' && c.compatibleAgentRoles.includes('Dialoguer')
      )
      if (!capability) return undefined

      await ensureIndexed(this.db, this.projectRoot)
      const results = search(this.db, character.name, { kind: 'codex-entry', limit: 4 }).filter((r) => r.id !== character.id)
      return results.length > 0 ? results : undefined
    } catch {
      return undefined
    }
  }

  // World-Builder's real tool call: reuses the same codex-contradiction-check
  // tool Dev-Editor uses (see checkCodexContradictions above and this
  // capability's compatibleAgentRoles in seedTools.ts, which now includes
  // 'World-Builder'), but run against the *proposed* new entries plus the
  // real existing Codex rather than just the existing Codex — catching a
  // proposed fact that conflicts with something already tracked before the
  // writer ever reviews the proposal. Proposed entries are synthesized as
  // minimal CodexEntry-shaped objects (the tool only reads type/name/body/
  // relationships) purely for this check; nothing is written to the Codex
  // here. Only contradictions that actually involve one of the *proposed*
  // entries are returned — a pre-existing contradiction between two entries
  // already in the Codex isn't this proposal's problem to surface.
  private async checkWorldBuilderContradictions(
    goal: AgentGoal,
    proposals: SuggestionRef[]
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

      const existingEntries = await listCodexEntries(this.projectRoot)
      const now = new Date().toISOString()
      const proposedEntries: CodexEntry[] = proposals.map((p) => {
        const payload = p.payload as { entryType: CodexEntryType; name: string; summary: string }
        return {
          schemaVersion: 1,
          id: p.id,
          type: payload.entryType,
          name: payload.name,
          status: 'tentative',
          body: { summary: payload.summary },
          isPrivate: false,
          localModelOnly: false,
          locked: false,
          source: 'ai-proposed',
          relationships: [],
          manuscriptLinks: [],
          createdAt: now,
          updatedAt: now,
          history: []
        }
      })

      const { output, error } = await runSandboxed(tool, { entries: [...existingEntries, ...proposedEntries] })
      if (error || !output) return undefined

      const { contradictions } = output as { contradictions: [string, string[]][] }
      const proposedIds = new Set(proposedEntries.map((e) => e.id))
      const relevant = contradictions.filter(([id]) => proposedIds.has(id))
      if (relevant.length === 0) return undefined

      return {
        summary: `${relevant.length} proposed entr${relevant.length === 1 ? 'y' : 'ies'} may conflict with existing Codex content — review before accepting.`,
        contradictions: relevant
      }
    } catch {
      return undefined
    }
  }

  // Spec Phase 4 ("Capability recommendations based on repeated real writing
  // workflows") — Phase 3 explicitly deferred this. Checks whether this
  // role's own run history shows a tool called across 3+ separate completed
  // runs (detectRepeatedToolPattern), and if so drafts a project-scoped
  // CapabilityManifest cloned from the real installed tool's manifest,
  // re-labeled as a per-role recommendation. Never auto-installs anything —
  // returns a pending `capability-recommendation` suggestion the writer
  // reviews via CapabilityRecommendationCard.tsx, same Accept/Reject/Refine
  // contract as every other suggestion kind. Idempotent-ish: once the writer
  // has accepted a recommendation for this exact tool+role pairing (which
  // creates a capability at a deterministic id), this stops re-recommending
  // it every run.
  private async maybeRecommendCapability(goal: AgentGoal): Promise<SuggestionRef | undefined> {
    try {
      const match = await detectRepeatedToolPattern(this.projectRoot, this.db, goal.agentRole)
      if (!match) return undefined

      const capabilities = await listCapabilities(this.projectRoot)

      // Recorded tool-call step ids carry a @version suffix (e.g.
      // 'global.tools.structural-analysis@1.0.0'); installed capability
      // manifest ids don't. Strip it so a real installed tool is matched when
      // one exists. The per-role *workflow* tools that actually get recorded
      // as tool-call steps (structural-analysis, prose-continuation,
      // dialogue-scan, ...) have no installed manifest of their own, so
      // sourceTool is usually undefined — and that's fine: the point is to
      // recommend capturing a repeated workflow as a capability, not only to
      // re-install a tool that's already installed. When there's nothing to
      // clone, synthesize a minimal draft below rather than bailing (the old
      // `if (!sourceTool) return` here is exactly why no recommendation ever
      // surfaced).
      const baseToolId = match.toolId.split('@')[0]
      const sourceTool = capabilities.find((c) => c.id === baseToolId)

      const recommendedId = `${baseToolId}.recommended.${goal.agentRole.toLowerCase()}`
      if (capabilities.some((c) => c.id === recommendedId)) return undefined

      // Human-readable label from the tool id's last segment, e.g.
      // 'global.tools.structural-analysis' -> 'Structural Analysis'.
      const toolLabel =
        sourceTool?.name ??
        (baseToolId.split('.').pop() ?? baseToolId)
          .split('-')
          .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
          .join(' ')

      const now = new Date().toISOString()
      const historyNote = `Drafted from a repeated-tool-call pattern detected across ${match.occurrences} ${goal.agentRole} runs.`

      const draftManifest: CapabilityManifest = sourceTool
        ? {
            ...sourceTool,
            id: recommendedId,
            name: `${sourceTool.name} (${goal.agentRole} default)`,
            description: `${sourceTool.description} Recommended as a standard step for ${goal.agentRole} after it made this same tool call in ${match.occurrences} separate runs.`,
            scope: 'project',
            version: '1.0.0',
            compatibleAgentRoles: [goal.agentRole],
            validationStatus: 'untested',
            lifecycleState: 'draft',
            createdBy: 'agent-generated',
            history: [{ versionId: randomUUID(), changedAt: now, note: historyNote }]
          }
        : {
            schemaVersion: 1,
            id: recommendedId,
            name: `${toolLabel} (${goal.agentRole} default)`,
            description: `Recommended as a standard step for ${goal.agentRole} after it repeated the "${toolLabel}" workflow in ${match.occurrences} separate runs.`,
            type: 'tool',
            scope: 'project',
            owner: 'Atlas agent',
            version: '1.0.0',
            inputSchema: { type: 'object', properties: {} },
            outputSchema: { type: 'object', properties: {} },
            requiredContext: [],
            dependsOn: [],
            compatibleAgentRoles: [goal.agentRole],
            compatibleModelCapabilities: ['tool-calling'],
            sideEffects: 'none',
            permissionCategory: 'none',
            localOnly: true,
            costCharacteristics: { estTimeMs: 50 },
            validationStatus: 'untested',
            lifecycleState: 'draft',
            createdBy: 'agent-generated',
            history: [{ versionId: randomUUID(), changedAt: now, note: historyNote }]
          }

      return {
        id: randomUUID(),
        agentRole: goal.agentRole,
        kind: 'capability-recommendation',
        targetSceneId: goal.scope.sceneIds?.[0],
        payload: {
          toolId: match.toolId,
          occurrences: match.occurrences,
          runIds: match.runIds,
          rationale: `${goal.agentRole} has used "${toolLabel}" in ${match.occurrences} separate runs — install it as a standard, always-on capability for this role?`,
          draftManifest
        } satisfies CapabilityRecommendationPayload,
        provenance: { capabilityId: baseToolId, capabilityVersion: sourceTool?.version ?? '1.0.0', runId: goal.runId },
        state: 'pending'
      }
    } catch {
      return undefined
    }
  }

  // Reads the target scene's real current SceneMeta and, if there is one,
  // derives a metadata-proposal suggestion from it via
  // proposeSceneMetadataPatch (the pure, testable heuristic below). No
  // target scene, or a scene that can't be read (not yet indexed, e.g. in
  // tests that don't seed one), simply means no proposal this run.
  private async proposeMetadataSuggestion(goal: AgentGoal, selection: string): Promise<SuggestionRef | undefined> {
    const sceneId = goal.scope.sceneIds?.[0]
    if (!sceneId) return undefined
    try {
      const { meta } = await readScene(this.projectRoot, this.db, sceneId)
      const { proposedMeta, rationale } = proposeSceneMetadataPatch(meta, selection)
      return {
        id: randomUUID(),
        agentRole: 'Dev-Editor',
        kind: 'metadata-proposal',
        targetSceneId: sceneId,
        payload: { proposedMeta, rationale } satisfies MetadataProposalPayload,
        provenance: { capabilityId: 'global.tools.structural-analysis', capabilityVersion: '1.0.0', runId: goal.runId },
        state: 'pending'
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

    // Spec §7.4: use the character's Codex voice profile when one can be
    // resolved for this run — see resolveDialogueCharacter() for the lookup
    // heuristics (scene povCharacterId first, then a name match against the
    // selection). No hard failure when nothing resolves: the alternatives
    // just fall back to profile-agnostic phrasing, same as before this
    // feature existed.
    const character = await this.resolveDialogueCharacter(goal, selection)
    const suggestions = simulateDialogueAlternatives(selection, goal.scope.sceneIds?.[0], character)

    // "Detect when multiple characters sound too similar" — a real (if
    // heuristic) comparison over every character Codex entry that has a
    // voice profile filled in, not just the one involved in this run. Kept
    // separate from `suggestions` above (which is what the tool-call step
    // records as its output) and folded into the result as additional
    // editorial-finding suggestions, the same "augment, don't replace"
    // pattern Story Editor uses for its live contradiction check.
    const similarVoiceFindings = await this.checkSimilarVoices(goal)

    // The one real thing Dialogue Editor does in this build: look up real
    // Codex entries related to the resolved character (see
    // searchRelatedCodexForCharacter above) via retrieval/search.ts's real
    // vector index — a genuine data point supplementing the simulated
    // tension-tier alternatives, not a replacement for them.
    const relatedCodexResults = await this.searchRelatedCodexForCharacter(character)

    const toolCall: ToolCall = {
      toolId: 'global.tools.dialogue-scan@1.0.0',
      input: toolInput,
      output: relatedCodexResults ? { alternatives: suggestions, relatedCodexEntries: relatedCodexResults } : suggestions
    }
    this.emit(goal.runId, {
      stepIndex: state.record.steps.length,
      kind: 'tool-call',
      timestamp: new Date().toISOString(),
      detail: toolCall
    })
    state.budget.toolCallsUsed += 1

    const assembledContext = await assembleContext(this.projectRoot, this.db, goal)

    // Phase 8 §7.4 real branch: request JSON-mode output describing 3
    // tension-tiered alternatives instead of relying purely on
    // buildTensionAlternatives()'s string-template transform. The character's
    // Codex voice profile isn't re-fetched here — assembleContext() has
    // already folded it into assembledContext per Phase 7's priority order
    // (voice profiles are one of the sections it packs) — so the instructions
    // just point the model at whatever voice-profile context it's been given.
    const modelCall = await this.runModelCallStep(goal, assembledContext, {
      type: 'json',
      instructions:
        'Respond with strict JSON only (no prose, no markdown fences), in exactly this shape: ' +
        '{"alternatives": [{"tier": "calm", "text": "..."}, {"tier": "guarded", "text": "..."}, {"tier": "confrontational", "text": "..."}]}. ' +
        'Provide exactly one rewritten alternative of the original line for each of the three tension tiers, in that order — ' +
        "no more, no fewer. Reason over the resolved character's Codex voice-profile fields already present in the context above " +
        '(vocabulary, rhythm, formality level, speech directness, verbal tics, favorite/avoided phrases, power dynamics, etc.) so ' +
        'each alternative actually sounds like that character; if no voice profile is present in the context, write natural ' +
        'alternatives without inventing profile details that were not given to you.'
    })
    if (await this.guardModelCall(goal, 'Dialogue Editor', modelCall)) return
    this.emit(goal.runId, {
      stepIndex: state.record.steps.length,
      kind: 'model-call',
      timestamp: new Date().toISOString(),
      detail: modelCall
    })
    this.recordModelCall(goal, modelCall)

    // Parse -> validate -> fall back to the template path on any shortfall
    // (missing tier, empty text, malformed JSON, or a non-real adapter),
    // matching the "augment, never break the fallback" pattern
    // Generator/Line-Editor's real branches already established.
    const isReal = selectAdapter(goal.modelRef).id !== 'simulator' && !!modelCall.outputText
    const parsed = isReal
      ? tryParseJson<{ alternatives?: { tier?: string; text?: string }[] }>(modelCall.outputText as string)
      : undefined
    const realAlternatives = parseRealDialogueAlternatives(parsed)

    const templatePayload = suggestions[0].payload as DialogueAlternativePayload
    const finalSuggestions: SuggestionRef[] = realAlternatives
      ? [
          {
            id: randomUUID(),
            agentRole: 'Dialoguer',
            kind: 'dialogue-alternative',
            targetSceneId: goal.scope.sceneIds?.[0],
            payload: {
              characterName: templatePayload.characterName,
              original: templatePayload.original,
              alternatives: realAlternatives
            } satisfies DialogueAlternativePayload,
            provenance: {
              capabilityId: 'global.tools.dialogue-scan',
              capabilityVersion: '1.0.0',
              runId: randomUUID(),
              refinesSuggestionId: goal.refinesSuggestionId
            },
            state: 'pending'
          }
        ]
      : suggestions
    const finalAllSuggestions = [...finalSuggestions, ...similarVoiceFindings]

    const result: AgentResult = {
      summary: `Dialogue Editor proposed ${finalSuggestions.length} alternative reading${finalSuggestions.length === 1 ? '' : 's'}${
        similarVoiceFindings.length > 0
          ? ` and flagged ${similarVoiceFindings.length} character${similarVoiceFindings.length === 1 ? '' : 's'} pair${similarVoiceFindings.length === 1 ? '' : 's'} with similar voices`
          : ''
      }${
        relatedCodexResults
          ? ` (found ${relatedCodexResults.length} related Codex entr${relatedCodexResults.length === 1 ? 'y' : 'ies'} for ${character?.name})`
          : ''
      }.`,
      proposedManuscriptChanges: finalAllSuggestions
    }
    this.emit(goal.runId, {
      stepIndex: state.record.steps.length,
      kind: 'result',
      timestamp: new Date().toISOString(),
      detail: result
    })

    await this.finish(goal.runId, 'completed')
  }

  // Resolution order: (1) the scene's declared POV character, since that's
  // the character whose dialogue a writer is most likely reviewing; (2) a
  // case-insensitive name match against the selected text itself (handles
  // e.g. a quoted line with an attribution tag like `"...," Elena said.`).
  // Real gap noted in this round's brief: there's no clean existing hook
  // that ties a specific line of dialogue to its speaker, so this is a
  // best-effort heuristic, not a guarantee.
  private async resolveDialogueCharacter(
    goal: AgentGoal,
    selection: string
  ): Promise<{ id: string; name: string; voiceProfile?: CharacterVoiceProfile } | undefined> {
    try {
      const characters = await listCodexEntries(this.projectRoot, { type: 'character' })
      if (characters.length === 0) return undefined

      const sceneId = goal.scope.sceneIds?.[0]
      if (sceneId) {
        try {
          const { meta } = await readScene(this.projectRoot, this.db, sceneId)
          const pov = meta.povCharacterId ? characters.find((c) => c.id === meta.povCharacterId) : undefined
          if (pov) return { id: pov.id, name: pov.name, voiceProfile: pov.voiceProfile }
        } catch {
          // Scene not indexed yet (e.g. a detached run in a test) — fall
          // through to the name-match heuristic below.
        }
      }

      const byName = characters.find((c) => c.name.trim().length > 0 && selection.includes(c.name))
      if (byName) return { id: byName.id, name: byName.name, voiceProfile: byName.voiceProfile }

      return undefined
    } catch {
      return undefined
    }
  }

  private async checkSimilarVoices(goal: AgentGoal): Promise<SuggestionRef[]> {
    try {
      const characters = await listCodexEntries(this.projectRoot, { type: 'character' })
      const withProfiles = characters
        .map((c) => (c.voiceProfile ? { id: c.id, name: c.name, voiceProfile: c.voiceProfile } : undefined))
        .filter((c): c is { id: string; name: string; voiceProfile: CharacterVoiceProfile } => c !== undefined)
      const pairs = detectSimilarVoices(withProfiles)
      const runId = randomUUID()

      return pairs.map((pair) => ({
        id: randomUUID(),
        agentRole: 'Dialoguer' as const,
        kind: 'editorial-finding' as const,
        targetSceneId: goal.scope.sceneIds?.[0],
        payload: {
          title: `${pair.aName} and ${pair.bName} may sound too similar`,
          body: `Simulated approximation: these two characters' Codex voice profiles match on ${pair.matchedFields.length} field${pair.matchedFields.length === 1 ? '' : 's'} (${pair.matchedFields.join(', ')}). Consider differentiating their dialogue further.`,
          severity: pair.matchedFields.length >= 5 ? 'high' : 'medium'
        },
        provenance: { capabilityId: 'global.tools.dialogue-scan', capabilityVersion: '1.0.0', runId },
        state: 'pending' as const
      }))
    } catch {
      return []
    }
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

    // A goal built from the World Builder interview wizard (see
    // WorldBuilderInterview.tsx / AgentRail.tsx) carries the compiled
    // interview answers marker-encoded into selectionText rather than a raw
    // manuscript selection — decodeWorldBuilderInterview() returns null for
    // an ordinary selection (or anything malformed), which is the signal to
    // fall back to the original single-selection proper-noun-guess flow.
    const interview = decodeWorldBuilderInterview(selection)
    const modelCallContextText = interview ? interviewContextText(interview) : selection
    const toolInput = interview ? { interviewGenreTemplate: interview.genreTemplate } : { selection }
    if (
      await this.guardDuplicateAction(goal, 'World Builder', toolSignature('global.tools.world-research@1.0.0', toolInput))
    ) {
      return
    }

    const rawSuggestions = interview
      ? deriveWorldBuilderProposals(interview, goal.scope.sceneIds?.[0])
      : simulateCodexAdditions(selection, goal.scope.sceneIds?.[0])

    // The one real thing World Builder does in this build beyond the
    // interview/single-guess synthesis above: run the same
    // codex-contradiction-check tool Dev-Editor uses (see
    // checkWorldBuilderContradictions above), against these *proposed* new
    // entries plus the real existing Codex — catching a proposed fact that
    // conflicts with something already tracked before the writer ever
    // reviews it. Never blocks the proposal: any hits are folded into the
    // flagged proposal's own citations as a low-reliability warning (see
    // applyContradictionWarnings) and into the run's overall summary/
    // warnings — the writer still approves or rejects each proposal. This
    // check (against the template-derived proposals) also backs the tool-call
    // step's own reported output, computed before the real-branch model call
    // below even gets a chance to run.
    const contradictionNote = await this.checkWorldBuilderContradictions(goal, rawSuggestions)
    const templateSuggestions = contradictionNote ? applyContradictionWarnings(rawSuggestions, contradictionNote) : rawSuggestions

    const toolCall: ToolCall = {
      toolId: 'global.tools.world-research@1.0.0',
      input: toolInput,
      output: contradictionNote
        ? { proposals: templateSuggestions, codexContradictionCheck: contradictionNote }
        : templateSuggestions
    }
    this.emit(goal.runId, {
      stepIndex: state.record.steps.length,
      kind: 'tool-call',
      timestamp: new Date().toISOString(),
      detail: toolCall
    })
    state.budget.toolCallsUsed += 1

    // The interview wizard's compiled answers ARE the context for this run —
    // there's nothing else to retrieve yet (this run is what proposes the
    // Codex entries in the first place) — so that path wraps
    // modelCallContextText as a single section instead of running full
    // retrieval. An ordinary single-selection run gets the full priority-
    // order assembly like every other role.
    const assembledContext = interview
      ? await assembleContext(this.projectRoot, this.db, goal, {
          overrideText: modelCallContextText,
          overrideLabel: 'World Builder interview answers'
        })
      : await assembleContext(this.projectRoot, this.db, goal)

    // Phase 8 §7.5 real branch: request JSON-mode output describing 1-4
    // proposed Codex entries reasoned over the selection or the decoded
    // interview answers, covering both entry paths with one shared request.
    // Explicitly out of scope this round (confirmed): no real web research —
    // there is no internet access here, so a real proposal's content
    // generation is upgraded from template to real reasoning, but every
    // citation still stays honestly labeled as model inference, never
    // research (see the citation construction below).
    const modelCall = await this.runModelCallStep(goal, assembledContext, {
      type: 'json',
      instructions:
        'Respond with strict JSON only (no prose, no markdown fences), in exactly this shape: ' +
        '{"proposals": [{"entryType": "location", "name": "...", "summary": "..."}]}, with 1 to 4 entries. ' +
        '"entryType" must be one of: character, location, faction, object, event, world-rule, timeline-item, ' +
        'plot-thread, relationship, theme, motif, research-note, historical-reference, scene-note, private-author-note. ' +
        'Propose new Codex entries worth tracking, reasoned over the manuscript selection or the World Builder interview ' +
        'answers given in the context above. You have no access to external research or the internet — every proposal must ' +
        'be your own inference from what you were given, never presented as a researched or verified fact.'
    })
    if (await this.guardModelCall(goal, 'World Builder', modelCall)) return
    this.emit(goal.runId, {
      stepIndex: state.record.steps.length,
      kind: 'model-call',
      timestamp: new Date().toISOString(),
      detail: modelCall
    })
    this.recordModelCall(goal, modelCall)

    // Parse -> validate -> fall back to whichever template path is
    // appropriate to this run's entry path on any shortfall (malformed JSON,
    // an empty/invalid proposals array, or a non-real adapter).
    const isReal = selectAdapter(goal.modelRef).id !== 'simulator' && !!modelCall.outputText
    const parsed = isReal
      ? tryParseJson<{ proposals?: { entryType?: string; name?: string; summary?: string }[] }>(
          modelCall.outputText as string
        )
      : undefined
    const realProposals = parseRealWorldBuilderProposals(parsed)

    let finalSuggestions: SuggestionRef[]
    let finalContradictionNote = contradictionNote
    if (realProposals) {
      const realRunId = randomUUID()
      const rawRealSuggestions = realProposals.map((p) =>
        worldBuilderProposal(
          realRunId,
          goal.scope.sceneIds?.[0],
          p.entryType,
          p.name,
          p.summary,
          interview
            ? [worldBuilderCitation('your World Builder interview answers')]
            : [
                {
                  note: 'Simulated inference from the selected passage — no external research was performed.',
                  reliability: 'low'
                }
              ],
          goal.refinesSuggestionId
        )
      )
      // Re-run the same contradiction check (unchanged logic) against the
      // real proposals actually being returned, rather than reusing the
      // template-based check computed above for the tool-call step —
      // "regardless of which path produced the raw proposals" applies to the
      // proposals that actually ship in the result, not just the tool-call
      // snapshot taken before the model call.
      const realContradictionNote = await this.checkWorldBuilderContradictions(goal, rawRealSuggestions)
      finalSuggestions = realContradictionNote
        ? applyContradictionWarnings(rawRealSuggestions, realContradictionNote)
        : rawRealSuggestions
      finalContradictionNote = realContradictionNote
    } else {
      finalSuggestions = templateSuggestions
    }

    const result: AgentResult = {
      // Routed through proposedManuscriptChanges (rather than
      // proposedCodexChanges) because that is the only field the renderer
      // store currently folds into activeSuggestions — see
      // handleAgentStep() in state/store.ts. The suggestion's own `kind`
      // ('codex-addition') is what the UI actually branches on.
      summary: `World Builder proposed ${finalSuggestions.length} Codex addition${finalSuggestions.length === 1 ? '' : 's'}.${
        finalContradictionNote ? ` ${finalContradictionNote.summary}` : ''
      }`,
      proposedManuscriptChanges: finalSuggestions,
      proposedCodexChanges: finalSuggestions,
      warnings: finalContradictionNote ? [finalContradictionNote.summary] : undefined
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

// Deterministic, template-based continuations — not a real model call.
// Anchors on the last sentence of the selection when one is present so each
// result reads as a plausible next beat rather than a non-sequitur; falls
// back to a generic scene-continuation opener when there is no selection to
// anchor on. `draftCount` is 1 by default (the long-standing behavior); the
// opt-in "Generate Alternatives" mode (AgentGoal.generateAlternatives) asks
// for more than one, in which case every draft in the batch shares a
// draftGroupId so the UI can render them together (DraftComparisonView.tsx)
// instead of as unrelated single-insertion cards.
const DRAFT_VARIANTS = [
  (anchor: string) =>
    `${anchor} A beat passed before the moment demanded a response — and the scene pressed forward into what came next.`,
  (anchor: string) => `${anchor} Nobody moved. Then, all at once, the room remembered how to breathe.`,
  (anchor: string) =>
    `${anchor} It should have ended there. Instead, the silence stretched one beat too long, and something shifted.`
]

const DRAFT_FALLBACKS = [
  'The scene continues: a beat of quiet tension before the next decision forces itself into the open.',
  'The scene continues: the air in the room changes first, and the characters catch up a moment later.',
  'The scene continues: what happens next is smaller than expected, and heavier for it.'
]

function simulateGeneratorContinuation(selection: string, sceneId: string | undefined, draftCount = 1): SuggestionRef[] {
  const runId = randomUUID()
  const trimmed = selection.trim()
  const sentences = trimmed.split(/(?<=[.!?])\s+/).filter(Boolean)
  const anchor = sentences[sentences.length - 1] ?? trimmed
  const draftGroupId = draftCount > 1 ? randomUUID() : undefined

  const count = Math.max(1, draftCount)
  return Array.from({ length: count }, (_, i) => {
    const text =
      anchor.length > 0
        ? DRAFT_VARIANTS[i % DRAFT_VARIANTS.length](anchor)
        : DRAFT_FALLBACKS[i % DRAFT_FALLBACKS.length]

    const payload: InsertionPayload = draftGroupId
      ? { text, draftGroupId, draftLabel: `Draft ${i + 1}` }
      : { text }

    return {
      id: randomUUID(),
      agentRole: 'Generator',
      kind: 'insertion',
      targetSceneId: sceneId,
      payload,
      provenance: { capabilityId: 'global.tools.prose-continuation', capabilityVersion: '1.0.0', runId },
      state: 'pending'
    }
  })
}

// Heuristic structural pass styled on the Phase 1 prototype's Story Editor
// sample findings — a single deterministic check (dialogue presence) with a
// generic pacing note as the fallback, not a real model call. Each canned
// finding is tagged with `craftConceptIds` referencing
// renderer/src/lib/craftReference.ts's CRAFT_CONCEPTS (spec Phase 4 ~line
// 847), so EditorialFindingCard.tsx can offer a short reference chip instead
// of leaving the finding unexplained.
function simulateStructuralFindings(selection: string, sceneId?: string): SuggestionRef[] {
  const runId = randomUUID()
  const trimmed = selection.trim()
  const hasDialogue = /["“”]/.test(trimmed)

  const finding: EditorialFindingPayload = hasDialogue
    ? {
        title: 'Pacing check',
        body: 'This passage alternates dialogue and action — confirm the beat lands where intended before moving on to the next scene.',
        severity: 'low',
        craftConceptIds: ['pacing', 'scene-turns']
      }
    : {
        title: 'No dialogue in this passage',
        body: 'This selection reads as pure narration with no dialogue. If characters are present, consider whether a line of dialogue would ground the reader more directly in the scene.',
        severity: trimmed.length > 0 ? 'medium' : 'low',
        craftConceptIds: ['point-of-view', 'pacing']
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

// Deterministic, testable heuristic behind the Dev-Editor role's
// metadata-proposal suggestion (spec Phase 4 ~line 183: agents may propose
// metadata based on the current draft, but the writer must approve). Not a
// real model call — walks a fixed priority order of SceneCraftMeta fields,
// proposes a value for the first one that's still empty on the target scene,
// and derives a short placeholder value from the selection's last sentence
// (or a generic prompt when there's nothing to anchor on). Deliberately
// simple, matching the house style of simulateStructuralFindings /
// simulateGeneratorContinuation above.
const CRAFT_FIELD_PRIORITY: (keyof SceneCraftMeta)[] = [
  'stakes',
  'turningPoint',
  'characterDesire',
  'externalGoal',
  'internalConflict',
  'opposition',
  'outcome',
  'emotionalShift',
  'revealedInformation'
]

const CRAFT_FIELD_LABEL: Record<keyof SceneCraftMeta, string> = {
  characterDesire: 'character desire',
  externalGoal: 'external goal',
  internalConflict: 'internal conflict',
  opposition: 'opposition',
  stakes: 'stakes',
  turningPoint: 'turning point',
  outcome: 'outcome',
  emotionalShift: 'emotional shift',
  revealedInformation: 'revealed information',
  // Not part of CRAFT_FIELD_PRIORITY — conflictLevel is a numeric 1-5 rating
  // (Phase 4 visual story tools), not a text field this heuristic proposes.
  // Only present here to keep this Record exhaustive over SceneCraftMeta.
  conflictLevel: 'conflict level'
}

export function proposeSceneMetadataPatch(
  meta: SceneMeta,
  selection: string
): { proposedMeta: Partial<SceneMeta>; rationale: string } {
  const craft = meta.craft ?? {}
  const targetField = CRAFT_FIELD_PRIORITY.find((field) => !craft[field]) ?? CRAFT_FIELD_PRIORITY[0]
  const wasEmpty = !craft[targetField]

  const trimmed = selection.trim()
  const sentences = trimmed.split(/(?<=[.!?])\s+/).filter(Boolean)
  const anchor = sentences[sentences.length - 1] ?? trimmed

  const value =
    anchor.length > 0
      ? `Placeholder, review before accepting: ${anchor}`
      : `Placeholder — no selection to draw from; fill in the scene's ${CRAFT_FIELD_LABEL[targetField]} directly.`

  return {
    proposedMeta: { craft: { ...craft, [targetField]: value } },
    rationale: wasEmpty
      ? `This scene's "${CRAFT_FIELD_LABEL[targetField]}" field is empty — this passage suggests a starting point.`
      : `Every Story Craft field already has a value, so "${CRAFT_FIELD_LABEL[targetField]}" was re-evaluated against this passage — confirm or refine before accepting.`
  }
}

function lowerFirst(s: string): string {
  return s.length > 0 ? `${s.charAt(0).toLowerCase()}${s.slice(1)}` : s
}

// Phase 8: validates a real model's parsed JSON response for runDialoguer's
// real branch. Must contain all 3 tension tiers with non-empty text — the
// JSON can list them in any order (mapped back into this fixed order), but
// anything less (a missing tier, empty/blank text, a malformed shape) means
// "not usable," signaling the caller to fall back to
// buildTensionAlternatives()'s template path rather than partially accepting
// a result. Exported so it's directly unit-testable as a pure function,
// matching the house style of buildTensionAlternatives/detectSimilarVoices
// below.
const REQUIRED_TENSION_TIERS: DialogueTensionTier[] = ['calm', 'guarded', 'confrontational']

export function parseRealDialogueAlternatives(
  parsed: { alternatives?: { tier?: string; text?: string }[] } | undefined
): DialogueAlternativeOption[] | undefined {
  if (!parsed || !Array.isArray(parsed.alternatives)) return undefined
  const byTier = new Map(parsed.alternatives.map((a) => [a?.tier, a?.text]))
  const result: DialogueAlternativeOption[] = []
  for (const tier of REQUIRED_TENSION_TIERS) {
    const text = byTier.get(tier)
    if (typeof text !== 'string' || text.trim().length === 0) return undefined
    result.push({ tier, text })
  }
  return result
}

// Deterministic phrasing transform — a stand-in for a real dialogue-rewrite
// model call, same "honest placeholder" style as the rest of this file.
// Produces one alternative per tension tier (spec §7.4: "suggest alternate
// dialogue options at different tension levels"). When a character's Codex
// voice profile is available, `formalityLevel`/`speechDirectness` shape the
// phrasing (more clipped/direct at higher directness, softer hedging at
// higher formality or indirectness); without one, falls back to
// profile-agnostic transforms so the feature degrades gracefully rather
// than requiring every character to have a filled-in profile first.
// Exported (like detectDuplicateAction above) so it's directly unit-testable
// as a pure function.
export function buildTensionAlternatives(original: string, profile?: CharacterVoiceProfile): DialogueAlternativeOption[] {
  const trimmed = original.trim().length > 0 ? original.trim() : "I don't know what else to say."
  const stripped = trimmed.replace(/[.?!]+$/, '')

  const formal = profile?.formalityLevel === 'formal'
  const casual = profile?.formalityLevel === 'casual'
  const direct = profile?.speechDirectness === 'direct'
  const indirect = profile?.speechDirectness === 'indirect'

  const calmPrefix = formal ? 'If I may say so — ' : casual ? 'Look, ' : indirect ? 'I wonder if ' : ''
  const calmSuffix = formal ? ', if that is acceptable.' : ", if that's alright."
  const calm = `${calmPrefix}${lowerFirst(stripped)}${calmSuffix}`

  const guardedPrefix = indirect ? "I'm not sure this is my place, but " : ''
  const guarded = `${guardedPrefix}${stripped}. That's all I'll say about it.`

  const confrontational = direct || casual ? `${stripped}. Full stop.` : `${stripped}!`

  const tiers: { tier: DialogueTensionTier; text: string }[] = [
    { tier: 'calm', text: calm },
    { tier: 'guarded', text: guarded },
    { tier: 'confrontational', text: confrontational }
  ]
  return tiers
}

const VOICE_PROFILE_STRING_FIELDS: (keyof CharacterVoiceProfile)[] = [
  'vocabulary',
  'rhythm',
  'educationLevel',
  'humorStyle',
  'emotionalGuardedness',
  'accentOrDialect',
  'speechDirectness',
  'formalityLevel',
  'powerDynamics'
]

const VOICE_PROFILE_ARRAY_FIELDS: (keyof CharacterVoiceProfile)[] = [
  'verbalTics',
  'tabooTopics',
  'favoritePhrases',
  'avoidedPhrases'
]

export interface SimilarVoicePair {
  aId: string
  aName: string
  bId: string
  bName: string
  matchedFields: string[]
}

// Spec §7.4: "detect when multiple characters sound too similar." A simple
// simulated heuristic — counts overlapping Codex voice-profile fields
// between every pair of characters that have a profile filled in, and flags
// a pair once `minMatches` fields overlap. This compares declared profile
// fields, not actual dialogue lines, so it's explicitly an approximation
// (see the finding text this feeds into in runDialoguer's checkSimilarVoices)
// rather than a real semantic similarity check.
export function detectSimilarVoices(
  characters: { id: string; name: string; voiceProfile: CharacterVoiceProfile }[],
  minMatches = 3
): SimilarVoicePair[] {
  const pairs: SimilarVoicePair[] = []

  for (let i = 0; i < characters.length; i++) {
    for (let j = i + 1; j < characters.length; j++) {
      const a = characters[i]
      const b = characters[j]
      const matchedFields: string[] = []

      for (const field of VOICE_PROFILE_STRING_FIELDS) {
        const av = a.voiceProfile[field]
        const bv = b.voiceProfile[field]
        if (
          typeof av === 'string' &&
          typeof bv === 'string' &&
          av.trim().length > 0 &&
          av.trim().toLowerCase() === bv.trim().toLowerCase()
        ) {
          matchedFields.push(field)
        }
      }

      for (const field of VOICE_PROFILE_ARRAY_FIELDS) {
        const av = a.voiceProfile[field]
        const bv = b.voiceProfile[field]
        if (Array.isArray(av) && Array.isArray(bv) && av.length > 0 && bv.length > 0) {
          const bSet = new Set(bv.map((v) => v.trim().toLowerCase()))
          if (av.some((v) => bSet.has(v.trim().toLowerCase()))) matchedFields.push(field)
        }
      }

      if (matchedFields.length >= minMatches) {
        pairs.push({ aId: a.id, aName: a.name, bId: b.id, bName: b.name, matchedFields })
      }
    }
  }

  return pairs
}

function simulateDialogueAlternatives(
  selection: string,
  sceneId: string | undefined,
  character?: { id: string; name: string; voiceProfile?: CharacterVoiceProfile }
): SuggestionRef[] {
  const runId = randomUUID()
  const original = selection.trim().length > 0 ? selection.trim() : "I don't know what else to say."
  const alternatives = buildTensionAlternatives(original, character?.voiceProfile)

  const payload: DialogueAlternativePayload = {
    characterName: character?.name,
    original,
    alternatives
  }

  return [
    {
      id: randomUUID(),
      agentRole: 'Dialoguer',
      kind: 'dialogue-alternative',
      targetSceneId: sceneId,
      payload,
      provenance: { capabilityId: 'global.tools.dialogue-scan', capabilityVersion: '1.0.0', runId },
      state: 'pending'
    }
  ]
}

// Pure helper behind runWorldBuilder's real codex-contradiction-check call
// (checkWorldBuilderContradictions above): appends a low-reliability warning
// citation to every proposal whose id was flagged, leaving every other
// proposal untouched. Kept as a standalone function (rather than inline in
// runWorldBuilder) so it's directly unit-testable, matching the house style
// of buildTensionAlternatives/detectSimilarVoices above.
export function applyContradictionWarnings(
  proposals: SuggestionRef[],
  note: { contradictions: [string, string[]][] }
): SuggestionRef[] {
  const reasonsById = new Map(note.contradictions)
  return proposals.map((p) => {
    const reasons = reasonsById.get(p.id)
    if (!reasons || reasons.length === 0) return p
    const payload = p.payload as {
      entryType: string
      name: string
      summary: string
      citations: { note: string; reliability: 'low' | 'medium' | 'high' | 'author-stated' }[]
    }
    return {
      ...p,
      payload: {
        ...payload,
        citations: [
          ...payload.citations,
          { note: `Possible contradiction with existing Codex content: ${reasons.join('; ')}`, reliability: 'low' as const }
        ]
      }
    }
  })
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

// Concatenates the interview's free-text answers into one context string for
// the (simulated) model-call token/cost estimate — deliberately the answer
// text alone, not the marker-prefixed JSON blob stored in
// AgentGoal.scope.selectionText, so budget math reflects what a real
// synthesis call would actually be fed rather than JSON syntax overhead.
function interviewContextText(interview: WorldBuilderInterviewAnswers): string {
  return [
    interview.worldGrounding,
    interview.sensoryDetail,
    interview.characterImpact,
    interview.plotPressure,
    interview.consistencyFacts,
    interview.flexibleRules
  ]
    .filter((t) => t.trim().length > 0)
    .join(' ')
}

// Per genre template, the CodexEntryType used for the "how this world's
// social/political structure bears on the story" proposal (spec §7.5:
// "propose ... political systems, religions, economies, and cultural
// norms when necessary" — there is no dedicated CodexEntryType for those,
// so 'faction' is the closest existing fit for a social-structure entry,
// except historical-setting, where a 'timeline-item' — the setting's real
// (or real-feeling) historical throughline — is the more natural fit.
const SOCIETY_ENTRY_TYPE: Record<WorldBuilderInterviewAnswers['genreTemplate'], CodexEntryType> = {
  'fantasy-kingdom': 'faction',
  'sci-fi-colony': 'faction',
  'space-opera-setting': 'faction',
  'crime-city': 'faction',
  'thriller-environment': 'faction',
  'historical-setting': 'timeline-item',
  'contemporary-town': 'faction',
  custom: 'faction'
}

function worldBuilderCitation(topic: string): { note: string; reliability: 'author-stated' } {
  return {
    // Distinct from simulateCodexAdditions' 'low'-reliability regex guess
    // above: this is synthesized directly from what the writer told the
    // interview, not fabricated or web-researched, so it gets its own
    // provenance label rather than being (mis)represented as a low-quality
    // research citation. See CodexAdditionCard.tsx for how this renders.
    note: `Synthesized directly from your World Builder interview answer on "${topic}" — not researched or fabricated.`,
    reliability: 'author-stated'
  }
}

function worldBuilderProposal(
  runId: string,
  sceneId: string | undefined,
  entryType: CodexEntryType,
  name: string,
  summary: string,
  // Widened to also accept the single-selection flow's 'low'-reliability
  // regex-guess citation (Phase 8's real branch below reuses this helper for
  // both entry paths) — deriveWorldBuilderProposals below only ever passes
  // 'author-stated' citations, unchanged.
  citations: Array<{ note: string; reliability: 'author-stated' | 'low' }>,
  // Phase 8: threaded straight into provenance.refinesSuggestionId when this
  // proposal comes from a refineSuggestion() re-run — see AgentGoal.refinesSuggestionId's
  // own doc comment in shared/schema/agent.ts. Undefined on an ordinary run,
  // and always undefined for deriveWorldBuilderProposals' template callers,
  // which never pass this argument.
  refinesSuggestionId?: string
): SuggestionRef {
  return {
    id: randomUUID(),
    agentRole: 'World-Builder',
    kind: 'codex-addition',
    targetSceneId: sceneId,
    payload: { entryType, name, summary, citations },
    provenance: { capabilityId: 'global.tools.world-research', capabilityVersion: '1.0.0', runId, refinesSuggestionId },
    state: 'pending'
  }
}

// Mirrors shared/schema/codex.ts's CodexEntryType union as a runtime list —
// there's no exported runtime array of that type to import (only the type
// itself), and pulling in shared/validation.ts's zod schema just for this one
// membership check would add a dependency this file doesn't otherwise have.
const CODEX_ENTRY_TYPES: CodexEntryType[] = [
  'character',
  'location',
  'faction',
  'object',
  'event',
  'world-rule',
  'timeline-item',
  'plot-thread',
  'relationship',
  'theme',
  'motif',
  'research-note',
  'historical-reference',
  'scene-note',
  'private-author-note'
]

export interface RealWorldBuilderProposal {
  entryType: CodexEntryType
  name: string
  summary: string
}

// Phase 8: validates a real model's parsed JSON response for
// runWorldBuilder's real branch. Requires a non-empty array (max 4 kept, per
// spec §7.5) where every entry has a valid CodexEntryType plus non-empty
// name/summary strings — anything less (empty array, malformed shape, an
// entryType the model invented that isn't a real CodexEntryType) means "not
// usable," signaling the caller to fall back to whichever template path
// (deriveWorldBuilderProposals/simulateCodexAdditions) is appropriate to the
// current run's entry path. Exported so it's directly unit-testable as a
// pure function, matching parseRealDialogueAlternatives above.
export function parseRealWorldBuilderProposals(
  parsed: { proposals?: { entryType?: string; name?: string; summary?: string }[] } | undefined
): RealWorldBuilderProposal[] | undefined {
  if (!parsed || !Array.isArray(parsed.proposals) || parsed.proposals.length === 0) return undefined
  const proposals: RealWorldBuilderProposal[] = []
  for (const p of parsed.proposals) {
    const entryType = p?.entryType
    const name = p?.name
    const summary = p?.summary
    if (
      typeof entryType !== 'string' ||
      !CODEX_ENTRY_TYPES.includes(entryType as CodexEntryType) ||
      typeof name !== 'string' ||
      name.trim().length === 0 ||
      typeof summary !== 'string' ||
      summary.trim().length === 0
    ) {
      return undefined
    }
    proposals.push({ entryType: entryType as CodexEntryType, name, summary })
  }
  return proposals.slice(0, 4)
}

// Turns a compiled World Builder interview into 2-4 proposed Codex entries
// (spec §7.5: "propose maps, timelines, family trees, political systems,
// religions, economies, and cultural norms when necessary" — plural, not a
// single guess). Two entries (world rules, location) are always proposed
// since the interview always covers those topics; the social-structure and
// timeline entries are only added when the writer's answers actually
// support them, matching the spec's "when necessary" qualifier rather than
// padding out to 4 unconditionally. Exported so
// simulator.worldBuilder.test.ts can exercise it directly as a pure
// function, the same way detectDuplicateAction is tested above.
export function deriveWorldBuilderProposals(
  interview: WorldBuilderInterviewAnswers,
  sceneId?: string
): SuggestionRef[] {
  const runId = randomUUID()
  const genreLabel = genreTemplateLabel(interview.genreTemplate)

  const consistency = interview.consistencyFacts.trim()
  const flexible = interview.flexibleRules.trim()
  const grounding = interview.worldGrounding.trim()
  const sensory = interview.sensoryDetail.trim()
  const impact = interview.characterImpact.trim()
  const pressure = interview.plotPressure.trim()

  const proposals: SuggestionRef[] = []

  // 1. World-rule entry — always proposed.
  proposals.push(
    worldBuilderProposal(
      runId,
      sceneId,
      'world-rule',
      `${genreLabel} — World Rules`,
      [
        consistency
          ? `Must remain consistent: ${consistency}`
          : 'No consistency constraints captured yet — revisit this entry once you know what can never contradict itself.',
        flexible ? `Flexible, tentative, or locked: ${flexible}` : ''
      ]
        .filter(Boolean)
        .join(' '),
      [worldBuilderCitation('what facts must remain consistent')]
    )
  )

  // 2. Location entry — always proposed. Reuses the same proper-noun guess
  // simulateCodexAdditions uses above for a plausible entry name when the
  // writer's answer doesn't make one obvious.
  const properNoun = grounding.match(/\b[A-Z][a-zA-Z'-]{2,}\b/)?.[0]
  proposals.push(
    worldBuilderProposal(
      runId,
      sceneId,
      'location',
      properNoun ?? `${genreLabel} Setting`,
      [
        grounding || `A ${genreLabel.toLowerCase()} not yet described in detail.`,
        sensory ? `Sensory detail: ${sensory}` : ''
      ]
        .filter(Boolean)
        .join(' '),
      [worldBuilderCitation('what kind of world grounds this story')]
    )
  )

  // 3. Social-structure entry — only when the writer gave something to
  // draw on.
  const societyType = SOCIETY_ENTRY_TYPE[interview.genreTemplate]
  if (impact.length > 0 || pressure.length > 0) {
    proposals.push(
      worldBuilderProposal(
        runId,
        sceneId,
        societyType,
        `${genreLabel} — Social Order`,
        [impact ? `Affects characters: ${impact}` : '', pressure ? `Plot pressure: ${pressure}` : '']
          .filter(Boolean)
          .join(' '),
        [worldBuilderCitation('how this world affects your characters and the plot')]
      )
    )
  }

  // 4. Timeline entry — only when the plot-pressure answer is substantial
  // enough to suggest a real temporal throughline worth tracking as its own
  // entry, rather than proposing one from a one-line answer.
  if (pressure.length > 40) {
    const timelineType: CodexEntryType = societyType === 'timeline-item' ? 'faction' : 'timeline-item'
    proposals.push(
      worldBuilderProposal(
        runId,
        sceneId,
        timelineType,
        `${genreLabel} — Timeline Pressure`,
        `Pressure on the plot's timeline: ${pressure}`,
        [worldBuilderCitation('what pressures this world places on the plot')]
      )
    )
  }

  return proposals.slice(0, 4)
}
