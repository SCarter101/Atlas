import type { AgentRole, ModelRef } from './agent'

// What kind of work made this model call. 'agent-run' is the original
// (Phase 6) case — a Generator/Line-Editor/etc. run step — and always has
// runId+agentRole. Phase 7 adds standalone calls with neither: embedding
// generation (retrieval indexing) and rolling-summary generation. Defaults
// to 'agent-run' for entries written before this field existed.
export type UsageCallKind = 'agent-run' | 'embedding' | 'summary-generation'

// One entry per completed model call, appended to a project-scoped
// append-only log (see main/persistence/usageStore.ts).
export interface UsageEntry {
  callKind?: UsageCallKind
  runId?: string
  agentRole?: AgentRole
  // Free-form identifier for non-agent-run calls, e.g. a summary kind/subject
  // ('chapter-summary:ch-12') or an embedding source id — lets Settings/Usage
  // UI show what a standalone call was for without inventing an AgentRole.
  label?: string
  modelRef: ModelRef
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number
  timestamp: string
}

export interface UsageSummary {
  totalCostUsd: number
  totalTokens: number
  byAgentRole: Partial<Record<AgentRole, { costUsd: number; tokens: number; calls: number }>>
  byModel: Record<string, { costUsd: number; tokens: number; calls: number }>
}
