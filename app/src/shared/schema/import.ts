import type { CodexEntryType } from './codex'

export interface CodexCandidate {
  type: CodexEntryType
  name: string
  summary: string
  confidence: 'low' | 'medium'
}
