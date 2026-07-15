export interface Book {
  id: string
  projectId: string
  title: string
  order: number
}

export interface Part {
  id: string
  bookId: string
  title: string
  order: number
}

export interface Chapter {
  id: string
  partId: string
  title: string
  order: number
  summary?: string
  sceneIds: string[]
}

export type SceneStatus = 'outline' | 'drafting' | 'drafted' | 'revised' | 'final'

export interface SceneCraftMeta {
  characterDesire?: string
  externalGoal?: string
  internalConflict?: string
  opposition?: string
  stakes?: string
  turningPoint?: string
  outcome?: string
  emotionalShift?: string
  revealedInformation?: string
  // 1 (calm) – 5 (max tension); unset means "not yet assessed" and must be
  // treated differently from 0 by any consumer (e.g. the conflict/tension
  // curve skips scenes without a value rather than plotting them at zero).
  conflictLevel?: number
}

export interface SceneContinuityMeta {
  timelinePlacement?: string
  continuityNotes?: string
  setupIds?: string[]
  payoffIds?: string[]
  foreshadowingNotes?: string
  themeIds?: string[]
  motifIds?: string[]
  relatedCodexIds?: string[]
  // Phase 9 continuity validators (see shared/continuityChecks.ts). All three
  // purely additive/optional, no migration needed — same treatment as the
  // rest of this object's fields. storyDate is the in-world calendar date
  // ('YYYY-MM-DD') this scene takes place on; season is a fixed-Northern-
  // Hemisphere label cross-checked against storyDate's month by
  // checkSeasonConsistency; isFlashback suppresses timeline-monotonicity
  // flagging for a scene that's intentionally out of story-chronological
  // order relative to its manuscript position.
  storyDate?: string
  season?: 'spring' | 'summer' | 'autumn' | 'winter'
  isFlashback?: boolean
}

export interface SceneMeta {
  // v2 (Round 10/Phase 9): `localModelOnly` was added after v1 SceneMeta
  // records already existed on disk (Round 6/Phase 5's privacy flag), so
  // pre-existing scenes read back with the key entirely absent rather than
  // an explicit `false`. See main/persistence/migrations.ts's registered
  // 'SceneMeta' v1->v2 migration, which normalizes every scene read through
  // migrateRecord() to carry an explicit value on this field.
  schemaVersion: 2
  id: string
  chapterId: string
  order: number

  // Tier 1 — always visible
  title: string
  povCharacterId?: string
  locationId?: string
  timeOrDate?: string
  purpose?: string
  // Fuller character-presence list beyond just POV — feeds the character
  // presence map. povCharacterId also counts as "present" for that map even
  // if a scene's author never duplicates it in here.
  presentCharacterIds?: string[]
  localModelOnly?: boolean

  // Tier 2 — Story Craft, expanded on demand
  craft?: SceneCraftMeta

  // Tier 3 — Continuity and Threads, expanded on demand
  continuity?: SceneContinuityMeta

  wordCount: number
  status: SceneStatus
  updatedAt: string
}

export interface ManuscriptTree {
  books: (Book & { parts: (Part & { chapters: (Chapter & { scenes: SceneMeta[] })[] })[] })[]
}
