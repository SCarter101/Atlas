import { app } from 'electron'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectManifest } from '@shared/schema/project'
import { AtlasError } from '@shared/errors'
import { migrateRecord } from './migrations'
import { projectPaths } from './paths'

// The single source of truth for where every Atlas project lives on disk —
// previously this "Documents/Atlas Projects" path was independently inlined
// in three places (sampleProjectRoot() and listProjects() here, plus
// handlers.ts's ProjectCreateFromFoundations handler), which is both a
// duplication smell and, per handlers.ts's new path-containment guard, the
// root a candidate project path is checked against before any destructive
// operation (e.g. ProjectDelete's recursive rm) is allowed to proceed.
export function projectsRootDir(): string {
  return join(app.getPath('documents'), 'Atlas Projects')
}

// Central place for where the bundled "Cottonmouth" demo project lives on
// disk — seedSampleProject.ts creates it here on first run, and listProjects()
// callers use this to exclude it from the generic project list since it
// already has its own dedicated tile on Landing.
export function sampleProjectRoot(): string {
  return join(projectsRootDir(), 'Cottonmouth Sample.atlas')
}

export async function openProject(projectRoot: string): Promise<ProjectManifest> {
  // A missing/corrupt project.json throws a raw ENOENT or SyntaxError whose
  // message ("Unexpected token … in JSON") means nothing to a writer. Normalize
  // it into a tagged, explainable AtlasError. Note listProjects() below relies
  // on this throwing so it can skip half-created folders — the behaviour is
  // preserved, only the error shape changes.
  try {
    const raw = await readFile(projectPaths(projectRoot).manifest, 'utf-8')
    return migrateRecord('ProjectManifest', JSON.parse(raw) as ProjectManifest)
  } catch (err) {
    console.error('[projectStore] openProject failed to read manifest', projectRoot, err)
    throw new AtlasError(
      "This project's manifest could not be read (it may be missing or corrupted).",
      'MANIFEST_UNREADABLE'
    )
  }
}

// Lists every project folder under the "Atlas Projects" directory (each a
// *.atlas folder), reading its manifest so Landing can show a "reopen this
// project" tile for anything previously created via Story Foundations (or
// otherwise) that isn't the bundled sample project. Folders that fail to
// read (e.g. a project.json that doesn't exist yet, mid-creation) are
// skipped rather than throwing, so one bad folder doesn't blank the list.
export async function listProjects(): Promise<{ projectRoot: string; manifest: ProjectManifest }[]> {
  const rootDir = projectsRootDir()
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
  // maxRetries/retryDelay are fs.rm's own documented mechanism for exactly
  // this class of error: on Windows, a sync client for a cloud-backed
  // folder (OneDrive, in particular — Documents is commonly redirected
  // there) can hold a brief, transient lock on a just-written file while it
  // syncs, which surfaces here as EPERM/EBUSY/ENOTEMPTY on the recursive
  // rm. Nothing in this app itself holds an open handle into a project
  // folder at delete time (agent-run/scene writes are one-shot writeFile
  // calls, not streams or watchers) — retrying with backoff is the correct
  // fix for a lock that clears itself, not a bug to work around elsewhere.
  await rm(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
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
      paths.sessionsDir,
      paths.capabilitiesDir,
      paths.agentRunsDir,
      paths.exportsDir,
      paths.backupsDir,
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

// Small, generic manifest patcher for callers (e.g. the sessions:set-goal
// IPC handler) that need to persist one or two fields without re-deriving
// the whole creation flow above.
export async function updateProjectManifest(
  projectRoot: string,
  patch: Partial<ProjectManifest>
): Promise<ProjectManifest> {
  const current = await openProject(projectRoot)
  const next: ProjectManifest = { ...current, ...patch, updatedAt: new Date().toISOString() }
  await writeFile(projectPaths(projectRoot).manifest, JSON.stringify(next, null, 2), 'utf-8')
  return next
}
