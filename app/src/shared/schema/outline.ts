// Phase 8 deferral, built as its own round-11 track ("Outline frameworks",
// spec §11): a project may have one active OutlineFramework at a time,
// mapping a named story-structure template's beats (or an empty
// writer-authored 'custom' list) onto the manuscript's chapters/scenes. See
// main/persistence/outlineStore.ts for the on-disk <project>/outline/
// framework.json read/write, and shared/outlineLogic.ts for the pure
// beat-status/genre-expectation-finding logic that operates on this shape
// with no main-process dependency (so the renderer can call it directly).

export type OutlineFrameworkKind =
  | 'three-act'
  | 'save-the-cat'
  | 'heros-journey'
  | 'mystery-clue-grid'
  | 'thriller-escalation'
  | 'custom'

export interface OutlineBeat {
  id: string
  label: string
  description: string
  // Position within the framework — beats are expected to map onto
  // non-decreasing manuscript order as the story progresses; see
  // outlineLogic.ts's getBeatStatus for how a beat's targetChapterId is
  // checked against this.
  order: number
  // Framework-specific tag: mystery-clue-grid uses
  // 'clue'|'suspect'|'red-herring'|'reveal'; thriller-escalation uses
  // 'escalation-N' checkpoints. Absent for three-act/save-the-cat/
  // heros-journey/custom beats, which don't need a sub-classification beyond
  // their label. See outlineLogic.ts's TEMPLATE_BEATS for the exact values
  // each kind actually uses.
  role?: string
  targetChapterId?: string
  targetSceneId?: string
}

export interface OutlineFramework {
  schemaVersion: 1
  id: string
  kind: OutlineFrameworkKind
  name: string
  beats: OutlineBeat[]
}
