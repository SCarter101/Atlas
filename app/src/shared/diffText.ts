import type { SnapshotDiffRun } from './schema/revision'

// Small self-contained word-level diff (no jsdiff/diff dependency exists in
// this project). Classic O(n*m) LCS table, which is fine at scene-length
// inputs (a few thousand words) per the design brief — not built to scale
// past that.
//
// Originally lived only in main/persistence/revisionStore.ts (used for
// scene-snapshot A/B comparison, IPC-backed since snapshots are read from
// disk). Extracted here — a dependency-free shared module, same pattern as
// shared/codexLogic.ts — because DraftComparisonView.tsx needs to diff two
// in-memory Generator draft strings directly in the renderer without a
// round trip through main (the drafts are already in the renderer's state
// as suggestion payloads, unlike snapshots). revisionStore.ts re-exports
// diffWords as diffSnapshots so its existing callers/tests are unaffected.
export function diffWords(a: string, b: string): SnapshotDiffRun[] {
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
