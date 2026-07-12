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
  history: { versionId: string; changedAt: string; note: string }[]
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
