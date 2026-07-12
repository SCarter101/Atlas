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
