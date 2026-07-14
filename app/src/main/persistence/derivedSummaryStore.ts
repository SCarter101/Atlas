import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AtlasError } from '@shared/errors'
import { getCharacterPresenceMap, getManuscriptReadingOrder, getPlotThreadSceneLinks } from '@shared/codexLogic'
import type { CodexEntryType } from '@shared/schema/codex'
import type { DerivedSummary, DerivedSummaryKind } from '@shared/schema/retrieval'
import type { SummaryPromptPair } from '@shared/summaryPrompts'
import {
  buildCharacterArcSummaryPrompt,
  buildOpenPromisesSummaryPrompt,
  buildPayoffStatusSummaryPrompt,
  buildTimelineSummaryPrompt,
  buildWorldStateSummaryPrompt
} from '@shared/summaryPrompts'
import { listCodexEntries } from './codexStore'
import { readManuscriptTree } from './manuscriptStore'
import { generateSummaryViaModel } from './modelSummaryFallback'
import { derivedSummaryDir } from './paths'
import { extractSummary, hashContent } from './summaryStore'

// Phase 7's five DerivedSummary kinds (spec §9), same "real model call first,
// extractive heuristic on failure" chain as summaryStore.ts's scene/chapter
// summaries — see modelSummaryFallback.ts for the shared fallback logic.
// 'character-arc' is scoped to one Codex character entry (subjectId =
// characterId); the other four are project-level singletons and always use
// this fixed subject id.
const PROJECT_SUBJECT_ID = 'project'

function requireValidSubjectId(kind: DerivedSummaryKind, subjectId: string): void {
  if (kind !== 'character-arc' && subjectId !== PROJECT_SUBJECT_ID) {
    throw new AtlasError(
      `'${kind}' summaries are project-level singletons — expected subjectId '${PROJECT_SUBJECT_ID}', got '${subjectId}'.`,
      'DERIVED_SUMMARY_INVALID_SUBJECT'
    )
  }
}

async function readJsonSafe<T>(path: string): Promise<T | null> {
  const raw = await readFile(path, 'utf-8').catch(() => null)
  return raw ? (JSON.parse(raw) as T) : null
}

// A summary written before some future field existed would be missing it —
// same defensive normalization convention summaryStore.ts uses for
// SceneSummary/ChapterSummary, applied here even though DerivedSummary is
// new this round, for consistency and in case a kind is added later.
function normalizeDerivedSummary(raw: DerivedSummary): DerivedSummary {
  return { ...raw, generatedBy: raw.generatedBy ?? 'heuristic' }
}

function derivedSummaryPath(projectRoot: string, kind: DerivedSummaryKind, subjectId: string): string {
  return join(derivedSummaryDir(projectRoot, kind), `${subjectId}.json`)
}

async function gatherCharacterArcSource(
  projectRoot: string,
  characterId: string
): Promise<{ sourceText: string; characterName: string }> {
  const characters = await listCodexEntries(projectRoot, { type: 'character' })
  const character = characters.find((c) => c.id === characterId)
  if (!character) {
    throw new AtlasError(`Character '${characterId}' was not found in the Codex.`, 'DERIVED_SUMMARY_CHARACTER_NOT_FOUND')
  }

  const tree = await readManuscriptTree(projectRoot)
  const chapters = tree.books.flatMap((book) => book.parts.flatMap((part) => part.chapters))
  const [presenceRow] = getCharacterPresenceMap(tree, [{ id: character.id, name: character.name }])

  const appearanceLines = chapters
    .filter((chapter) => presenceRow?.presentByChapter.get(chapter.id))
    .map((chapter) => `- ${chapter.title}`)

  const craftLines: string[] = []
  for (const chapter of chapters) {
    for (const scene of chapter.scenes) {
      const present = scene.povCharacterId === character.id || (scene.presentCharacterIds ?? []).includes(character.id)
      if (!present) continue
      const beats = [
        scene.craft?.turningPoint ? `turning point: ${scene.craft.turningPoint}` : null,
        scene.craft?.emotionalShift ? `emotional shift: ${scene.craft.emotionalShift}` : null,
        scene.craft?.outcome ? `outcome: ${scene.craft.outcome}` : null
      ].filter((v): v is string => v !== null)
      if (beats.length > 0) craftLines.push(`- ${chapter.title} / ${scene.title}: ${beats.join('; ')}`)
    }
  }

  const description = typeof character.body.description === 'string' ? character.body.description : undefined

  const sourceText = [
    `Character: ${character.name}`,
    description ? `Description: ${description}` : null,
    appearanceLines.length > 0 ? `Appears in:\n${appearanceLines.join('\n')}` : 'No manuscript appearances recorded yet.',
    craftLines.length > 0 ? `Key beats:\n${craftLines.join('\n')}` : null
  ]
    .filter((v): v is string => v !== null && v.length > 0)
    .join('\n\n')

  return { sourceText, characterName: character.name }
}

async function gatherTimelineSource(projectRoot: string): Promise<string> {
  const entries = (await listCodexEntries(projectRoot)).filter((e) => e.type === 'timeline-item' || e.type === 'event')
  const tree = await readManuscriptTree(projectRoot)
  const readingOrder = getManuscriptReadingOrder(tree)
  const chapters = tree.books.flatMap((book) => book.parts.flatMap((part) => part.chapters))

  const entryLines = entries.map((entry) => {
    const when = typeof entry.body.when === 'string' ? ` (${entry.body.when})` : ''
    const description = typeof entry.body.description === 'string' ? `: ${entry.body.description}` : ''
    return `- [${entry.type}] ${entry.name}${when}${description}`
  })

  const placementLines: string[] = []
  for (const chapter of chapters) {
    for (const scene of chapter.scenes) {
      if (!scene.continuity?.timelinePlacement) continue
      const ordinal = readingOrder.get(scene.id) ?? 0
      placementLines.push(`- (reading position #${ordinal}) ${chapter.title} / ${scene.title}: ${scene.continuity.timelinePlacement}`)
    }
  }

  return [
    entryLines.length > 0 ? `Codex timeline & event entries:\n${entryLines.join('\n')}` : 'No timeline/event Codex entries recorded yet.',
    placementLines.length > 0 ? `Scene timeline placements (in manuscript reading order):\n${placementLines.join('\n')}` : null
  ]
    .filter((v): v is string => v !== null)
    .join('\n\n')
}

const WORLD_STATE_TYPES: CodexEntryType[] = ['location', 'faction', 'world-rule', 'object']

async function gatherWorldStateSource(projectRoot: string): Promise<string> {
  const entries = (await listCodexEntries(projectRoot)).filter((e) => WORLD_STATE_TYPES.includes(e.type))

  const lines = entries.map((entry) => {
    const bodySummary = Object.entries(entry.body)
      .filter((pair): pair is [string, string] => typeof pair[1] === 'string' && pair[1].trim().length > 0)
      .map(([key, value]) => `${key}: ${value}`)
      .join('; ')
    return `- [${entry.type}] ${entry.name} (${entry.status})${bodySummary ? ` — ${bodySummary}` : ''}`
  })

  return lines.length > 0 ? `World-building Codex entries:\n${lines.join('\n')}` : 'No world-building Codex entries recorded yet.'
}

interface PlotThreadStatus {
  open: string[]
  resolved: string[]
  unlinked: string[]
}

async function gatherPlotThreadStatus(projectRoot: string): Promise<PlotThreadStatus> {
  const entries = await listCodexEntries(projectRoot, { type: 'plot-thread' })
  const tree = await readManuscriptTree(projectRoot)
  const links = getPlotThreadSceneLinks(tree)

  const open: string[] = []
  const resolved: string[] = []
  const unlinked: string[] = []

  for (const entry of entries) {
    const link = links.get(entry.id)
    const setups = link?.setupSceneIds.length ?? 0
    const payoffs = link?.payoffSceneIds.length ?? 0
    if (setups > 0 && payoffs > 0) {
      resolved.push(`- ${entry.name}: ${setups} setup scene(s), ${payoffs} payoff scene(s)`)
    } else if (setups > 0) {
      open.push(`- ${entry.name}: set up in ${setups} scene(s), not yet paid off`)
    } else {
      unlinked.push(`- ${entry.name}: no setup or payoff scenes linked yet`)
    }
  }

  return { open, resolved, unlinked }
}

async function gatherOpenPromisesSource(projectRoot: string): Promise<string> {
  const { open, unlinked } = await gatherPlotThreadStatus(projectRoot)
  return [
    open.length > 0
      ? `Open plot threads (set up, not yet paid off):\n${open.join('\n')}`
      : 'No open plot threads — every tracked plot thread with a setup also has a payoff.',
    unlinked.length > 0 ? `Plot threads with no scenes linked yet:\n${unlinked.join('\n')}` : null
  ]
    .filter((v): v is string => v !== null)
    .join('\n\n')
}

async function gatherPayoffStatusSource(projectRoot: string): Promise<string> {
  const { open, resolved, unlinked } = await gatherPlotThreadStatus(projectRoot)
  return [
    resolved.length > 0 ? `Resolved plot threads:\n${resolved.join('\n')}` : 'No plot threads are fully resolved yet.',
    open.length > 0 ? `Pending plot threads:\n${open.join('\n')}` : null,
    unlinked.length > 0 ? `Unlinked plot threads:\n${unlinked.join('\n')}` : null
  ]
    .filter((v): v is string => v !== null)
    .join('\n\n')
}

async function buildSourceAndPrompt(
  projectRoot: string,
  kind: DerivedSummaryKind,
  subjectId: string
): Promise<{ sourceText: string; prompt: SummaryPromptPair }> {
  switch (kind) {
    case 'character-arc': {
      const { sourceText, characterName } = await gatherCharacterArcSource(projectRoot, subjectId)
      return { sourceText, prompt: buildCharacterArcSummaryPrompt(characterName) }
    }
    case 'timeline':
      return { sourceText: await gatherTimelineSource(projectRoot), prompt: buildTimelineSummaryPrompt() }
    case 'world-state':
      return { sourceText: await gatherWorldStateSource(projectRoot), prompt: buildWorldStateSummaryPrompt() }
    case 'open-promises':
      return { sourceText: await gatherOpenPromisesSource(projectRoot), prompt: buildOpenPromisesSummaryPrompt() }
    case 'payoff-status':
      return { sourceText: await gatherPayoffStatusSource(projectRoot), prompt: buildPayoffStatusSummaryPrompt() }
  }
}

export async function getOrGenerateDerivedSummary(
  projectRoot: string,
  kind: DerivedSummaryKind,
  subjectId: string
): Promise<DerivedSummary> {
  requireValidSubjectId(kind, subjectId)

  const { sourceText, prompt } = await buildSourceAndPrompt(projectRoot, kind, subjectId)
  const sourceFingerprint = hashContent(sourceText)

  const filePath = derivedSummaryPath(projectRoot, kind, subjectId)
  const existingRaw = await readJsonSafe<DerivedSummary>(filePath)
  const existing = existingRaw ? normalizeDerivedSummary(existingRaw) : null
  if (existing && existing.sourceFingerprint === sourceFingerprint) return existing

  const label = `${kind}:${subjectId}`
  const modelResult = sourceText.trim() ? await generateSummaryViaModel(projectRoot, label, prompt, sourceText) : null

  const summary: DerivedSummary = modelResult
    ? {
        kind,
        subjectId,
        summary: modelResult.text,
        sourceFingerprint,
        generatedBy: 'model',
        modelRef: modelResult.modelRef,
        generatedAt: new Date().toISOString()
      }
    : {
        kind,
        subjectId,
        summary: extractSummary(sourceText, 4, 500),
        sourceFingerprint,
        generatedBy: 'heuristic',
        generatedAt: new Date().toISOString()
      }

  await mkdir(derivedSummaryDir(projectRoot, kind), { recursive: true })
  await writeFile(filePath, JSON.stringify(summary, null, 2), 'utf-8')
  return summary
}
