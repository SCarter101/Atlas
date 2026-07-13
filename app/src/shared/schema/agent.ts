import type { CapabilityManifest } from './capability'
import type { SceneMeta } from './manuscript'

export type AgentRole = 'Generator' | 'Dev-Editor' | 'Line-Editor' | 'Dialoguer' | 'World-Builder'

export type ModelProvider = 'anthropic' | 'openai' | 'google' | 'openrouter' | 'lm-studio'

export interface ModelRef {
  provider: ModelProvider
  modelId: string
  viaOpenRouter: boolean
}

export interface AgentGoal {
  runId: string
  agentRole: AgentRole
  modelRef: ModelRef
  userIntent: string
  scope: {
    sceneIds?: string[]
    selectionText?: string
    codexEntryIds?: string[]
  }
  constraints: {
    maxTurns: number
    maxTokens: number
    maxToolCalls: number
    maxElapsedMs: number
    maxCostUsd?: number
    allowedCapabilityCategories: string[]
  }
  // Opt-in "Generate Alternatives" mode (Required UI Features: "Enable
  // multiple drafts only as an optional advanced feature"). Only consulted
  // by the Generator role today — see simulateGeneratorContinuation() in
  // main/agent/simulator.ts. Gated in the UI behind Advanced Mode (see
  // AgentRail.tsx), not just this flag, so a hand-crafted AgentGoal that
  // sets it without Advanced Mode still works — the gate is a UX affordance,
  // not a security boundary.
  generateAlternatives?: boolean
}

export interface AgentError {
  code: string
  message: string
  recoverable: boolean
}

export interface ToolCall {
  toolId: string
  input: unknown
  output?: unknown
  error?: AgentError
}

export interface SkillInvocation {
  skillId: string
  input: unknown
  output?: unknown
}

export type PermissionDecision = 'approved-once' | 'approved-session' | 'denied' | 'pending'

export interface PermissionRequest {
  requestId: string
  capabilityId: string
  actionType: string
  dataScope: string
  destination?: string
  decision: PermissionDecision
}

export interface ModelCallSummary {
  modelRef: ModelRef
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number
}

export interface Citation {
  sourceUrl?: string
  note: string
  reliability?: 'low' | 'medium' | 'high'
}

// Payload shape for `kind: 'editorial-finding'` suggestions (Story Editor /
// Dev-Editor). Previously only inline-typed at the point of use
// (simulator.ts's simulateStructuralFindings, EditorialFindingCard.tsx's
// render cast) — pulled out here so both sides share one definition.
// `craftConceptIds` is optional and references `CRAFT_CONCEPTS` in
// renderer/src/lib/craftReference.ts (spec Phase 4 ~line 847: findings should
// link to concise in-app craft explainers, not become a writing course).
export interface EditorialFindingPayload {
  title: string
  body: string
  severity: string
  craftConceptIds?: string[]
}

// Payload shape for `kind: 'metadata-proposal'` suggestions. Spec Phase 4
// (~line 183): agents may propose scene metadata based on the current draft,
// but the writer must approve changes — this is the "proposal" the writer
// reviews via MetadataProposalCard.tsx before it's ever written to disk.
export interface MetadataProposalPayload {
  proposedMeta: Partial<SceneMeta>
  rationale: string
}

// Payload shape for a `kind: 'insertion'` SuggestionRef (Generator). Plain
// suggestions omit draftGroupId; the opt-in "Generate Alternatives" mode
// (see AgentGoal.generateAlternatives) tags every draft it produces in one
// run with the same draftGroupId so the UI can recognize and render them as
// a comparable set (DraftComparisonView.tsx) instead of N unrelated cards.
export interface InsertionPayload {
  text: string
  draftGroupId?: string
  draftLabel?: string
}

// Spec §7.4: "suggest alternate dialogue options at different tension
// levels." Payload shape for a `kind: 'dialogue-alternative'` SuggestionRef
// (Dialoguer). tier is only meaningful when the alternative was generated
// from a character's Codex voice profile — see buildTensionAlternatives()
// in main/agent/simulator.ts.
export type DialogueTensionTier = 'calm' | 'guarded' | 'confrontational'

export interface DialogueAlternativeOption {
  tier: DialogueTensionTier
  text: string
}

export interface DialogueAlternativePayload {
  characterName?: string
  original: string
  alternatives: DialogueAlternativeOption[]
}

// Payload shape for a `kind: 'capability-recommendation'` SuggestionRef.
// Spec Phase 4 ("Capability recommendations based on repeated real writing
// workflows"): when the same tool has been invoked across `occurrences`
// separate completed agent runs (see detectRepeatedToolPattern() in
// main/agent/simulator.ts), the writer is offered a draft capability they
// can approve into a real installed one via CapabilityRecommendationCard.tsx
// — accepting calls the existing `capabilities:create` IPC directly with
// `draftManifest`, the same contract Library.tsx's "New Capability" form
// already uses.
export interface CapabilityRecommendationPayload {
  toolId: string
  occurrences: number
  runIds: string[]
  rationale: string
  draftManifest: CapabilityManifest
}

export interface SuggestionRef {
  id: string
  agentRole: AgentRole
  kind:
    | 'insertion'
    | 'tracked-change'
    | 'editorial-finding'
    | 'dialogue-alternative'
    | 'metadata-proposal'
    | 'codex-addition'
    | 'capability-recommendation'
  targetSceneId?: string
  targetCodexEntryId?: string
  payload: unknown
  provenance: { capabilityId?: string; capabilityVersion?: string; runId: string }
  // 'fixed' is Story-Editor-specific (spec §7.2's 5 issue statuses: Open,
  // Accepted, Rejected, In progress, Fixed — 'refining' already covers "In
  // progress"). Only EditorialFindingCard.tsx offers a UI path to it; other
  // suggestion kinds never produce it.
  state: 'pending' | 'accepted' | 'rejected' | 'refining' | 'fixed'
  refineInstruction?: string
}

export interface AgentResult {
  summary: string
  proposedManuscriptChanges?: SuggestionRef[]
  proposedCodexChanges?: SuggestionRef[]
  citations?: Citation[]
  warnings?: string[]
  nextSteps?: string[]
}

export type AgentStepKind = 'plan' | 'tool-call' | 'skill-invoke' | 'permission-request' | 'model-call' | 'result'

export interface AgentStep {
  stepIndex: number
  kind: AgentStepKind
  timestamp: string
  detail: ToolCall | SkillInvocation | PermissionRequest | ModelCallSummary | AgentResult
}

export type AgentRunStatus = 'running' | 'paused' | 'completed' | 'cancelled' | 'error'

export interface AgentRunRecord {
  schemaVersion: 1
  goal: AgentGoal
  steps: AgentStep[]
  status: AgentRunStatus
  startedAt: string
  endedAt?: string
}
