import type { SessionGoal } from './session'

export type Theme = 'paper' | 'night' | 'typewriter'

export interface ProjectManifest {
  schemaVersion: 1
  id: string
  title: string
  createdAt: string
  updatedAt: string
  genrePrimary?: string
  targetWordCount?: number
  books: string[]
  activeSceneId?: string
  advancedMode: boolean
  theme: Theme
  // Optional display name for the dashboard's time-of-day greeting
  // ("Good afternoon, {name}'s Writing Desk"). Editable later in Settings;
  // left unset the greeting just reads "Good afternoon".
  writerDisplayName?: string
  // Daily writing goal shown/tracked on the Dashboard's "Today's session"
  // card. Unset means no goal has been configured yet.
  sessionGoal?: SessionGoal
}
