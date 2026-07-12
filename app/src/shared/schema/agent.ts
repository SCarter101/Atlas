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
