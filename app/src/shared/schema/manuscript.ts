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
