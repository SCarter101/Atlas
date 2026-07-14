// Migration runner — see "Atlas Architecture and Data Contracts.md" §7
// (Testing and Migration Strategy): every persisted shape carries
// `schemaVersion`, and a migrations registry maps
// `(typeName, fromVersion) -> migrationFn`. On project open (or any read of a
// persisted record), the record is run through `migrateRecord` before use so
// that a future schema bump "just works" without further plumbing changes.
//
// Round 10/Phase 9 registers the first real migration below (SceneMeta
// v1 -> v2); every other schema in `@shared/schema/*` is still at
// `schemaVersion: 1` with nothing registered for it. Tests additionally
// register fake entries under distinctive type names (e.g. `__TestFixture`)
// to exercise the generic mechanism without touching any real record type.

import type { SceneMeta } from '@shared/schema/manuscript'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MigrationFn = (record: any) => any

// typeName -> fromSchemaVersion -> migration to (fromSchemaVersion + 1)
type MigrationRegistry = Record<string, Record<number, MigrationFn>>

export const migrationRegistry: MigrationRegistry = {}

/**
 * Registers a migration for `typeName` from `fromVersion` to
 * `fromVersion + 1`. Called once below for the real `SceneMeta` v1->v2
 * migration, and by tests to exercise the mechanism generically.
 */
export function registerMigration(typeName: string, fromVersion: number, migrate: MigrationFn): void {
  const forType = (migrationRegistry[typeName] ??= {})
  forType[fromVersion] = migrate
}

const MAX_MIGRATION_STEPS = 100

/**
 * Repeatedly applies registered migrations to `record` until either no
 * migration is registered for its current `schemaVersion`, or a safety cap
 * on steps is reached (guards against a misconfigured registry looping
 * forever). Returns the record unchanged when no migration applies — still
 * the common case for every schema other than `SceneMeta`, which is at v1
 * with no migration registered.
 */
export function migrateRecord<T extends { schemaVersion: number }>(typeName: string, record: T): T {
  let current: { schemaVersion: number } = record
  const forType = migrationRegistry[typeName]
  if (!forType) return record

  for (let step = 0; step < MAX_MIGRATION_STEPS; step++) {
    const migrate = forType[current.schemaVersion]
    if (!migrate) break
    current = migrate(current)
  }

  return current as T
}

// ---------------------------------------------------------------------------
// Real migrations
// ---------------------------------------------------------------------------

// SceneMeta v1 -> v2 (Round 10/Phase 9): `localModelOnly` (Round 6/Phase 5's
// privacy flag — see shared/privacy.ts, main/ipc/handlers.ts's AgentRunStart
// cloud-consent gate) was added to SceneMeta after v1 scenes already existed
// on disk, so a pre-existing scene's `.meta.json` simply doesn't have the
// key at all. Every current consumer already treats that missing key
// defensively as falsy (`if (scene?.meta.localModelOnly)`), so this isn't a
// live crash — but the on-disk shape itself stays ambiguous between "this
// scene was explicitly marked cloud-eligible" and "this scene predates the
// flag entirely". This migration removes that ambiguity: any SceneMeta read
// through migrateRecord() is guaranteed to carry an explicit boolean.
//
// SceneMetaV1 mirrors the real pre-v2 on-disk shape: identical to the
// current SceneMeta type except schemaVersion is still 1 and localModelOnly
// may be absent outright (not just `undefined`-typed — genuinely missing
// from the parsed JSON on old files).
type SceneMetaV1 = Omit<SceneMeta, 'schemaVersion' | 'localModelOnly'> & {
  schemaVersion: 1
  localModelOnly?: boolean
}

registerMigration(
  'SceneMeta',
  1,
  (record: SceneMetaV1): SceneMeta => ({
    ...record,
    schemaVersion: 2,
    localModelOnly: record.localModelOnly ?? false
  })
)
