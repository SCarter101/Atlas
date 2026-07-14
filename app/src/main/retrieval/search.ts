import type { RetrievalResult } from '@shared/schema/retrieval'
import type { EmbeddingProvider } from '@shared/schema/embeddings'
import type { AtlasDb } from '../persistence/db'
import { searchVectorIndex, upsertVectorIndex } from '../persistence/db'
import { listCodexEntries } from '../persistence/codexStore'
import { readManuscriptTree } from '../persistence/manuscriptStore'
import { readScene } from '../persistence/sceneStore'
import { selectEmbeddingAdapter } from './embeddings/select'
import { vectorize } from './vectorize'

// indexText/search optionally accept a `model` (an EmbeddingProvider
// preference, e.g. the writer's Settings choice) that routes through a real
// main/retrieval/embeddings/ adapter instead of the bare hashing-trick
// vectorize() below, and tags the written/queried vector with that
// adapter's resolved id (see persistence/db.ts's `vectors.model` column).
// `model` is the writer's *preference*; selectEmbeddingAdapter() can still
// resolve to a different adapter (e.g. falling back to hashing when LM
// Studio isn't reachable), so the resolved id — returned here rather than
// assumed to match `model` — is what callers must use for any tracking
// keyed on "which embedding space is this vector actually in."
//
// These are overloaded rather than unconditionally async so every
// pre-Phase-7 caller — this file's own ensureIndexed() fallback path below,
// and every existing search.test.ts call site — keeps its exact synchronous
// signature and behavior unmodified. Only a call site that explicitly
// passes a `model` takes the async, real-embedding path.
export function indexText(db: AtlasDb, id: string, kind: 'codex-entry' | 'scene', text: string): void
export function indexText(
  db: AtlasDb,
  id: string,
  kind: 'codex-entry' | 'scene',
  text: string,
  model: EmbeddingProvider
): Promise<string>
export function indexText(
  db: AtlasDb,
  id: string,
  kind: 'codex-entry' | 'scene',
  text: string,
  model?: EmbeddingProvider
): void | Promise<string> {
  if (!model) {
    upsertVectorIndex(db, id, kind, vectorize(text))
    return
  }
  return (async () => {
    const adapter = await selectEmbeddingAdapter(model)
    const vector = await adapter.embed(text)
    upsertVectorIndex(db, id, kind, vector, adapter.id)
    return adapter.id
  })()
}

// The tracking key indexedKeysByDb/ensureIndexed/markIndexed use — includes
// the resolved embedding identity (not just kind+id) so a provider change
// mid-session (e.g. LM Studio was down, then the writer starts its local
// server) causes a re-embed instead of being silently skipped as
// "already indexed" under the stale space. The plain sync/no-model path
// (always hashing) gets its own fixed suffix, distinct from any named
// provider, so switching *from* hashing *to* a real provider also re-embeds.
export function indexedKey(kind: 'codex-entry' | 'scene', id: string, model: string): string {
  return `${kind}:${id}:${model}`
}

export function search(db: AtlasDb, query: string, opts?: { kind?: string; limit?: number }): RetrievalResult[]
export function search(
  db: AtlasDb,
  query: string,
  opts: { kind?: string; limit?: number; model: EmbeddingProvider }
): Promise<RetrievalResult[]>
export function search(
  db: AtlasDb,
  query: string,
  opts?: { kind?: string; limit?: number; model?: EmbeddingProvider }
): RetrievalResult[] | Promise<RetrievalResult[]> {
  if (!opts?.model) {
    return searchVectorIndex(db, vectorize(query), opts)
  }
  const { model, kind, limit } = opts
  return (async () => {
    const adapter = await selectEmbeddingAdapter(model)
    const vector = await adapter.embed(query)
    return searchVectorIndex(db, vector, { kind, limit, model: adapter.id })
  })()
}

// This module doesn't own codexStore.ts/sceneStore.ts (owned elsewhere), so
// rather than hook indexText() into their write paths, the index is
// populated lazily on read: the first retrieval:search call for a given
// project's AtlasDb walks the Codex and manuscript once and indexes
// anything not already indexed. Tracking is a WeakMap keyed by the AtlasDb
// instance (rather than one flat Set) so switching projects — a fresh
// AtlasDb per ProjectSession — can't skip indexing into a db that doesn't
// actually have those vectors yet.
//
// Phase 7: main/ipc/handlers.ts's SceneWrite handler now hooks indexText()
// directly on every scene save (closing the "won't reindex until the
// session restarts" gap this comment used to describe), and calls
// markIndexed() below to record it — so a mid-session edit is picked up
// immediately instead of waiting for ensureIndexed()'s next lazy pass, and
// that pass doesn't waste a second (possibly billed) real embedding call
// re-indexing the same scene.
const indexedKeysByDb = new WeakMap<AtlasDb, Set<string>>()

function keysFor(db: AtlasDb): Set<string> {
  let indexedKeys = indexedKeysByDb.get(db)
  if (!indexedKeys) {
    indexedKeys = new Set<string>()
    indexedKeysByDb.set(db, indexedKeys)
  }
  return indexedKeys
}

// Lets code outside this module record that it already indexed something
// through a real embedding adapter (see main/ipc/handlers.ts's SceneWrite
// handler), so ensureIndexed()'s lazy pass doesn't redundantly re-embed it.
export function markIndexed(db: AtlasDb, key: string): void {
  keysFor(db).add(key)
}

export async function ensureIndexed(db: AtlasDb, projectRoot: string, model?: EmbeddingProvider): Promise<void> {
  const indexedKeys = keysFor(db)
  // Resolved once per call, not per item — selectEmbeddingAdapter() can
  // probe a real endpoint (isAvailable()), and the resolved adapter is the
  // same for every item within a single ensureIndexed() invocation since
  // it only depends on `model`, not on any per-item data.
  const resolvedModelId = model ? (await selectEmbeddingAdapter(model)).id : 'sync'

  const codexEntries = await listCodexEntries(projectRoot)
  for (const entry of codexEntries) {
    const key = indexedKey('codex-entry', entry.id, resolvedModelId)
    if (indexedKeys.has(key)) continue
    const text = `${entry.name}\n${JSON.stringify(entry.body)}`
    if (model) {
      await indexText(db, entry.id, 'codex-entry', text, model)
    } else {
      indexText(db, entry.id, 'codex-entry', text)
    }
    indexedKeys.add(key)
  }

  const tree = await readManuscriptTree(projectRoot)
  const scenes = tree.books.flatMap((b) => b.parts.flatMap((p) => p.chapters.flatMap((c) => c.scenes)))
  for (const scene of scenes) {
    const key = indexedKey('scene', scene.id, resolvedModelId)
    if (indexedKeys.has(key)) continue
    const { prose } = await readScene(projectRoot, db, scene.id)
    const text = `${scene.title}\n${prose}`
    if (model) {
      await indexText(db, scene.id, 'scene', text, model)
    } else {
      indexText(db, scene.id, 'scene', text)
    }
    indexedKeys.add(key)
  }
}
