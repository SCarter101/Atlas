import type { AtlasDb } from './persistence/db'
import { openIndexDb } from './persistence/db'
import { AgentRunManager } from './agent/simulator'
import { SessionApprovalStore } from './permissions/sessionApprovals'

// Atlas opens one project at a time in this build (matches the Phase 2
// scope — multi-project/multi-window is not required yet). This object is
// the single source of "which project + index db + agent runtime is live"
// for the main process's IPC handlers.
export class ProjectSession {
  private constructor(
    readonly projectRoot: string,
    readonly db: AtlasDb,
    readonly agentRuns: AgentRunManager,
    readonly approvals: SessionApprovalStore
  ) {}

  static async create(projectRoot: string): Promise<ProjectSession> {
    const db = await openIndexDb(projectRoot)
    const approvals = new SessionApprovalStore()
    return new ProjectSession(projectRoot, db, new AgentRunManager(projectRoot, db, approvals), approvals)
  }

  close(): void {
    this.db.persist()
  }
}

let current: ProjectSession | null = null

export function setCurrentProjectSession(session: ProjectSession): void {
  current?.close()
  current = session
}

export function getCurrentProjectSession(): ProjectSession {
  if (!current) {
    throw new Error('No project is open yet')
  }
  return current
}
