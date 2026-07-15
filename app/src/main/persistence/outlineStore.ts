import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { OutlineFramework } from '@shared/schema/outline'
import { migrateRecord } from './migrations'

// A project has at most one active OutlineFramework (spec §11), so — unlike
// agentRunStore.ts's one-file-per-record layout — this is a single JSON file
// rather than a directory of records. Path constructed inline (not added to
// paths.ts's projectPaths()) to keep this track's file-ownership disjoint
// from the other parallel tracks touching persistence this round.
function frameworkFilePath(projectRoot: string): string {
  return join(projectRoot, 'outline', 'framework.json')
}

export async function loadOutlineFramework(projectRoot: string): Promise<OutlineFramework | null> {
  try {
    const raw = await readFile(frameworkFilePath(projectRoot), 'utf-8')
    return migrateRecord('OutlineFramework', JSON.parse(raw) as OutlineFramework)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function saveOutlineFramework(projectRoot: string, framework: OutlineFramework): Promise<void> {
  await mkdir(join(projectRoot, 'outline'), { recursive: true })
  await writeFile(frameworkFilePath(projectRoot), JSON.stringify(framework, null, 2), 'utf-8')
}
