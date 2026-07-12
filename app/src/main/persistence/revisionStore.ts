import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SceneMeta } from '@shared/schema/manuscript'
import type { SceneSnapshot, SnapshotDiffRun } from '@shared/schema/revision'
import { diffWords } from '@shared/diffText'
import { projectPaths } from './paths'

function snapshotDir(projectRoot: string, sceneId: string): string {
  return join(projectPaths(projectRoot).revisionsDir, sceneId)
}

export async function createSnapshot(
  projectRoot: string,
  sceneId: string,
  prose: string,
  meta: SceneMeta,
  label?: string
): Promise<{ snapshotId: string }> {
  const dir = snapshotDir(projectRoot, sceneId)
  await mkdir(dir, { recursive: true })
  const snapshotId = crypto.randomUUID()
  const snapshot: SceneSnapshot = {
    schemaVersion: 1,
    snapshotId,
    sceneId,
    label,
    prose,
    meta,
    createdAt: new Date().toISOString()
  }
  await writeFile(join(dir, `${snapshotId}.json`), JSON.stringify(snapshot, null, 2), 'utf-8')
  return { snapshotId }
}

export async function listSnapshots(
  projectRoot: string,
  sceneId: string
): Promise<{ snapshotId: string; label?: string; createdAt: string }[]> {
  const dir = snapshotDir(projectRoot, sceneId)
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return []
  }

  const results: { snapshotId: string; label?: string; createdAt: string }[] = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const raw = await readFile(join(dir, file), 'utf-8')
    const snapshot = JSON.parse(raw) as SceneSnapshot
    results.push({ snapshotId: snapshot.snapshotId, label: snapshot.label, createdAt: snapshot.createdAt })
  }
  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function getSnapshot(projectRoot: string, sceneId: string, snapshotId: string): Promise<SceneSnapshot> {
  const raw = await readFile(join(snapshotDir(projectRoot, sceneId), `${snapshotId}.json`), 'utf-8')
  return JSON.parse(raw) as SceneSnapshot
}

// The word-level LCS diff itself now lives in shared/diffText.ts (renderer
// needs it too, for DraftComparisonView.tsx's in-memory draft-vs-draft
// comparison — see that module's comment for why). Kept as a re-export here
// under its original name so this file's existing snapshot-diff callers and
// tests are unaffected.
export function diffSnapshots(a: string, b: string): SnapshotDiffRun[] {
  return diffWords(a, b)
}
