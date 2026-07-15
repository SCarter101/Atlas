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

// Spec §7.4 "Dialogue Editor should use character voice profiles from the
// Codex" — only meaningful when CodexEntry.type === 'character'. All fields
// optional since most existing character entries (and new ones a writer
// hasn't gotten around to yet) won't have this filled in; the Dialoguer
// agent degrades gracefully (see main/agent/simulator.ts) when it's absent.
export interface CharacterVoiceProfile {
  vocabulary?: string
  rhythm?: string
  educationLevel?: string
  humorStyle?: string
  emotionalGuardedness?: string
  accentOrDialect?: string
  verbalTics?: string[]
  tabooTopics?: string[]
  speechDirectness?: 'indirect' | 'balanced' | 'direct'
  formalityLevel?: 'casual' | 'neutral' | 'formal'
  favoritePhrases?: string[]
  avoidedPhrases?: string[]
  powerDynamics?: string
}

// Phase 9 continuity validators (Timeline "Continuity Checks" tab, see
// shared/continuityChecks.ts) — only meaningful when
// CodexEntry.type === 'character'. Optional and degrades gracefully when
// absent, same treatment as voiceProfile above: a character with no
// continuityProfile simply never participates in age/injury checks.
export interface CharacterContinuityProfile {
  birthDate?: string
  injuries?: {
    id: string
    description: string
    occurredSceneId?: string
    occurredDate?: string
    healedDate?: string
    healedSceneId?: string
  }[]
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
  voiceProfile?: CharacterVoiceProfile
  // Only meaningful when type === 'character' — see CharacterContinuityProfile above.
  continuityProfile?: CharacterContinuityProfile
  // Only meaningful when type === 'location' — known one-way travel times (in
  // days) to other location Codex entries, used by checkTravelTime in
  // shared/continuityChecks.ts. Optional/absent means "no known travel time
  // recorded yet," not "zero days" — checkTravelTime simply skips a pair with
  // no link in either direction rather than assuming instant travel.
  travelLinks?: { locationId: string; days: number }[]
  createdAt: string
  updatedAt: string
  history: CodexVersion[]
}
