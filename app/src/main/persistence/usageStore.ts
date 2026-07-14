import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { UsageEntry, UsageSummary } from '@shared/schema/usage'
import { projectPaths } from './paths'

function usageLogPath(projectRoot: string): string {
  return join(projectPaths(projectRoot).settingsDir, 'usage.jsonl')
}

function modelKey(entry: UsageEntry): string {
  return `${entry.modelRef.provider}:${entry.modelRef.modelId}`
}

// Append-only usage log — one JSON object per line, mirroring the
// house-style rolling-log approach (see sessionStore.ts's daily files) but
// as a single project-scoped file since usage entries are per-call, not
// per-day. Called from main/agent/simulator.ts for agent-run calls (Phase 6)
// and from the Phase 7 embedding/summary-generation call sites.
export async function recordUsage(projectRoot: string, entry: UsageEntry): Promise<void> {
  const settingsDir = projectPaths(projectRoot).settingsDir
  await mkdir(settingsDir, { recursive: true })
  await appendFile(usageLogPath(projectRoot), `${JSON.stringify(entry)}\n`, 'utf-8')
}

function emptySummary(): UsageSummary {
  return {
    totalCostUsd: 0,
    totalTokens: 0,
    byAgentRole: {},
    byModel: {}
  }
}

export async function getUsageSummary(projectRoot: string): Promise<UsageSummary> {
  const logPath = usageLogPath(projectRoot)
  if (!existsSync(logPath)) return emptySummary()

  const raw = await readFile(logPath, 'utf-8')
  const lines = raw.split('\n').filter((line) => line.trim().length > 0)

  const summary = emptySummary()

  for (const line of lines) {
    let entry: UsageEntry
    try {
      entry = JSON.parse(line) as UsageEntry
    } catch {
      // Skip a malformed/truncated line (e.g. a crash mid-append) rather
      // than letting one bad row break the whole summary.
      continue
    }

    const tokens = entry.inputTokens + entry.outputTokens

    summary.totalCostUsd += entry.estimatedCostUsd
    summary.totalTokens += tokens

    // Standalone embedding/summary-generation calls (Phase 7) have no
    // AgentRole to bucket under — only aggregate this row when one exists.
    if (entry.agentRole) {
      const roleBucket = summary.byAgentRole[entry.agentRole] ?? { costUsd: 0, tokens: 0, calls: 0 }
      roleBucket.costUsd += entry.estimatedCostUsd
      roleBucket.tokens += tokens
      roleBucket.calls += 1
      summary.byAgentRole[entry.agentRole] = roleBucket
    }

    const key = modelKey(entry)
    const modelBucket = summary.byModel[key] ?? { costUsd: 0, tokens: 0, calls: 0 }
    modelBucket.costUsd += entry.estimatedCostUsd
    modelBucket.tokens += tokens
    modelBucket.calls += 1
    summary.byModel[key] = modelBucket
  }

  return summary
}
