import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { SceneMeta } from '@shared/schema/manuscript'
import type { AtlasDb } from './db'
import { findSceneLocation, upsertSceneIndex } from './db'
import { migrateRecord } from './migrations'
import { sceneFilePaths } from './paths'

export interface SceneReadResult {
  meta: SceneMeta
  prose: string
}

export function countWords(prose: string): number {
  const trimmed = prose.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

export async function readScene(
  projectRoot: string,
  db: AtlasDb,
  sceneId: string
): Promise<SceneReadResult> {
  const location = findSceneLocation(db, sceneId)
  if (!location) {
    throw new Error(`Scene ${sceneId} is not in the project index`)
  }
  const { proseFile, metaFile } = sceneFilePaths(projectRoot, location.relativeDir, location.slug)
  const [metaRaw, prose] = await Promise.all([
    readFile(metaFile, 'utf-8'),
    readFile(proseFile, 'utf-8').catch(() => '')
  ])
  return { meta: migrateRecord('SceneMeta', JSON.parse(metaRaw) as SceneMeta), prose }
}

export async function writeScene(
  projectRoot: string,
  db: AtlasDb,
  sceneId: string,
  patch: { meta?: Partial<SceneMeta>; prose?: string },
  relativeDir: string,
  slug: string
): Promise<void> {
  const { dir, proseFile, metaFile } = sceneFilePaths(projectRoot, relativeDir, slug)
  await mkdir(dir, { recursive: true })

  const existingMetaRaw = await readFile(metaFile, 'utf-8').catch(() => null)
  const existingMeta = existingMetaRaw ? (JSON.parse(existingMetaRaw) as SceneMeta) : null
  const prose = patch.prose ?? (await readFile(proseFile, 'utf-8').catch(() => ''))

  const nextMeta: SceneMeta = {
    schemaVersion: 1,
    id: sceneId,
    chapterId: existingMeta?.chapterId ?? '',
    order: existingMeta?.order ?? 0,
    title: existingMeta?.title ?? 'Untitled Scene',
    ...existingMeta,
    ...patch.meta,
    wordCount: countWords(prose),
    status: patch.meta?.status ?? existingMeta?.status ?? 'drafting',
    updatedAt: new Date().toISOString()
  }

  // Files are written before the index is touched — see data-contracts §4:
  // the index must never point at data that doesn't exist on disk yet.
  await writeFile(metaFile, JSON.stringify(nextMeta, null, 2), 'utf-8')
  if (patch.prose !== undefined) {
    await writeFile(proseFile, patch.prose, 'utf-8')
  }

  upsertSceneIndex(db, {
    id: sceneId,
    chapterId: nextMeta.chapterId,
    relativeDir,
    slug,
    title: nextMeta.title,
    povCharacterId: nextMeta.povCharacterId,
    status: nextMeta.status,
    wordCount: nextMeta.wordCount,
    orderInChapter: nextMeta.order,
    updatedAt: nextMeta.updatedAt
  })
}
