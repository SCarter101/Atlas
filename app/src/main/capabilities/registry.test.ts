import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentGoal, AgentRunRecord } from '@shared/schema/agent'
import type { CapabilityManifest } from '@shared/schema/capability'
import { openIndexDb } from '../persistence/db'
import { saveAgentRun } from '../persistence/agentRunStore'
import { cleanupTestDir } from '../testUtils'

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

const {
  createCapability,
  forkCapability,
  getCapability,
  getCapabilityUsageMetrics,
  globalCapabilitiesDir,
  listCapabilities,
  promoteCapability,
  rollbackCapability,
  setLifecycleState,
  testCapability,
  updateCapability
} = await import('./registry')


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
    cleanupTestDir(userDataRoot)
    cleanupTestDir(projectA)
    cleanupTestDir(projectB)
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

  it('updateCapability populates the new history entry snapshot with the pre-change manifest', async () => {
    const created = manifest({ id: 'project.tools.snapshotted', name: 'Snapshotted', scope: 'project', description: 'v1' })
    await createCapability(projectA, created)

    await updateCapability(projectA, { ...created, description: 'v2' })

    const stored = await getCapability(projectA, 'project.tools.snapshotted')
    expect(stored?.history.length).toBe(2)
    expect(stored?.history[1].snapshot?.description).toBe('v1')
  })

  describe('rollbackCapability', () => {
    it('restores an earlier snapshot while preserving the full history chain and appending a new entry', async () => {
      const v1 = manifest({ id: 'project.tools.rollback', name: 'Rollback Me', scope: 'project', description: 'first' })
      await createCapability(projectA, v1)
      await updateCapability(projectA, { ...v1, description: 'second' })

      const afterV2 = await getCapability(projectA, 'project.tools.rollback')
      const v1VersionId = afterV2!.history[0].versionId // seed 'v1' entry has no snapshot; use the v2-time entry instead
      // The entry describing the transition INTO 'second' carries a snapshot of 'first' (v1's state).
      const snapshotOfFirstEntry = afterV2!.history.find((h) => h.snapshot?.description === 'first')!

      await updateCapability(projectA, { ...afterV2!, description: 'third' })
      const beforeRollback = await getCapability(projectA, 'project.tools.rollback')
      expect(beforeRollback?.description).toBe('third')
      expect(beforeRollback?.history.length).toBe(3)

      await rollbackCapability(projectA, 'project.tools.rollback', snapshotOfFirstEntry.versionId)

      const rolledBack = await getCapability(projectA, 'project.tools.rollback')
      expect(rolledBack?.description).toBe('first')
      // History grows (rollback is itself an audited update); nothing from before the rollback is lost.
      expect(rolledBack?.history.length).toBe(4)
      expect(rolledBack?.history.some((h) => h.versionId === v1VersionId)).toBe(true)
    })

    it('rejects rolling back to an entry that predates snapshot support', async () => {
      const created = manifest({ id: 'project.tools.no-snapshot', name: 'No Snapshot', scope: 'project' })
      await createCapability(projectA, created)
      // The seed 'v1' history entry (from the manifest() fixture) has no snapshot field.
      await expect(rollbackCapability(projectA, 'project.tools.no-snapshot', 'v1')).rejects.toThrow(/predates snapshot support/i)
    })

    it('rejects an unknown versionId', async () => {
      await createCapability(projectA, manifest({ id: 'project.tools.unknown-version', name: 'Unknown', scope: 'project' }))
      await expect(rollbackCapability(projectA, 'project.tools.unknown-version', 'nope')).rejects.toThrow(/no history entry/i)
    })
  })

  describe('promoteCapability', () => {
    it('moves a project-scoped capability into the global directory and updates its scope field', async () => {
      await createCapability(projectA, manifest({ id: 'project.tools.promote-me', name: 'Promote Me', scope: 'project' }))

      await promoteCapability(projectA, 'project.tools.promote-me', 'global')

      const stored = await getCapability(projectA, 'project.tools.promote-me')
      expect(stored?.scope).toBe('global')
      // No longer duplicated under the old project-scoped directory.
      const projectOnly = await listManifestsFromDir(join(projectA, 'capabilities'))
      expect(projectOnly.find((m) => m.id === 'project.tools.promote-me')).toBeUndefined()
      const globalOnly = await listManifestsFromDir(join(userDataRoot, 'atlas', 'capabilities'))
      expect(globalOnly.find((m) => m.id === 'project.tools.promote-me')).toBeDefined()
    })

    it('rejects promoting into a scope that already has a same-id capability', async () => {
      // Names are chosen so listCapabilities' name-sort puts the project-scoped
      // one first — getCapability() must resolve the *project* copy (so
      // promoteCapability's own scope !== targetScope check passes) while a
      // same-id *global* copy already sits in the promotion target, so the
      // target-scope collision guard is what actually rejects this.
      await createCapability(projectA, manifest({ id: 'shared.tools.collide', name: 'AAA Project Copy', scope: 'project' }))
      await createCapability(projectA, manifest({ id: 'shared.tools.collide', name: 'ZZZ Global Copy', scope: 'global' }))

      await expect(promoteCapability(projectA, 'shared.tools.collide', 'global')).rejects.toThrow(/already exists/i)
    })

    it('rejects promoting a capability that is already in the target scope', async () => {
      await createCapability(projectA, manifest({ id: 'global.tools.already-global', name: 'Already Global', scope: 'global' }))
      await expect(promoteCapability(projectA, 'global.tools.already-global', 'global')).rejects.toThrow(/already scoped/i)
    })
  })

  describe('forkCapability', () => {
    it('copies a capability under a new id as a fresh draft, leaving the original untouched', async () => {
      await createCapability(
        projectA,
        manifest({ id: 'global.tools.source', name: 'Source Tool', scope: 'global', lifecycleState: 'enabled' })
      )

      await forkCapability(projectA, 'global.tools.source', 'project.tools.forked', 'project')

      const original = await getCapability(projectA, 'global.tools.source')
      expect(original?.lifecycleState).toBe('enabled')

      const forked = await getCapability(projectA, 'project.tools.forked')
      expect(forked?.scope).toBe('project')
      expect(forked?.lifecycleState).toBe('draft')
      expect(forked?.history).toHaveLength(1)
      expect(forked?.history[0].note).toContain('Forked from global.tools.source')
      expect(forked?.history[0].snapshot?.id).toBe('global.tools.source')
    })

    it('rejects forking into an id that already exists', async () => {
      await createCapability(projectA, manifest({ id: 'global.tools.a', name: 'A', scope: 'global' }))
      await createCapability(projectA, manifest({ id: 'project.tools.b', name: 'B', scope: 'project' }))

      await expect(forkCapability(projectA, 'global.tools.a', 'project.tools.b', 'project')).rejects.toThrow(/already exists/i)
    })
  })

  describe('testCapability', () => {
    it('runs a real sandboxed tool when one is registered for the manifest id, and marks validation passed', async () => {
      const wordCountManifest = manifest({
        id: 'global.tools.word-count',
        name: 'Word Count',
        scope: 'global',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
      })
      await createCapability(projectA, wordCountManifest)

      const result = await testCapability(projectA, wordCountManifest, { text: 'four little words here' })

      expect(result.mode).toBe('sandboxed')
      expect(result.ok).toBe(true)
      expect(result.output).toEqual({ wordCount: 4 })

      const stored = await getCapability(projectA, 'global.tools.word-count')
      expect(stored?.validationStatus).toBe('passed')
    })

    it('falls back to a structural check when no SandboxedTool is registered, and passes when required fields are present', async () => {
      const draft = manifest({
        id: 'project.tools.custom-draft',
        name: 'Custom Draft',
        scope: 'project',
        inputSchema: { type: 'object', properties: { foo: { type: 'string' } }, required: ['foo'] }
      })
      await createCapability(projectA, draft)

      const result = await testCapability(projectA, draft, { foo: 'bar' })

      expect(result.mode).toBe('structural')
      expect(result.ok).toBe(true)

      const stored = await getCapability(projectA, 'project.tools.custom-draft')
      expect(stored?.validationStatus).toBe('passed')
    })

    it('fails the structural check when a required field is missing, and marks validation failed', async () => {
      const draft = manifest({
        id: 'project.tools.custom-draft-2',
        name: 'Custom Draft 2',
        scope: 'project',
        inputSchema: { type: 'object', properties: { foo: { type: 'string' } }, required: ['foo'] }
      })
      await createCapability(projectA, draft)

      const result = await testCapability(projectA, draft, { bar: 'baz' })

      expect(result.mode).toBe('structural')
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/missing required field/i)

      const stored = await getCapability(projectA, 'project.tools.custom-draft-2')
      expect(stored?.validationStatus).toBe('failed')
    })

    // Codex adversarial-review regression (Round 11): testCapability used to
    // persist the caller-supplied manifest object verbatim, including its
    // `history` array as the caller happened to have it — so a stale copy
    // (e.g. the renderer's cached `selected` state, a render or two behind
    // a concurrent update) would silently revert fields and drop history
    // entries written to disk in the meantime.
    it('persists against the current on-disk manifest, not a stale caller-supplied copy', async () => {
      const draft = manifest({
        id: 'project.tools.stale-copy',
        name: 'Stale Copy Tool',
        scope: 'project',
        lifecycleState: 'draft',
        inputSchema: { type: 'object', properties: { foo: { type: 'string' } }, required: ['foo'] }
      })
      await createCapability(projectA, draft)

      // The caller's copy is taken before a concurrent update lands.
      const staleCopy = { ...draft }

      // A concurrent update enables the capability and appends its own
      // history entry — simulating another write landing between when the
      // renderer fetched `staleCopy` and when it calls testCapability.
      await setLifecycleState(projectA, draft.id, 'enabled')
      const afterConcurrentUpdate = await getCapability(projectA, draft.id)
      expect(afterConcurrentUpdate?.history.length).toBe(2)

      await testCapability(projectA, staleCopy, { foo: 'bar' })

      const stored = await getCapability(projectA, draft.id)
      // The concurrent update's field change must survive, not be reverted
      // by the stale copy's 'draft' lifecycleState.
      expect(stored?.lifecycleState).toBe('enabled')
      // The concurrent update's history entry must survive, not be dropped
      // by persisting the stale copy's shorter history array.
      expect(stored?.history.length).toBe(3)
      expect(stored?.validationStatus).toBe('passed')
    })
  })

  describe('getCapabilityUsageMetrics', () => {
    function makeGoal(runId: string): AgentGoal {
      return {
        runId,
        agentRole: 'Dev-Editor',
        modelRef: { provider: 'anthropic', modelId: 'claude-opus-4', viaOpenRouter: false },
        userIntent: 'test',
        scope: {},
        constraints: { maxTurns: 4, maxTokens: 4000, maxToolCalls: 3, maxElapsedMs: 30000, allowedCapabilityCategories: [] }
      }
    }

    function runRecord(runId: string, toolCalls: { toolId: string; error?: boolean }[]): AgentRunRecord {
      return {
        schemaVersion: 1,
        goal: makeGoal(runId),
        status: 'completed',
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        steps: toolCalls.map((tc, i) => ({
          stepIndex: i,
          kind: 'tool-call',
          timestamp: new Date().toISOString(),
          detail: {
            toolId: tc.toolId,
            input: {},
            error: tc.error ? { code: 'sandbox-error', message: 'boom', recoverable: true } : undefined
          }
        }))
      }
    }

    it('aggregates invocation/success/failure counts by toolId and estimates cost/tokens from the manifest', async () => {
      await createCapability(
        projectA,
        manifest({
          id: 'global.tools.word-count',
          name: 'Word Count',
          scope: 'global',
          costCharacteristics: { estTokens: 50, estCostUsd: 0.01 }
        })
      )

      const db = await openIndexDb(projectA)
      await saveAgentRun(projectA, db, runRecord('run-1', [{ toolId: 'global.tools.word-count' }]))
      await saveAgentRun(projectA, db, runRecord('run-2', [{ toolId: 'global.tools.word-count', error: true }]))
      await saveAgentRun(projectA, db, runRecord('run-3', [{ toolId: 'global.tools.word-count' }, { toolId: 'global.tools.word-count' }]))

      const metrics = await getCapabilityUsageMetrics(projectA, db)
      const wordCount = metrics.find((m) => m.toolId === 'global.tools.word-count')

      expect(wordCount?.invocations).toBe(4)
      expect(wordCount?.successCount).toBe(3)
      expect(wordCount?.failureCount).toBe(1)
      expect(wordCount?.estimatedTokensSaved).toBe(200)
      expect(wordCount?.estimatedCostSavedUsd).toBeCloseTo(0.04)
    })

    it('resolves versioned pseudo tool ids (foo@1.0.0) against the bare manifest id for cost lookup', async () => {
      await createCapability(
        projectA,
        manifest({
          id: 'global.tools.structural-analysis',
          name: 'Structural Analysis',
          scope: 'global',
          costCharacteristics: { estTokens: 100 }
        })
      )

      const db = await openIndexDb(projectA)
      await saveAgentRun(projectA, db, runRecord('run-1', [{ toolId: 'global.tools.structural-analysis@1.0.0' }]))

      const metrics = await getCapabilityUsageMetrics(projectA, db)
      const found = metrics.find((m) => m.toolId === 'global.tools.structural-analysis@1.0.0')
      expect(found?.estimatedTokensSaved).toBe(100)
    })
  })
})

async function listManifestsFromDir(dir: string): Promise<CapabilityManifest[]> {
  if (!existsSync(dir)) return []
  const { listManifestsFrom } = await import('../persistence/capabilityStore')
  return listManifestsFrom(dir)
}
