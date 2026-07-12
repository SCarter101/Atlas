export type CodexEntryType =
  | 'character'
  | 'location'
  | 'faction'
  | 'object'
  | 'event'
  | 'world-rule'
  | 'timeline-item'
  | 'plot-thread'
  | 'relationship'
  | 'theme'
  | 'motif'
  | 'research-note'
  | 'historical-reference'
  | 'scene-note'
  | 'private-author-note'

export type FactStatus = 'canon' | 'tentative' | 'deprecated' | 'contradicted'

export interface CodexRelationship {
  id: string
  targetEntryId: string
  kind: string
  notes?: string
}

export interface ManuscriptLink {
  sceneId: string
  excerpt?: string
}

export interface CodexVersion {
  versionId: string
  changedAt: string
  changedBy: 'author' | string
  diffSummary: string
  snapshot: Record<string, unknown>
}

export interface CodexEntry {
  schemaVersion: 1
  id: string
  type: CodexEntryType
  name: string
  status: FactStatus
  body: Record<string, unknown>
  isPrivate: boolean
  localModelOnly: boolean
  locked: boolean
  source: 'author' | 'ai-proposed' | 'ai-extracted'
  approvedAt?: string
  relationships: CodexRelationship[]
  manuscriptLinks: ManuscriptLink[]
  spoilerRevealSceneId?: string
  createdAt: string
  updatedAt: string
  history: CodexVersion[]
}
