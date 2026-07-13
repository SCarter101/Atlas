// Phase 6: main-process-side tracking of the writer's cloud-model consent
// decision, mirroring SessionApprovalStore's shape/style (see
// sessionApprovals.ts) but matching the renderer's actual consent semantics.
// state/store.ts's `cloudAuthGrantedThisSession` is ONE session-wide
// boolean, not per-provider/per-capability like SessionApproval — so this
// store is deliberately simpler: a single sessionGranted flag plus a set of
// individually-authorized-once runIds.
//
// The consent *dialog* itself stays renderer-side (CloudConsentDialog /
// AgentRail.tsx's authorizeRun) — this store exists so the AgentRunStart IPC
// handler can enforce the invariant even for a run started via a direct
// bridge call that bypassed the renderer's own gate, the same
// defense-in-depth reasoning as the existing `localModelOnly` main-side
// check in handlers.ts.
export class CloudConsentSessionStore {
  private sessionGranted = false
  private onceRunIds = new Set<string>()
  // Matches the renderer's PrivacySettings default (store.ts:
  // `privacySettings: { requireCloudAuth: true, ... }`).
  private _requireCloudAuth = true

  grantSession(): void {
    this.sessionGranted = true
  }

  grantOnce(runId: string): void {
    this.onceRunIds.add(runId)
  }

  hasConsent(runId: string): boolean {
    return this.sessionGranted || this.onceRunIds.has(runId)
  }

  setRequireCloudAuth(value: boolean): void {
    this._requireCloudAuth = value
  }

  get requireCloudAuth(): boolean {
    return this._requireCloudAuth
  }
}
