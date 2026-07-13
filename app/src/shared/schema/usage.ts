import type { AgentRole, ModelRef } from './agent'

// One entry per completed model call, appended to a project-scoped
// append-only log (see main/persistence/usageStore.ts). Not yet written by
// anything in this wave — main/agent/simulator.ts (owned by a later wave)
// is the intended caller once real provider calls land.
export interface UsageEntry {
  runId: string
  agentRole: AgentRole
  modelRef: ModelRef
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number
  timestamp: string
}

export interface UsageSummary {
  totalCostUsd: number
  totalTokens: number
  byAgentRole: Record<AgentRole, { costUsd: number; tokens: number; calls: number }>
  byModel: Record<string, { costUsd: number; tokens: number; calls: number }>
}
