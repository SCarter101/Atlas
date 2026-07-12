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

export interface PlotThreadSceneLinks {
  setupSceneIds: string[]
  payoffSceneIds: string[]
}

// Plot threads intentionally don't carry a `linkedSceneIds` field of their
// own — per spec, they reuse the existing SceneContinuityMeta.setupIds/
// payoffIds arrays (scene -> Codex entry id) rather than duplicating the
// relationship in both places. This inverts that mapping once per render:
// Codex plot-thread entry id -> the scenes that reference it as a setup or
// a payoff.
export function getPlotThreadSceneLinks(tree: ManuscriptTree): Map<string, PlotThreadSceneLinks> {
  const links = new Map<string, PlotThreadSceneLinks>()
  const ensure = (id: string): PlotThreadSceneLinks => {
    let entry = links.get(id)
    if (!entry) {
      entry = { setupSceneIds: [], payoffSceneIds: [] }
      links.set(id, entry)
    }
    return entry
  }

  for (const book of tree.books) {
    for (const part of book.parts) {
      for (const chapter of part.chapters) {
        for (const scene of chapter.scenes) {
          for (const threadId of scene.continuity?.setupIds ?? []) {
            ensure(threadId).setupSceneIds.push(scene.id)
          }
          for (const threadId of scene.continuity?.payoffIds ?? []) {
            ensure(threadId).payoffSceneIds.push(scene.id)
          }
        }
      }
    }
  }

  return links
}

export interface ConflictCurvePoint {
  sceneId: string
  sceneTitle: string
  ordinal: number
  conflictLevel: number
}

// Only scenes with an explicitly-set conflictLevel are included. Unset means
// "not yet assessed," not "zero conflict" — defaulting it to 0 would plot a
// false trough for scenes the writer simply hasn't tagged yet, so those are
// skipped/gapped rather than defaulted.
export function getConflictCurve(tree: ManuscriptTree): ConflictCurvePoint[] {
  const order = getManuscriptReadingOrder(tree)
  const points: ConflictCurvePoint[] = []

  for (const book of tree.books) {
    for (const part of book.parts) {
      for (const chapter of part.chapters) {
        for (const scene of chapter.scenes) {
          const level = scene.craft?.conflictLevel
          if (level === undefined) continue
          points.push({
            sceneId: scene.id,
            sceneTitle: scene.title,
            ordinal: order.get(scene.id) ?? 0,
            conflictLevel: level
          })
        }
      }
    }
  }

  return points.sort((a, b) => a.ordinal - b.ordinal)
}

export interface CharacterPresenceRow {
  characterId: string
  characterName: string
  // chapterId -> present in any scene of that chapter, counting both
  // presentCharacterIds and povCharacterId (POV always counts as present).
  presentByChapter: Map<string, boolean>
}

export function getCharacterPresenceMap(
  tree: ManuscriptTree,
  characters: { id: string; name: string }[]
): CharacterPresenceRow[] {
  const chapters = tree.books.flatMap((book) => book.parts.flatMap((part) => part.chapters))

  return characters.map((character) => {
    const presentByChapter = new Map<string, boolean>()
    for (const chapter of chapters) {
      const present = chapter.scenes.some(
        (scene) => scene.povCharacterId === character.id || (scene.presentCharacterIds ?? []).includes(character.id)
      )
      presentByChapter.set(chapter.id, present)
    }
    return { characterId: character.id, characterName: character.name, presentByChapter }
  })
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
