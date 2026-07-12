import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CodexEntry, CodexEntryType, FactStatus } from '@shared/schema/codex'
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

export async function upsertCodexEntry(
  projectRoot: string,
  db: AtlasDb,
  entry: CodexEntry
): Promise<void> {
  const dirName = CODEX_TYPE_DIRS[entry.type]
  const dirPath = join(projectPaths(projectRoot).codexDir, dirName)
  await mkdir(dirPath, { recursive: true })

  const filePath = join(dirPath, `${entry.id}.json`)
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
