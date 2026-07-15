import { describe, expect, it } from 'vitest'
import type { CapabilityManifest } from './schema/capability'
import { compareCapabilityVersions } from './capabilityDiff'

function manifest(partial: Partial<CapabilityManifest> = {}): CapabilityManifest {
  return {
    schemaVersion: 1,
    id: 'project.tools.example',
    name: 'Example',
    description: 'A test capability.',
    type: 'tool',
    scope: 'project',
    owner: 'Test',
    version: '1.0.0',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    requiredContext: [],
    dependsOn: [],
    compatibleAgentRoles: ['Dev-Editor'],
    compatibleModelCapabilities: [],
    sideEffects: 'none',
    permissionCategory: 'none',
    localOnly: false,
    costCharacteristics: {},
    validationStatus: 'untested',
    lifecycleState: 'draft',
    createdBy: 'author',
    history: [],
    ...partial
  }
}

describe('compareCapabilityVersions', () => {
  it('reports only the fields that actually changed between a snapshot and the current manifest', () => {
    const snapshot = manifest({ name: 'Old Name', sideEffects: 'none', lifecycleState: 'draft' })
    const current = manifest({
      name: 'New Name',
      sideEffects: 'reads-project',
      lifecycleState: 'draft',
      history: [{ versionId: 'v2', changedAt: '2026-01-01T00:00:00.000Z', note: 'name/sideEffects changed', snapshot }]
    })

    const diffs = compareCapabilityVersions(current, 'v2')

    expect(diffs.map((d) => d.field).sort()).toEqual(['name', 'sideEffects'])
    expect(diffs.find((d) => d.field === 'name')).toEqual({ field: 'name', before: 'Old Name', after: 'New Name' })
    expect(diffs.find((d) => d.field === 'sideEffects')).toEqual({ field: 'sideEffects', before: 'none', after: 'reads-project' })
  })

  it('returns an empty diff when nothing in the comparable field set changed', () => {
    const snapshot = manifest({ name: 'Same' })
    const current = manifest({
      name: 'Same',
      history: [{ versionId: 'v2', changedAt: '2026-01-01T00:00:00.000Z', note: 'no changes detected', snapshot }]
    })

    expect(compareCapabilityVersions(current, 'v2')).toEqual([])
  })

  it('throws a clear error when the versionId does not exist in history', () => {
    const current = manifest({ history: [] })
    expect(() => compareCapabilityVersions(current, 'missing-version')).toThrow(/no history entry/i)
  })

  it('throws a clear error when the matched history entry predates snapshot support', () => {
    const current = manifest({
      history: [{ versionId: 'v1', changedAt: '2026-01-01T00:00:00.000Z', note: 'Initial version.' }]
    })
    expect(() => compareCapabilityVersions(current, 'v1')).toThrow(/predates snapshot support/i)
  })
})
