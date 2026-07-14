import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChapterSummary, SceneSummary } from '@shared/schema/retrieval'
import { buildChapterSummaryPrompt, buildSceneSummaryPrompt } from '@shared/summaryPrompts'
import { generateSummaryViaModel } from './modelSummaryFallback'
import { projectPaths } from './paths'

// Rolling scene/chapter summaries. Phase 7: generation now tries a real
// model call first (local LM Studio, then OpenRouter — see
// modelSummaryFallback.ts) and only falls back to the deterministic
// extractive heuristic (first N sentences of the source text) when both real
// tiers fail or are unconfigured — the heuristic was the *only* generation
// path through Phase 3-6, in the same "clearly labeled simulation" style as
// main/retrieval/vectorize.ts and main/agent/simulator.ts.
//
// getOrGenerateSceneSummary()'s signature only takes the scene's prose text,
// not its SceneMeta.updatedAt (sceneStore.ts, which owns SceneMeta, is out
// of scope to edit here), so "rolling" is implemented via a content
// fingerprint of the prose itself rather than the scene's real updatedAt
// timestamp: sourceUpdatedAt stores a hash of the prose, and the summary is
// only regenerated when that hash no longer matches what's on disk. This
// still satisfies "not permanently stale, without recomputing on every
// read" — it just keys off content instead of a metadata timestamp.

export function hashContent(text: string): string {
  let hash = 5381
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 33) ^ text.charCodeAt(i)
  }
  return (hash >>> 0).toString(16)
}

export function extractSummary(text: string, maxSentences: number, maxLen: number): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const sentences = trimmed.match(/[^.!?]+[.!?]*/g) ?? [trimmed]
  const excerpt = sentences.slice(0, maxSentences).join(' ').trim()
  return excerpt.length > maxLen ? `${excerpt.slice(0, maxLen).trim()}…` : excerpt
}

async function readJsonSafe<T>(path: string): Promise<T | null> {
  const raw = await readFile(path, 'utf-8').catch(() => null)
  return raw ? (JSON.parse(raw) as T) : null
}

// A summary cached before Phase 7 has no `generatedBy` on disk — treat that
// as 'heuristic' (the only generation path that existed then) rather than
// leaving it undefined, since every store/summaryStore.test.ts consumer and
// the SummariesGetDerived-adjacent renderer surfacing (Wave 1C) can rely on
// SceneSummary.generatedBy always being present per its type.
function normalizeSceneSummary(raw: SceneSummary): SceneSummary {
  return { ...raw, generatedBy: raw.generatedBy ?? 'heuristic' }
}

function normalizeChapterSummary(raw: ChapterSummary): ChapterSummary {
  return { ...raw, generatedBy: raw.generatedBy ?? 'heuristic' }
}

function sceneSummaryPath(projectRoot: string, sceneId: string): string {
  return join(projectPaths(projectRoot).summariesDir, 'scenes', `${sceneId}.json`)
}

function chapterSummaryPath(projectRoot: string, chapterId: string): string {
  return join(projectPaths(projectRoot).summariesDir, 'chapters', `${chapterId}.json`)
}

export function chapterSummaryExists(projectRoot: string, chapterId: string): boolean {
  return existsSync(chapterSummaryPath(projectRoot, chapterId))
}

export async function getOrGenerateSceneSummary(
  projectRoot: string,
  sceneId: string,
  proseText: string
): Promise<SceneSummary> {
  const filePath = sceneSummaryPath(projectRoot, sceneId)
  const sourceUpdatedAt = hashContent(proseText)

  const existingRaw = await readJsonSafe<SceneSummary>(filePath)
  const existing = existingRaw ? normalizeSceneSummary(existingRaw) : null
  if (existing && existing.sourceUpdatedAt === sourceUpdatedAt) return existing

  const modelResult = proseText.trim()
    ? await generateSummaryViaModel(projectRoot, `scene-summary:${sceneId}`, buildSceneSummaryPrompt(), proseText)
    : null

  const summary: SceneSummary = modelResult
    ? {
        sceneId,
        summary: modelResult.text,
        sourceUpdatedAt,
        updatedAt: new Date().toISOString(),
        generatedBy: 'model',
        modelRef: modelResult.modelRef
      }
    : {
        sceneId,
        summary: extractSummary(proseText, 2, 280),
        sourceUpdatedAt,
        updatedAt: new Date().toISOString(),
        generatedBy: 'heuristic'
      }

  await mkdir(join(projectPaths(projectRoot).summariesDir, 'scenes'), { recursive: true })
  await writeFile(filePath, JSON.stringify(summary, null, 2), 'utf-8')
  return summary
}

export async function getOrGenerateChapterSummary(
  projectRoot: string,
  chapterId: string,
  sceneSummaries: SceneSummary[]
): Promise<ChapterSummary> {
  const filePath = chapterSummaryPath(projectRoot, chapterId)
  const sortedSceneSummaries = [...sceneSummaries].sort((a, b) => a.sceneId.localeCompare(b.sceneId))
  const sourceUpdatedAt = sortedSceneSummaries.map((s) => `${s.sceneId}:${s.sourceUpdatedAt}`).join('|')

  const existingRaw = await readJsonSafe<ChapterSummary>(filePath)
  const existing = existingRaw ? normalizeChapterSummary(existingRaw) : null
  if (existing && existing.sourceUpdatedAt === sourceUpdatedAt) return existing

  const combinedSceneSummaries = sortedSceneSummaries.map((s) => s.summary).join(' ')
  const modelResult = combinedSceneSummaries.trim()
    ? await generateSummaryViaModel(
        projectRoot,
        `chapter-summary:${chapterId}`,
        buildChapterSummaryPrompt(),
        combinedSceneSummaries
      )
    : null

  const summary: ChapterSummary = modelResult
    ? {
        chapterId,
        summary: modelResult.text,
        sourceUpdatedAt,
        updatedAt: new Date().toISOString(),
        generatedBy: 'model',
        modelRef: modelResult.modelRef
      }
    : {
        chapterId,
        summary: extractSummary(combinedSceneSummaries, 4, 400),
        sourceUpdatedAt,
        updatedAt: new Date().toISOString(),
        generatedBy: 'heuristic'
      }

  await mkdir(join(projectPaths(projectRoot).summariesDir, 'chapters'), { recursive: true })
  await writeFile(filePath, JSON.stringify(summary, null, 2), 'utf-8')
  return summary
}
