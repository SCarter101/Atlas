import type { RetrievalResult } from '@shared/schema/retrieval'
import type { AtlasDb } from '../persistence/db'
import { searchVectorIndex, upsertVectorIndex } from '../persistence/db'
import { listCodexEntries } from '../persistence/codexStore'
import { readManuscriptTree } from '../persistence/manuscriptStore'
import { readScene } from '../persistence/sceneStore'
import { vectorize } from './vectorize'

export function indexText(db: AtlasDb, id: string, kind: 'codex-entry' | 'scene', text: string): void {
  upsertVectorIndex(db, id, kind, vectorize(text))
}

export function search(db: AtlasDb, query: string, opts?: { kind?: string; limit?: number }): RetrievalResult[] {
  return searchVectorIndex(db, vectorize(query), opts)
}

// This module doesn't own codexStore.ts/sceneStore.ts (Wave 1A/owned
// elsewhere), so rather than hook indexText() into their write paths, the
// index is populated lazily on read: the first retrieval:search call for a
// given project's AtlasDb walks the Codex and manuscript once and indexes
// anything not already indexed. Tracking is a WeakMap keyed by the AtlasDb
// instance (rather than one flat Set) so switching projects — a fresh
// AtlasDb per ProjectSession — can't skip indexing into a db that doesn't
// actually have those vectors yet. Within a single project session, an
// entry that changes on disk after being indexed won't be reindexed until
// the session restarts — an acceptable gap for this simulated retrieval
// layer; a real integration would index on write instead.
const indexedKeysByDb = new WeakMap<AtlasDb, Set<string>>()

export async function ensureIndexed(db: AtlasDb, projectRoot: string): Promise<void> {
  let indexedKeys = indexedKeysByDb.get(db)
  if (!indexedKeys) {
    indexedKeys = new Set<string>()
    indexedKeysByDb.set(db, indexedKeys)
  }

  const codexEntries = await listCodexEntries(projectRoot)
  for (const entry of codexEntries) {
    const key = `codex-entry:${entry.id}`
    if (indexedKeys.has(key)) continue
    indexText(db, entry.id, 'codex-entry', `${entry.name}\n${JSON.stringify(entry.body)}`)
    indexedKeys.add(key)
  }

  const tree = await readManuscriptTree(projectRoot)
  const scenes = tree.books.flatMap((b) => b.parts.flatMap((p) => p.chapters.flatMap((c) => c.scenes)))
  for (const scene of scenes) {
    const key = `scene:${scene.id}`
    if (indexedKeys.has(key)) continue
    const { prose } = await readScene(projectRoot, db, scene.id)
    indexText(db, scene.id, 'scene', `${scene.title}\n${prose}`)
    indexedKeys.add(key)
  }
}
