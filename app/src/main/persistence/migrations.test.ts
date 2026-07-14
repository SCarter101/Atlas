import { mkdtempSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openIndexDb, type AtlasDb } from './db'
import { sceneFilePaths } from './paths'
import { readScene, writeScene } from './sceneStore'
import { migrateRecord, registerMigration } from './migrations'

// Distinctive, test-only type name — never used by any real persisted
// schema — so registering a migration for it can't accidentally fire on a
// real record type read elsewhere in the app.
const TEST_TYPE = '__TestFixture'

interface TestFixtureV1 {
  schemaVersion: 1
  id: string
  name: string
}

interface TestFixtureV2 {
  schemaVersion: 2
  id: string
  name: string
  greeting: string
}

registerMigration(TEST_TYPE, 1, (record: TestFixtureV1): TestFixtureV2 => ({
  schemaVersion: 2,
  id: record.id,
  name: record.name,
  greeting: `Hello, ${record.name}!`
}))

describe('migrateRecord', () => {
  it('applies a registered migration and bumps schemaVersion', () => {
    const v1: TestFixtureV1 = { schemaVersion: 1, id: 'fixture-1', name: 'Atlas' }

    const migrated = migrateRecord(TEST_TYPE, v1)

    expect(migrated.schemaVersion).toBe(2)
    expect((migrated as unknown as TestFixtureV2).greeting).toBe('Hello, Atlas!')
  })

  it('chains multiple migrations until no further migration is registered', () => {
    registerMigration(TEST_TYPE, 2, (record: TestFixtureV2) => ({
      ...record,
      schemaVersion: 3,
      greeting: `${record.greeting} (v3)`
    }))

    const v1: TestFixtureV1 = { schemaVersion: 1, id: 'fixture-2', name: 'Rowan' }
    const migrated = migrateRecord(TEST_TYPE, v1) as unknown as { schemaVersion: number; greeting: string }

    expect(migrated.schemaVersion).toBe(3)
    expect(migrated.greeting).toBe('Hello, Rowan! (v3)')
  })

  it('returns the record unchanged when no type is registered at all (real-world default)', () => {
    const record = { schemaVersion: 1, id: 'proj-1', title: 'Untitled Project' }

    const result = migrateRecord('ProjectManifest', record)

    expect(result).toBe(record)
  })

  it('returns the record unchanged when no migration is registered for its current version', () => {
    // fromVersion 5 has no registered migration for TEST_TYPE, so this
    // should pass through untouched even though the type itself has entries
    // registered for other versions.
    const record = { schemaVersion: 5, id: 'fixture-3', name: 'Static' }

    const result = migrateRecord(TEST_TYPE, record)

    expect(result).toBe(record)
    expect(result.schemaVersion).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// Real migration: SceneMeta v1 -> v2 (Round 10/Phase 9)
//
// `localModelOnly` (main/persistence/migrations.ts's registered 'SceneMeta'
// migration) was added to SceneMeta after v1 scenes already existed on
// disk, so a real pre-existing scene's .meta.json simply has no
// `localModelOnly` key at all. These tests prove migrateRecord() (imported
// above, already registered by migrations.ts's own module-level
// registerMigration call — nothing to register here) upgrades that shape on
// read, first as a direct in-memory check, then via the real
// main/persistence/sceneStore.ts read path against a genuine file on disk.
// ---------------------------------------------------------------------------

describe('real migration: SceneMeta v1 -> v2 (localModelOnly)', () => {
  it('migrateRecord fills a default and bumps schemaVersion for a genuine v1-shaped record', () => {
    // A real pre-Phase-5 SceneMeta shape: no `localModelOnly` key exists at
    // all (not `localModelOnly: undefined` — the key is simply absent, as
    // it would be after JSON.parse of an old .meta.json file).
    const v1Record = {
      schemaVersion: 1,
      id: 'scene-1',
      chapterId: 'chapter-1',
      order: 0,
      title: 'Test Scene',
      wordCount: 12,
      status: 'drafting',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    expect('localModelOnly' in v1Record).toBe(false)

    const migrated = migrateRecord('SceneMeta', v1Record) as typeof v1Record & {
      schemaVersion: number
      localModelOnly: boolean
    }

    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.localModelOnly).toBe(false)
    // Everything else about the record survives untouched.
    expect(migrated.id).toBe('scene-1')
    expect(migrated.title).toBe('Test Scene')
  })

  it('preserves an explicit localModelOnly value already present on a v1 record', () => {
    const v1Record = {
      schemaVersion: 1,
      id: 'scene-2',
      chapterId: 'chapter-1',
      order: 1,
      title: 'Local-Only Scene',
      wordCount: 5,
      status: 'drafting',
      updatedAt: '2026-01-01T00:00:00.000Z',
      localModelOnly: true
    }

    const migrated = migrateRecord('SceneMeta', v1Record) as typeof v1Record

    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.localModelOnly).toBe(true)
  })

  describe('end-to-end through the real sceneStore read path', () => {
    let projectRoot: string
    let db: AtlasDb

    beforeEach(async () => {
      projectRoot = mkdtempSync(join(tmpdir(), 'atlas-migration-test-'))
      db = await openIndexDb(projectRoot)
    })

    afterEach(() => {
      rmSync(projectRoot, { recursive: true, force: true })
    })

    it('upgrades a genuine v1 .meta.json file on disk when readScene() reads it back', async () => {
      const relativeDir = 'book-1/part-1/chapter-1'
      const slug = 'scene-1'

      // writeScene() + the index it maintains only exist to get a real
      // scene location registered in the sqlite index — the file it writes
      // is immediately overwritten below with a genuine v1 shape (no
      // schemaVersion:2, no localModelOnly key), simulating a scene that
      // was last saved before this migration existed.
      await writeScene(
        projectRoot,
        db,
        'scene-1',
        { meta: { id: 'scene-1', chapterId: 'chapter-1', order: 0, title: 'Test Scene' }, prose: 'Some prose.' },
        relativeDir,
        slug
      )

      const { metaFile } = sceneFilePaths(projectRoot, relativeDir, slug)
      const v1Meta = {
        schemaVersion: 1,
        id: 'scene-1',
        chapterId: 'chapter-1',
        order: 0,
        title: 'Test Scene',
        wordCount: 2,
        status: 'drafting',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
      await writeFile(metaFile, JSON.stringify(v1Meta, null, 2), 'utf-8')

      const { meta, prose } = await readScene(projectRoot, db, 'scene-1')

      expect(meta.schemaVersion).toBe(2)
      expect(meta.localModelOnly).toBe(false)
      expect(meta.title).toBe('Test Scene')
      expect(prose).toBe('Some prose.')
    })
  })
})
