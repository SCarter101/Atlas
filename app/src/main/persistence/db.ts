import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'
import { projectPaths } from './paths'

// index.sqlite is a derived cache — see "Atlas Architecture and Data
// Contracts.md" §4. Every table here can be dropped and rebuilt by
// re-walking the project folder; nothing here is a source of truth.
//
// Backed by sql.js (SQLite compiled to WASM) rather than better-sqlite3 so
// opening a project never requires a native-module rebuild step — no
// Visual Studio / node-gyp dependency, and no per-Electron-version rebuild.
// The tradeoff is that sql.js is in-memory, so every write is followed by
// an explicit persist() that serializes the whole db back to disk. That's
// fine at this project's scale (a single writer's SQLite index).
export interface AtlasDb {
  db: SqlJsDatabase
  persist: () => void
}

export async function openIndexDb(projectRoot: string): Promise<AtlasDb> {
  const SQL = await initSqlJs()
  mkdirSync(projectRoot, { recursive: true })
  const filePath = projectPaths(projectRoot).indexDb
  const existing = existsSync(filePath) ? readFileSync(filePath) : undefined
  const db = new SQL.Database(existing)

  db.run(`
    CREATE TABLE IF NOT EXISTS scenes (
      id TEXT PRIMARY KEY,
      chapter_id TEXT NOT NULL,
      relative_dir TEXT NOT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      pov_character_id TEXT,
      status TEXT NOT NULL,
      word_count INTEGER NOT NULL,
      order_in_chapter INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS codex_entries (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      is_private INTEGER NOT NULL,
      approved_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS codex_relationships (
      source_entry_id TEXT NOT NULL,
      target_entry_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      PRIMARY KEY (source_entry_id, target_entry_id, kind)
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      run_id TEXT PRIMARY KEY,
      agent_role TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT
    );
  `)

  const atlasDb: AtlasDb = {
    db,
    persist: () => writeFileSync(filePath, Buffer.from(db.export()))
  }
  if (!existing) atlasDb.persist()
  return atlasDb
}

export function upsertSceneIndex(
  atlasDb: AtlasDb,
  row: {
    id: string
    chapterId: string
    relativeDir: string
    slug: string
    title: string
    povCharacterId?: string
    status: string
    wordCount: number
    orderInChapter: number
    updatedAt: string
  }
): void {
  atlasDb.db.run(
    `INSERT INTO scenes (id, chapter_id, relative_dir, slug, title, pov_character_id, status, word_count, order_in_chapter, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       chapter_id=excluded.chapter_id, relative_dir=excluded.relative_dir, slug=excluded.slug,
       title=excluded.title, pov_character_id=excluded.pov_character_id, status=excluded.status,
       word_count=excluded.word_count, order_in_chapter=excluded.order_in_chapter, updated_at=excluded.updated_at`,
    [
      row.id,
      row.chapterId,
      row.relativeDir,
      row.slug,
      row.title,
      row.povCharacterId ?? null,
      row.status,
      row.wordCount,
      row.orderInChapter,
      row.updatedAt
    ]
  )
  atlasDb.persist()
}

export function findSceneLocation(
  atlasDb: AtlasDb,
  sceneId: string
): { relativeDir: string; slug: string } | undefined {
  const stmt = atlasDb.db.prepare(`SELECT relative_dir as relativeDir, slug FROM scenes WHERE id = ?`)
  try {
    stmt.bind([sceneId])
    if (!stmt.step()) return undefined
    return stmt.getAsObject() as unknown as { relativeDir: string; slug: string }
  } finally {
    stmt.free()
  }
}

export function upsertCodexIndex(
  atlasDb: AtlasDb,
  entry: {
    id: string
    type: string
    name: string
    status: string
    isPrivate: boolean
    approvedAt?: string
    updatedAt: string
  }
): void {
  atlasDb.db.run(
    `INSERT INTO codex_entries (id, type, name, status, is_private, approved_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       type=excluded.type, name=excluded.name, status=excluded.status,
       is_private=excluded.is_private, approved_at=excluded.approved_at, updated_at=excluded.updated_at`,
    [entry.id, entry.type, entry.name, entry.status, entry.isPrivate ? 1 : 0, entry.approvedAt ?? null, entry.updatedAt]
  )
  atlasDb.persist()
}

export function deleteCodexIndex(atlasDb: AtlasDb, id: string): void {
  atlasDb.db.run(`DELETE FROM codex_entries WHERE id = ?`, [id])
  atlasDb.persist()
}

export function upsertAgentRunIndex(
  atlasDb: AtlasDb,
  row: { runId: string; agentRole: string; status: string; startedAt: string; endedAt?: string }
): void {
  atlasDb.db.run(
    `INSERT INTO agent_runs (run_id, agent_role, status, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(run_id) DO UPDATE SET
       agent_role=excluded.agent_role, status=excluded.status,
       started_at=excluded.started_at, ended_at=excluded.ended_at`,
    [row.runId, row.agentRole, row.status, row.startedAt, row.endedAt ?? null]
  )
  atlasDb.persist()
}
