import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CodexEntry, CodexEntryType, CodexVersion, FactStatus } from '@shared/schema/codex'
import type { AtlasDb } from './db'
import { deleteCodexIndex, upsertCodexIndex } from './db'
import { migrateRecord } from './migrations'
import { CODEX_TYPE_DIRS, projectPaths } from './paths'

// detectContradictions/getManuscriptReadingOrder/filterBySpoilerReveal are
// pure (no fs/crypto), so their canonical implementation lives in
// shared/codexLogic.ts and is re-exported here — the renderer needs them too
// (contradiction badges, spoiler gating) but can't import this module
// directly since it pulls in node:fs/node:crypto and the renderer runs with
// contextIsolation/nodeIntegration disabled.
export { detectContradictions, getManuscriptReadingOrder, filterBySpoilerReveal } from '@shared/codexLogic'

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
