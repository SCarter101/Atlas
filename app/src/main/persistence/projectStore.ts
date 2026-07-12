import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { ProjectManifest } from '@shared/schema/project'
import { migrateRecord } from './migrations'
import { projectPaths } from './paths'

export async function openProject(projectRoot: string): Promise<ProjectManifest> {
  const raw = await readFile(projectPaths(projectRoot).manifest, 'utf-8')
  return migrateRecord('ProjectManifest', JSON.parse(raw) as ProjectManifest)
}

export async function createProject(
  projectRoot: string,
  seed: Partial<ProjectManifest>
): Promise<ProjectManifest> {
  const paths = projectPaths(projectRoot)
  await Promise.all(
    [
      paths.manuscriptDir,
      paths.codexDir,
      paths.summariesDir,
      paths.revisionsDir,
      paths.capabilitiesDir,
      paths.agentRunsDir,
      paths.exportsDir,
      paths.settingsDir
    ].map((dir) => mkdir(dir, { recursive: true }))
  )

  const now = new Date().toISOString()
  // Spread seed first so any optional ProjectManifest field passed in comes
  // through automatically — only fields that need a computed default or
  // can't be caller-supplied are listed explicitly below.
  const manifest: ProjectManifest = {
    ...seed,
    schemaVersion: 1,
    id: seed.id ?? crypto.randomUUID(),
    title: seed.title ?? 'Untitled Project',
    createdAt: now,
    updatedAt: now,
    books: seed.books ?? [],
    advancedMode: seed.advancedMode ?? false,
    theme: seed.theme ?? 'paper'
  }

  await writeFile(paths.manifest, JSON.stringify(manifest, null, 2), 'utf-8')
  return manifest
}
