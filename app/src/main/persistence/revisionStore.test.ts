import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SceneMeta } from '@shared/schema/manuscript'
import { createSnapshot, diffSnapshots, getSnapshot, listSnapshots } from './revisionStore'

const SCENE_META: SceneMeta = {
  schemaVersion: 1,
  id: 'scene-1',
  chapterId: 'chapter-1',
  order: 0,
  title: 'Test Scene',
  wordCount: 3,
  status: 'drafting',
  updatedAt: new Date().toISOString()
}

describe('revisionStore', () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-revision-test-'))
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  describe('createSnapshot / listSnapshots / getSnapshot', () => {
    it('round-trips a snapshot through create, list, and get', async () => {
      const { snapshotId } = await createSnapshot(projectRoot, 'scene-1', 'The cat sat.', SCENE_META, 'First draft')

      const list = await listSnapshots(projectRoot, 'scene-1')
      expect(list).toHaveLength(1)
      expect(list[0].snapshotId).toBe(snapshotId)
      expect(list[0].label).toBe('First draft')

      const full = await getSnapshot(projectRoot, 'scene-1', snapshotId)
      expect(full.prose).toBe('The cat sat.')
      expect(full.sceneId).toBe('scene-1')
      expect(full.meta.title).toBe('Test Scene')
    })

    it('lists snapshots newest-first', async () => {
      const first = await createSnapshot(projectRoot, 'scene-1', 'Version one', SCENE_META)
      await new Promise((resolve) => setTimeout(resolve, 5))
      const second = await createSnapshot(projectRoot, 'scene-1', 'Version two', SCENE_META)

      const list = await listSnapshots(projectRoot, 'scene-1')
      expect(list.map((s) => s.snapshotId)).toEqual([second.snapshotId, first.snapshotId])
    })

    it('returns an empty list for a scene with no snapshots yet', async () => {
      const list = await listSnapshots(projectRoot, 'scene-with-no-history')
      expect(list).toEqual([])
    })
  })

  describe('diffSnapshots', () => {
    it('marks identical text as entirely equal', () => {
      const runs = diffSnapshots('The cat sat on the mat.', 'The cat sat on the mat.')
      expect(runs.every((r) => r.type === 'equal')).toBe(true)
    })

    it('detects a simple word substitution as remove + add', () => {
      const runs = diffSnapshots('The cat sat on the mat.', 'The dog sat on the mat.')
      expect(runs.some((r) => r.type === 'remove' && r.text.includes('cat'))).toBe(true)
      expect(runs.some((r) => r.type === 'add' && r.text.includes('dog'))).toBe(true)
      expect(runs.some((r) => r.type === 'equal' && r.text.includes('sat'))).toBe(true)
    })

    it('detects a pure insertion as an add run with the rest equal', () => {
      // "calmly" is inserted mid-sentence, with the surrounding words
      // (including the trailing punctuation) identical in both texts, so
      // this exercises a real add with no incidental token-boundary diffs.
      const runs = diffSnapshots('Ray parked the Bronco and waited.', 'Ray parked the Bronco and calmly waited.')
      const adds = runs.filter((r) => r.type === 'add')
      expect(adds.length).toBeGreaterThan(0)
      expect(adds.map((r) => r.text).join(' ')).toContain('calmly')
      expect(runs.some((r) => r.type === 'remove')).toBe(false)
    })

    it('detects a pure deletion as a remove run with the rest equal', () => {
      const runs = diffSnapshots('Ray parked the Bronco and calmly waited.', 'Ray parked the Bronco and waited.')
      expect(runs.some((r) => r.type === 'remove')).toBe(true)
      expect(runs.some((r) => r.type === 'add')).toBe(false)
    })

    it('treats two empty strings as producing no runs', () => {
      expect(diffSnapshots('', '')).toEqual([])
    })
  })
})
