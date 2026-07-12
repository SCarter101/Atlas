import { app } from 'electron'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectManifest } from '@shared/schema/project'
import { migrateRecord } from './migrations'
import { projectPaths } from './paths'

// Central place for where the bundled "Cottonmouth" demo project lives on
// disk — seedSampleProject.ts creates it here on first run, and listProjects()
// callers use this to exclude it from the generic project list since it
// already has its own dedicated tile on Landing.
export function sampleProjectRoot(): string {
  return join(app.getPath('documents'), 'Atlas Projects', 'Cottonmouth Sample.atlas')
}

export async function openProject(projectRoot: string): Promise<ProjectManifest> {
  const raw = await readFile(projectPaths(projectRoot).manifest, 'utf-8')
  return migrateRecord('ProjectManifest', JSON.parse(raw) as ProjectManifest)
}

// Lists every project folder under the "Atlas Projects" directory (each a
// *.atlas folder), reading its manifest so Landing can show a "reopen this
// project" tile for anything previously created via Story Foundations (or
// otherwise) that isn't the bundled sample project. Folders that fail to
// read (e.g. a project.json that doesn't exist yet, mid-creation) are
// skipped rather than throwing, so one bad folder doesn't blank the list.
export async function listProjects(): Promise<{ projectRoot: string; manifest: ProjectManifest }[]> {
  const rootDir = join(app.getPath('documents'), 'Atlas Projects')
  let entries: string[]
  try {
    const dirents = await readdir(rootDir, { withFileTypes: true })
    entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }

  const results: { projectRoot: string; manifest: ProjectManifest }[] = []
  for (const name of entries) {
    const projectRoot = join(rootDir, name)
    try {
      const manifest = await openProject(projectRoot)
      results.push({ projectRoot, manifest })
    } catch {
      // Not yet a fully created project (or unreadable) — skip it.
    }
  }

  return results.sort((a, b) => b.manifest.updatedAt.localeCompare(a.manifest.updatedAt))
}

export async function deleteProject(projectRoot: string): Promise<void> {
  await rm(projectRoot, { recursive: true, force: true })
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
