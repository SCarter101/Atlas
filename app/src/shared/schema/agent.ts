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
  targetSceneId?: string
  targetCodexEntryId?: string
  payload: unknown
  provenance: { capabilityId?: string; capabilityVersion?: string; runId: string }
  state: 'pending' | 'accepted' | 'rejected' | 'refining'
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
