import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentRunRecord } from '@shared/schema/agent'
import type { AtlasDb } from './db'
import { listAgentRunIndex, upsertAgentRunIndex } from './db'
import { migrateRecord } from './migrations'
import { projectPaths } from './paths'

export async function saveAgentRun(projectRoot: string, db: AtlasDb, record: AgentRunRecord): Promise<void> {
  const dir = projectPaths(projectRoot).agentRunsDir
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${record.goal.runId}.json`), JSON.stringify(record, null, 2), 'utf-8')

  upsertAgentRunIndex(db, {
    runId: record.goal.runId,
    agentRole: record.goal.agentRole,
    status: record.status,
    startedAt: record.startedAt,
    endedAt: record.endedAt
  })
}

export async function loadAgentRun(projectRoot: string, runId: string): Promise<AgentRunRecord> {
  const dir = projectPaths(projectRoot).agentRunsDir
  const raw = await readFile(join(dir, `${runId}.json`), 'utf-8')
  return migrateRecord('AgentRunRecord', JSON.parse(raw) as AgentRunRecord)
}

export function listAgentRuns(
  projectRoot: string,
  db: AtlasDb
): { runId: string; agentRole: string; status: string; startedAt: string; endedAt?: string }[] {
  return listAgentRunIndex(db)
}
