import { describe, expect, it } from 'vitest'
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
