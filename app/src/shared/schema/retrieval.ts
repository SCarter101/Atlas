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
