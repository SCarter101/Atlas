// Migration runner — see "Atlas Architecture and Data Contracts.md" §7
// (Testing and Migration Strategy): every persisted shape carries
// `schemaVersion`, and a migrations registry maps
// `(typeName, fromVersion) -> migrationFn`. On project open (or any read of a
// persisted record), the record is run through `migrateRecord` before use so
// that a future schema bump "just works" without further plumbing changes.
//
// The registry is intentionally empty in real usage today — every schema in
// `@shared/schema/*` is still at `schemaVersion: 1` and nothing has ever
// bumped past it. Tests register fake entries under distinctive type names
// (e.g. `__TestFixture`) to prove the mechanism without affecting any real
// record type.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MigrationFn = (record: any) => any

// typeName -> fromSchemaVersion -> migration to (fromSchemaVersion + 1)
type MigrationRegistry = Record<string, Record<number, MigrationFn>>

export const migrationRegistry: MigrationRegistry = {}

/**
 * Registers a migration for `typeName` from `fromVersion` to
 * `fromVersion + 1`. Exposed mainly for tests; production code should not
 * need to call this until a real v2 schema exists.
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
 * forever). Returns the record unchanged when no migration applies — the
 * common case today, since every real type is still at v1 with no
 * migrations registered.
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
