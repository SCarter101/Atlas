import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CapabilityManifest } from '@shared/schema/capability'

// registry.ts calls electron's app.getPath('userData') to locate the real
// global capability directory — outside a running Electron process (i.e.
// under vitest) the 'electron' package resolves to a path string, not
// { app }, so it's mocked here the way any other Electron-runtime-only API
// would be in a main-process unit test. vi.mock calls are hoisted above
// imports by vitest, so the static import of ./registry below picks up
// this mock.
let userDataDir = ''
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return userDataDir
      throw new Error(`unexpected app.getPath(${name}) in test`)
    }
  }
}))

const { createCapability, getCapability, globalCapabilitiesDir, listCapabilities, setLifecycleState, updateCapability } =
  await import('./registry')


function manifest(partial: Partial<CapabilityManifest> & Pick<CapabilityManifest, 'id' | 'name' | 'scope'>): CapabilityManifest {
  const now = '2026-01-01T00:00:00.000Z'
  return {
    schemaVersion: 1,
    description: 'A test capability.',
    type: 'tool',
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
    history: [{ versionId: 'v1', changedAt: now, note: 'Initial creation.' }],
    ...partial
  }
}

describe('capabilities/registry — global vs project scope', () => {
  let userDataRoot: string
  let projectA: string
  let projectB: string

  beforeEach(() => {
    userDataRoot = mkdtempSync(join(tmpdir(), 'atlas-userdata-'))
    userDataDir = userDataRoot
    projectA = mkdtempSync(join(tmpdir(), 'atlas-projectA-'))
    projectB = mkdtempSync(join(tmpdir(), 'atlas-projectB-'))
  })

  afterEach(() => {
    rmSync(userDataRoot, { recursive: true, force: true })
    rmSync(projectA, { recursive: true, force: true })
    rmSync(projectB, { recursive: true, force: true })
  })

  it('globalCapabilitiesDir() lives under app.getPath("userData")/atlas/capabilities', () => {
    expect(globalCapabilitiesDir()).toBe(join(userDataRoot, 'atlas', 'capabilities'))
  })

  it('merges global and project manifests, and a project-scope capability does not leak into a different project', async () => {
    await createCapability(projectA, manifest({ id: 'global.tools.shared', name: 'Shared Tool', scope: 'global' }))
    await createCapability(projectA, manifest({ id: 'project.tools.only-a', name: 'Only A', scope: 'project' }))
    await createCapability(projectB, manifest({ id: 'project.tools.only-b', name: 'Only B', scope: 'project' }))

    const listA = await listCapabilities(projectA)
    const listB = await listCapabilities(projectB)

    expect(listA.map((m) => m.id).sort()).toEqual(['global.tools.shared', 'project.tools.only-a'])
    expect(listB.map((m) => m.id).sort()).toEqual(['global.tools.shared', 'project.tools.only-b'])

    expect(listA.find((m) => m.id === 'global.tools.shared')?.scope).toBe('global')
    expect(listA.find((m) => m.id === 'project.tools.only-a')?.scope).toBe('project')
  })

  it('getCapability finds a manifest by id regardless of which root it lives under', async () => {
    await createCapability(projectA, manifest({ id: 'global.tools.findme', name: 'Find Me', scope: 'global' }))
    const found = await getCapability(projectB, 'global.tools.findme')
    expect(found?.name).toBe('Find Me')
  })

  it('updateCapability appends a history entry diffed against the previous version', async () => {
    const created = manifest({ id: 'project.tools.versioned', name: 'Versioned', scope: 'project', lifecycleState: 'draft' })
    await createCapability(projectA, created)

    const updated = { ...created, lifecycleState: 'enabled' as const }
    await updateCapability(projectA, updated)

    const stored = await getCapability(projectA, 'project.tools.versioned')
    expect(stored?.lifecycleState).toBe('enabled')
    expect(stored?.history.length).toBe(2)
    expect(stored?.history[1].note).toContain('lifecycleState: draft → enabled')
  })

  it('setLifecycleState loads, mutates, and persists just the lifecycle field', async () => {
    await createCapability(projectA, manifest({ id: 'project.tools.lifecycle', name: 'Lifecycle', scope: 'project' }))
    await setLifecycleState(projectA, 'project.tools.lifecycle', 'disabled')

    const stored = await getCapability(projectA, 'project.tools.lifecycle')
    expect(stored?.lifecycleState).toBe('disabled')
  })
})
