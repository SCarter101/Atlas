import type { AgentRole } from './agent'

export type CapabilityType = 'tool' | 'skill'
export type CapabilityScope = 'global' | 'project'
export type CapabilitySideEffects = 'none' | 'reads-project' | 'writes-project' | 'network' | 'filesystem-external'
export type ValidationStatus = 'untested' | 'passed' | 'failed'
export type LifecycleState = 'draft' | 'enabled' | 'disabled' | 'deprecated'

// Minimal JSON Schema surface — enough for manifest input/output declarations
// without pulling in a full JSON Schema type dependency.
export interface JsonSchema {
  type?: string
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  required?: string[]
  description?: string
  [key: string]: unknown
}

export interface CapabilityManifest {
  schemaVersion: 1
  id: string
  name: string
  description: string
  type: CapabilityType
  scope: CapabilityScope
  owner: string
  version: string
  inputSchema: JsonSchema
  outputSchema: JsonSchema
  requiredContext: string[]
  dependsOn: string[]
  compatibleAgentRoles: AgentRole[]
  compatibleModelCapabilities: string[]
  sideEffects: CapabilitySideEffects
  permissionCategory: string
  localOnly: boolean
  costCharacteristics: { estTokens?: number; estTimeMs?: number; estCostUsd?: number }
  validationStatus: ValidationStatus
  lifecycleState: LifecycleState
  createdBy: 'author' | 'agent-generated'
  // `snapshot` mirrors CodexVersion.snapshot's role in shared/schema/codex.ts
  // (a pre-change capture used to reconstruct an earlier state) but is typed
  // as the full CapabilityManifest rather than a loose Record, since
  // rollbackCapability() (main/capabilities/registry.ts) needs every field —
  // not just a diffable subset — to actually restore a version. Optional
  // because history entries written before Phase-9-Track-3 snapshot support
  // predate this field; rollback/compare must degrade gracefully (reject
  // clearly, not crash) when it's absent.
  history: { versionId: string; changedAt: string; note: string; snapshot?: CapabilityManifest }[]
}

// Result shape for main/capabilities/registry.ts's testCapability(). `mode`
// tells the caller/UI which check actually ran — 'sandboxed' only when
// getSeedTool(manifest.id) resolves to a real SandboxedTool (see
// seedTools.ts); every writer-authored draft manifest (there is no
// capability-authoring code UI in this app) falls back to 'structural',
// which validates sampleInput's shape against inputSchema.required rather
// than executing anything real. The UI must display which mode ran rather
// than implying a full execution test happened either way.
export interface CapabilityTestResult {
  ok: boolean
  output?: unknown
  error?: string
  mode: 'sandboxed' | 'structural'
}

// Result shape for main/capabilities/registry.ts's getCapabilityUsageMetrics().
// ESTIMATE ONLY: estimatedTokensSaved/estimatedCostSavedUsd are
// invocations * the capability's own self-declared costCharacteristics —
// there is no real "what would this have cost without the tool" measurement
// behind these numbers, matching this app's honest-placeholder convention.
export interface CapabilityUsageMetric {
  toolId: string
  invocations: number
  successCount: number
  failureCount: number
  estimatedTokensSaved: number
  estimatedCostSavedUsd: number
}

export interface SessionApproval {
  id: string
  capabilityId: string
  capabilityVersion: string
  actionType: string
  dataScope: string
  destination?: string
  grantedAt: string
  expiresAtSessionEnd: true
}
