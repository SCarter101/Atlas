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
    sessionsDir: join(projectRoot, 'sessions'),
    capabilitiesDir: join(projectRoot, 'capabilities'),
    agentRunsDir: join(projectRoot, 'agent-runs'),
    exportsDir: join(projectRoot, 'exports'),
    backupsDir: join(projectRoot, 'backups'),
    settingsDir: join(projectRoot, 'settings')
  }
}

export function codexTypeDir(projectRoot: string, typeDirName: string): string {
  return join(projectPaths(projectRoot).codexDir, typeDirName)
}

// Phase 7: derived summaries (character-arc, timeline, world-state,
// open-promises, payoff-status — see shared/schema/retrieval.ts's
// DerivedSummary) live one folder per kind under summaries/derived, mirroring
// the summaries/scenes and summaries/chapters layout summaryStore.ts already
// uses. See main/persistence/derivedSummaryStore.ts.
export function derivedSummaryDir(projectRoot: string, kind: string): string {
  return join(projectPaths(projectRoot).summariesDir, 'derived', kind)
}

export const CODEX_TYPE_DIRS: Record<string, string> = {
  character: 'characters',
  location: 'locations',
  faction: 'factions',
  object: 'objects',
  event: 'events',
  'world-rule': 'world-rules',
  'timeline-item': 'timeline',
  // Pre-existing gap found while building Phase 7's open-promises/
  // payoff-status derived summaries (main/persistence/derivedSummaryStore.ts),
  // which filter listCodexEntries() by type: 'plot-thread' — a missing key
  // here means CODEX_TYPE_DIRS['plot-thread'] is undefined, and
  // codexStore.ts's listCodexEntries/upsertCodexEntry both pass that
  // straight into node:path's join(), which throws on a non-string
  // argument. This type has existed since Round 5/Phase 4 Wave 1F
  // (Timeline's Plot Threads tab, PlotThreadBoard.tsx), so plot-thread Codex
  // entries were unreadable/unwritable end-to-end before this fix.
  'plot-thread': 'plot-threads',
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
