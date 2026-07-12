import { randomUUID } from 'node:crypto'
import type { SessionApproval } from '@shared/schema/capability'

export interface PermissionCheckRequest {
  capabilityId: string
  actionType: string
  dataScope: string
  destination?: string
}

// Main-process counterpart to the renderer's local sessionApprovals zustand
// state (state/store.ts) — one instance per ProjectSession (see
// projectSession.ts), in-memory only, discarded when the session ends.
// Matching logic ported verbatim from store.ts's handleAgentStep()
// matchingApproval lookup: spec §13 says a session approval only covers the
// exact named capability, action type, data scope, and destination it was
// granted for.
export class SessionApprovalStore {
  private approvals: SessionApproval[] = []

  checkApproval(req: PermissionCheckRequest): SessionApproval | undefined {
    return this.approvals.find(
      (a) =>
        a.capabilityId === req.capabilityId &&
        a.actionType === req.actionType &&
        a.dataScope === req.dataScope &&
        a.destination === req.destination
    )
  }

  grantApproval(approval: SessionApproval): void {
    this.approvals.push(approval)
  }

  listApprovals(): SessionApproval[] {
    return [...this.approvals]
  }

  revokeApproval(id: string): void {
    this.approvals = this.approvals.filter((a) => a.id !== id)
  }
}

// Ported from store.ts's resolvePermission(): PermissionRequest has no
// separate version field, so capabilityId strings that embed a version as a
// "@x.y.z" suffix (e.g. "global.tools.line-edit-scan@1.0.0") have it parsed
// off; otherwise the whole capabilityId is used as the version.
export function buildSessionApproval(request: PermissionCheckRequest): SessionApproval {
  const atIndex = request.capabilityId.lastIndexOf('@')
  const capabilityVersion = atIndex >= 0 ? request.capabilityId.slice(atIndex + 1) : request.capabilityId

  return {
    id: randomUUID(),
    capabilityId: request.capabilityId,
    capabilityVersion,
    actionType: request.actionType,
    dataScope: request.dataScope,
    destination: request.destination,
    grantedAt: new Date().toISOString(),
    expiresAtSessionEnd: true
  }
}
