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
}

export interface SceneMeta {
  schemaVersion: 1
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
