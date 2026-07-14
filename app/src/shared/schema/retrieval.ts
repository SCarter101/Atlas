import type { ModelRef } from './agent'

export interface SceneSummary {
  sceneId: string
  summary: string
  sourceUpdatedAt: string
  updatedAt: string
}

export interface ChapterSummary {
  chapterId: string
  summary: string
  sourceUpdatedAt: string
  updatedAt: string
}

export interface ContextWarning {
  what: string
  why: string
  suggestedFix: string
}

export interface RetrievalResult {
  id: string
  kind: string
  score: number
}

// spec §9's remaining rolling-summary types, beyond chapter/scene (which
// predate Phase 7 and keep their own SceneSummary/ChapterSummary shape).
// These are lower-frequency, coarser-grained summaries: character-arc is
// scoped to one Codex character entry; the other four are project-level
// singletons (one summary per project, not per scene/chapter/character).
export type DerivedSummaryKind = 'character-arc' | 'timeline' | 'world-state' | 'open-promises' | 'payoff-status'

export interface DerivedSummary {
  kind: DerivedSummaryKind
  // characterId for 'character-arc'; a fixed project-level singleton id
  // (e.g. 'project') for the other four kinds.
  subjectId: string
  summary: string
  // Content-fingerprint staleness key, same djb2-hash approach as
  // SceneSummary/ChapterSummary's sourceUpdatedAt (main/persistence/
  // summaryStore.ts) — these summaries are generated from a snapshot of
  // manuscript/Codex text, not from a single timestamped record.
  sourceFingerprint: string
  generatedBy: 'model' | 'heuristic'
  modelRef?: ModelRef
  generatedAt: string
}
