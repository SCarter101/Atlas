import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SceneMeta } from '@shared/schema/manuscript'
import type { SceneSnapshot, SnapshotDiffRun } from '@shared/schema/revision'
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

// Small self-contained word-level diff (no jsdiff/diff dependency exists in
// this project). Classic O(n*m) LCS table, which is fine at scene-length
// inputs (a few thousand words) per the design brief — not built to scale
// past that.
export function diffSnapshots(a: string, b: string): SnapshotDiffRun[] {
  const wordsA = a.split(/\s+/).filter(Boolean)
  const wordsB = b.split(/\s+/).filter(Boolean)
  const n = wordsA.length
  const m = wordsB.length

  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = wordsA[i] === wordsB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const runs: SnapshotDiffRun[] = []
  function push(type: SnapshotDiffRun['type'], word: string): void {
    const last = runs[runs.length - 1]
    if (last && last.type === type) {
      last.text += ` ${word}`
    } else {
      runs.push({ type, text: word })
    }
  }

  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (wordsA[i] === wordsB[j]) {
      push('equal', wordsA[i])
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push('remove', wordsA[i])
      i++
    } else {
      push('add', wordsB[j])
      j++
    }
  }
  while (i < n) {
    push('remove', wordsA[i])
    i++
  }
  while (j < m) {
    push('add', wordsB[j])
    j++
  }

  return runs
}
