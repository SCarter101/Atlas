import type { SceneMeta } from './schema/manuscript'

export type ChapterDraftStatus = 'not-started' | 'in-progress' | 'drafted'

export const CHAPTER_STATUS_LABEL: Record<ChapterDraftStatus, string> = {
  'not-started': 'Not started',
  'in-progress': 'In progress',
  drafted: 'Drafted'
}

// A chapter counts as "Drafted" once every scene in it has reached revised/
// final; any drafting activity short of that is "In progress"; no scenes at
// all is "Not started". Derived from real scene data rather than a stored
// field so it can never drift out of sync with the scenes themselves.
export function deriveChapterStatus(scenes: SceneMeta[]): ChapterDraftStatus {
  if (scenes.length === 0) return 'not-started'
  if (scenes.every((s) => s.status === 'revised' || s.status === 'final')) return 'drafted'
  return 'in-progress'
}
