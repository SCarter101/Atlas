import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'
import { cosineSimilarity } from '../retrieval/vectorize'
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

    CREATE TABLE IF NOT EXISTS vectors (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      vector BLOB NOT NULL
    );
  `)

  // Phase 7: vectors gained a nullable `model` tag so real-embedding vectors
  // (e.g. LM Studio's nomic-embed-text, dims 768) never get cosine-compared
  // against the pre-Phase-7 hashing-trick vectors (dims 256) or against each
  // other's different embedding spaces. A plain CREATE TABLE change doesn't
  // reach a db file that already exists on disk (loaded via readFileSync
  // above), so this is a one-time additive ALTER TABLE, guarded by a
  // PRAGMA check since SQLite has no "ADD COLUMN IF NOT EXISTS". Rows
  // written before this migration keep a NULL model (treated as the legacy
  // hashing space by callers) rather than being dropped — this table is a
  // derived cache per the file header, but there's no reason to force a
  // full re-embed when a non-destructive column add works just as well.
  const vectorsColumns = db.exec(`PRAGMA table_info(vectors)`)
  const hasModelColumn = vectorsColumns[0]?.values.some((row) => row[1] === 'model') ?? false
  if (!hasModelColumn) {
    db.run(`ALTER TABLE vectors ADD COLUMN model TEXT`)
  }

  const atlasDb: AtlasDb = {
    db,
    persist: () => writeFileSync(filePath, Buffer.from(db.export()))
  }
  if (!existing) atlasDb.persist()
  return atlasDb
}

// Round 10 / Phase 9 Track C (performance): every upsert* helper below calls
// atlasDb.persist() unconditionally after each write, which serializes the
// *entire* in-memory database (db.export()) and rewrites index.sqlite from
// scratch (see the file-header comment above — sql.js has no incremental
// persistence). That's the right default for a single interactive save
// (one scene write, one Codex edit), but a bulk pass that writes many rows
// in a row — a full retrieval reindex over an existing project
// (retrieval/search.ts's ensureIndexed()) or importing a many-scene
// manuscript (import/importManuscript.ts) — was calling it once per row,
// so the total serialized-byte count written to disk grew roughly with the
// square of the row count (each persist() re-serializes everything written
// so far, not just the new row). Measured on a ~120k-word/450-scene fixture:
// a full ensureIndexed() pass dropped from over a minute to well under a
// second once batched (see search.perf.test.ts).
//
// withBatchedPersist swaps `atlasDb.persist` for a no-op that just marks the
// batch dirty, runs `fn`, then restores the real persist and calls it once
// (only if something was actually written). Every table this touches
// (scenes, codex_entries, vectors) is a documented rebuildable cache — see
// this file's header and the `vectors.model` column comment below — so
// deferring persistence within one batch, or losing an in-flight batch to a
// crash, loses no durability guarantee this file didn't already accept.
export async function withBatchedPersist<T>(atlasDb: AtlasDb, fn: () => Promise<T> | T): Promise<T> {
  const realPersist = atlasDb.persist
  let dirty = false
  atlasDb.persist = () => {
    dirty = true
  }
  try {
    return await fn()
  } finally {
    atlasDb.persist = realPersist
    if (dirty) realPersist()
  }
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

export function listAgentRunIndex(
  atlasDb: AtlasDb
): { runId: string; agentRole: string; status: string; startedAt: string; endedAt?: string }[] {
  const stmt = atlasDb.db.prepare(
    `SELECT run_id as runId, agent_role as agentRole, status, started_at as startedAt, ended_at as endedAt
     FROM agent_runs ORDER BY started_at DESC`
  )
  const rows: { runId: string; agentRole: string; status: string; startedAt: string; endedAt?: string }[] = []
  try {
    while (stmt.step()) {
      const row = stmt.getAsObject() as unknown as {
        runId: string
        agentRole: string
        status: string
        startedAt: string
        endedAt: string | null
      }
      rows.push({ ...row, endedAt: row.endedAt ?? undefined })
    }
    return rows
  } finally {
    stmt.free()
  }
}

// Vectors produced by main/retrieval/vectorize.ts (or, since Phase 7, a real
// embedding adapter — main/retrieval/embeddings/) — stored as raw Float32
// bytes in a BLOB column. sql.js hands blob params back as Uint8Array (see
// its ParamsObject / SqlValue types), so the round trip is
// Float32Array -> Buffer (write) -> Uint8Array -> Float32Array (read).
//
// `model` optionally tags which embedding space a row belongs to (e.g.
// 'hashing-256', 'lm-studio:nomic-embed-text'). Omitted for pre-Phase-7
// callers, in which case it's stored as NULL.
export function upsertVectorIndex(
  atlasDb: AtlasDb,
  id: string,
  kind: string,
  vector: Float32Array,
  model?: string
): void {
  atlasDb.db.run(
    `INSERT INTO vectors (id, kind, vector, model) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, vector=excluded.vector, model=excluded.model`,
    [id, kind, Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength), model ?? null]
  )
  atlasDb.persist()
}

export function searchVectorIndex(
  atlasDb: AtlasDb,
  queryVector: Float32Array,
  opts?: { kind?: string; model?: string; limit?: number }
): { id: string; kind: string; score: number }[] {
  const conditions: string[] = []
  const params: string[] = []
  if (opts?.kind) {
    conditions.push('kind = ?')
    params.push(opts.kind)
  }
  // Comparing vectors across embedding spaces (different dimensionality or
  // semantics) produces meaningless cosine scores, so a caller that knows
  // its active embedding model should scope the search to it. Rows with no
  // `model` tag (pre-Phase-7 hashing-trick vectors) are matched only when
  // the caller doesn't ask for a specific model, preserving old behavior.
  if (opts?.model) {
    conditions.push('model = ?')
    params.push(opts.model)
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''
  const stmt = atlasDb.db.prepare(`SELECT id, kind, vector FROM vectors${where}`)
  const rows: { id: string; kind: string; score: number }[] = []
  try {
    stmt.bind(params)
    while (stmt.step()) {
      const row = stmt.getAsObject() as unknown as { id: string; kind: string; vector: Uint8Array }
      const bytes = row.vector
      const vector = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      rows.push({ id: row.id, kind: row.kind, score: cosineSimilarity(queryVector, vector) })
    }
  } finally {
    stmt.free()
  }
  rows.sort((a, b) => b.score - a.score)
  return rows.slice(0, opts?.limit ?? 10)
}
