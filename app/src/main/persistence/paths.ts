import { join } from 'node:path'

// Central place for the project-folder layout described in
// "Atlas Architecture and Data Contracts.md" §2. Every other persistence
// module derives paths from here so the on-disk layout only lives in one place.
export function projectPaths(projectRoot: string) {
  return {
    root: projectRoot,
    manifest: join(projectRoot, 'project.json'),
    indexDb: join(projectRoot, 'index.sqlite'),
    manuscriptDir: join(projectRoot, 'manuscript'),
    codexDir: join(projectRoot, 'codex'),
    summariesDir: join(projectRoot, 'summaries'),
    revisionsDir: join(projectRoot, 'revisions'),
    capabilitiesDir: join(projectRoot, 'capabilities'),
    agentRunsDir: join(projectRoot, 'agent-runs'),
    exportsDir: join(projectRoot, 'exports'),
    settingsDir: join(projectRoot, 'settings')
  }
}

export function codexTypeDir(projectRoot: string, typeDirName: string): string {
  return join(projectPaths(projectRoot).codexDir, typeDirName)
}

export const CODEX_TYPE_DIRS: Record<string, string> = {
  character: 'characters',
  location: 'locations',
  faction: 'factions',
  object: 'objects',
  event: 'events',
  'world-rule': 'world-rules',
  'timeline-item': 'timeline',
  relationship: 'relationships',
  theme: 'themes',
  motif: 'motifs',
  'research-note': 'research',
  'historical-reference': 'research',
  'scene-note': 'scene-notes',
  'private-author-note': 'private-notes'
}

// Scenes are identified by a stable id, but live on disk as
// manuscript/book-XX/part-XX/chapter-XXX/scene-XXX.{md,meta.json}. We keep an
// id -> relative-path map in the SQLite index so lookups by id don't require
// walking the tree; see persistence/db.ts.
export function sceneFilePaths(projectRoot: string, relativeDir: string, sceneSlug: string) {
  const dir = join(projectRoot, 'manuscript', relativeDir)
  return {
    dir,
    proseFile: join(dir, `${sceneSlug}.md`),
    metaFile: join(dir, `${sceneSlug}.meta.json`)
  }
}
