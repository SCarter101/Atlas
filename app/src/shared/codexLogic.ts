// Pure Codex heuristics shared between the main-process store
// (main/persistence/codexStore.ts, which re-exports these) and the renderer
// (routes/CodexView.tsx, components/CodexEntryForm.tsx). Kept dependency-free
// (no node:fs/node:crypto) so the renderer — which runs with
// contextIsolation/nodeIntegration disabled — can import it directly without
// pulling in main-process-only modules.
import type { CodexEntry } from './schema/codex'
import type { ManuscriptTree } from './schema/manuscript'

function isNonEmpty(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

// Pure heuristic pass, no mutation — the UI decides whether/how to surface a
// contradiction badge from the returned reasons.
export function detectContradictions(entries: CodexEntry[]): Map<string, string[]> {
  const reasons = new Map<string, string[]>()
  const addReason = (id: string, reason: string): void => {
    const existing = reasons.get(id)
    if (existing) existing.push(reason)
    else reasons.set(id, [reason])
  }

  const byId = new Map(entries.map((e) => [e.id, e]))
  for (const entry of entries) {
    for (const rel of entry.relationships) {
      if (rel.kind !== 'contradicts') continue
      const target = byId.get(rel.targetEntryId)
      if (!target) continue
      addReason(entry.id, `Marked as contradicting "${target.name}"`)
      addReason(target.id, `Marked as contradicted by "${entry.name}"`)
    }
  }

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i]
      const b = entries[j]
      if (a.type !== b.type) continue
      if (a.name.trim().toLowerCase() !== b.name.trim().toLowerCase()) continue

      const bodyKeys = new Set([...Object.keys(a.body), ...Object.keys(b.body)])
      for (const key of bodyKeys) {
        const av = a.body[key]
        const bv = b.body[key]
        if (!isNonEmpty(av) || !isNonEmpty(bv)) continue
        if (JSON.stringify(av) === JSON.stringify(bv)) continue
        addReason(a.id, `Conflicts with "${b.name}" on "${key}"`)
        addReason(b.id, `Conflicts with "${a.name}" on "${key}"`)
      }
    }
  }

  return reasons
}

export function getManuscriptReadingOrder(tree: ManuscriptTree): Map<string, number> {
  const order = new Map<string, number>()
  let ordinal = 0
  for (const book of tree.books) {
    for (const part of book.parts) {
      for (const chapter of part.chapters) {
        for (const scene of chapter.scenes) {
          order.set(scene.id, ordinal++)
        }
      }
    }
  }
  return order
}

export function filterBySpoilerReveal(
  entries: CodexEntry[],
  asOfSceneId: string | undefined,
  readingOrder: Map<string, number>
): CodexEntry[] {
  if (!asOfSceneId) return entries
  const asOfOrdinal = readingOrder.get(asOfSceneId)
  if (asOfOrdinal === undefined) return entries

  return entries.filter((entry) => {
    if (!entry.spoilerRevealSceneId) return true
    const revealOrdinal = readingOrder.get(entry.spoilerRevealSceneId)
    if (revealOrdinal === undefined) return true
    return revealOrdinal <= asOfOrdinal
  })
}
