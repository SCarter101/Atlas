import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CodexEntry, CodexEntryType, CodexVersion, FactStatus } from '@shared/schema/codex'
import type { ManuscriptTree } from '@shared/schema/manuscript'
import type { AtlasDb } from './db'
import { deleteCodexIndex, upsertCodexIndex } from './db'
import { migrateRecord } from './migrations'
import { CODEX_TYPE_DIRS, projectPaths } from './paths'

export async function listCodexEntries(
  projectRoot: string,
  filter?: { type?: CodexEntryType; status?: FactStatus }
): Promise<CodexEntry[]> {
  const codexDir = projectPaths(projectRoot).codexDir
  const typeDirs = filter?.type ? [CODEX_TYPE_DIRS[filter.type]] : Object.values(CODEX_TYPE_DIRS)
  const uniqueDirs = [...new Set(typeDirs)]

  const entries: CodexEntry[] = []
  for (const dirName of uniqueDirs) {
    const dirPath = join(codexDir, dirName)
    const files = await readdir(dirPath).catch(() => [] as string[])
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const raw = await readFile(join(dirPath, file), 'utf-8')
      const entry = migrateRecord('CodexEntry', JSON.parse(raw) as CodexEntry)
      if (filter?.status && entry.status !== filter.status) continue
      entries.push(entry)
    }
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name))
}

// Describes what changed between two revisions of the same entry, for the
// CodexVersion.diffSummary shown in the History disclosure — not exhaustive,
// just enough for a writer to recognize "oh, that's the edit I made".
function buildDiffSummary(previous: CodexEntry, next: CodexEntry): string {
  const parts: string[] = []
  if (previous.name !== next.name) parts.push(`name: ${previous.name} → ${next.name}`)
  if (previous.status !== next.status) parts.push(`status: ${previous.status} → ${next.status}`)

  const bodyKeys = new Set([...Object.keys(previous.body), ...Object.keys(next.body)])
  const changedBodyKeys = [...bodyKeys].filter(
    (key) => JSON.stringify(previous.body[key]) !== JSON.stringify(next.body[key])
  )
  if (changedBodyKeys.length > 0) parts.push(`body.${changedBodyKeys.join(', ')} changed`)

  return parts.length > 0 ? parts.join('; ') : 'no changes detected'
}

export async function upsertCodexEntry(
  projectRoot: string,
  db: AtlasDb,
  entry: CodexEntry
): Promise<void> {
  const dirName = CODEX_TYPE_DIRS[entry.type]
  const dirPath = join(projectPaths(projectRoot).codexDir, dirName)
  await mkdir(dirPath, { recursive: true })

  const filePath = join(dirPath, `${entry.id}.json`)

  // History is appended here, server-side, rather than trusting whatever
  // history array the renderer sent — the IPC boundary validates shape via
  // CodexEntrySchema, not the append itself.
  const previousRaw = await readFile(filePath, 'utf-8').catch(() => null)
  if (previousRaw) {
    const previous = migrateRecord('CodexEntry', JSON.parse(previousRaw) as CodexEntry)
    const version: CodexVersion = {
      versionId: randomUUID(),
      changedAt: entry.updatedAt,
      changedBy: entry.source === 'author' ? 'author' : entry.source,
      diffSummary: buildDiffSummary(previous, entry),
      snapshot: { name: previous.name, status: previous.status, body: previous.body }
    }
    entry.history = [...entry.history, version]
  }

  // Files first, index second — same ordering guarantee as sceneStore.
  await writeFile(filePath, JSON.stringify(entry, null, 2), 'utf-8')

  upsertCodexIndex(db, {
    id: entry.id,
    type: entry.type,
    name: entry.name,
    status: entry.status,
    isPrivate: entry.isPrivate,
    approvedAt: entry.approvedAt,
    updatedAt: entry.updatedAt
  })
}

// Used to reject an ai-proposed/ai-extracted Codex entry — per spec §6,
// rejecting a proposal should remove it outright rather than leave a
// half-approved record behind.
export async function deleteCodexEntry(
  projectRoot: string,
  db: AtlasDb,
  entry: Pick<CodexEntry, 'id' | 'type'>
): Promise<void> {
  const dirName = CODEX_TYPE_DIRS[entry.type]
  const filePath = join(projectPaths(projectRoot).codexDir, dirName, `${entry.id}.json`)
  await rm(filePath, { force: true })
  deleteCodexIndex(db, entry.id)
}

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
