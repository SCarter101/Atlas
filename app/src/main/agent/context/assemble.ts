import type { AgentGoal, ContextSection, ContextSectionClass } from '@shared/schema/agent'
import type { CodexEntry } from '@shared/schema/codex'
import type { ManuscriptTree } from '@shared/schema/manuscript'
import type { SceneSummary } from '@shared/schema/retrieval'
import { filterBySpoilerReveal, getManuscriptReadingOrder } from '@shared/codexLogic'
import type { AtlasDb } from '../../persistence/db'
import { listCodexEntries } from '../../persistence/codexStore'
import { readManuscriptTree } from '../../persistence/manuscriptStore'
import { readScene } from '../../persistence/sceneStore'
import { getOrGenerateChapterSummary, getOrGenerateSceneSummary } from '../../persistence/summaryStore'
import { getPreferredEmbeddingProvider } from '../../retrieval/embeddings/select'
import { ensureIndexed, search } from '../../retrieval/search'

// Phase 7: this module is the missing link between everything Phases 3-7
// built (real retrieval, real model-generated summaries, a real Codex, real
// spoiler-gating logic) and an actual model call's contextText — before this,
// runModelCallStep() in simulator.ts always sent nothing but the writer's
// bare highlighted selection. Priority order below is spec §9 verbatim; see
// simulator.ts's 5 call sites for how the result is threaded into a real
// ModelCallInput and recorded on the returned ModelCallSummary for Context
// Inspection.

export interface AssembledContext {
  contextText: string
  sections: ContextSection[]
  tokenBudget: number
}

// Rough length-based estimate — same style as the private helper in
// providers/lmStudioAdapter.ts (kept separate rather than imported/exported
// from there: this module has no business depending on a specific provider
// adapter's internals, and the heuristic itself is a one-liner not worth
// coupling two otherwise-unrelated modules over).
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.trim().length / 4))
}

// A prospective section that still needs to compete for token budget, versus
// one that's already decided to be excluded for a budget-independent reason
// (right now: spoiler-gating) and must never be resurrected just because
// there happened to be room for it.
interface Candidate {
  class: ContextSectionClass
  label: string
  text: string
}

type Item = { kind: 'candidate'; candidate: Candidate } | { kind: 'excluded'; section: ContextSection }

// Packs `items` into `sections`/`contextText` in the order given (i.e. the
// caller's priority order), greedily including candidates while there's
// still room under `maxTokens`. A candidate that doesn't fit becomes an
// `included: false` section with an explanatory reason rather than being
// silently dropped — same for pre-excluded items (e.g. spoiler-gated Codex
// entries), which never compete for budget in the first place.
function buildSections(items: Item[], maxTokens: number): { sections: ContextSection[]; contextText: string } {
  let used = 0
  const sections: ContextSection[] = []
  const textParts: string[] = []

  for (const item of items) {
    if (item.kind === 'excluded') {
      sections.push(item.section)
      continue
    }

    const { class: sectionClass, label, text } = item.candidate
    const tokensEstimate = estimateTokens(text)

    if (used + tokensEstimate <= maxTokens) {
      sections.push({ class: sectionClass, label, included: true, tokensEstimate })
      textParts.push(`## ${label}\n${text.trim()}\n\n`)
      used += tokensEstimate
    } else {
      sections.push({ class: sectionClass, label, included: false, tokensEstimate, excludedReason: 'over token budget' })
    }
  }

  return { sections, contextText: textParts.join('') }
}

function codexEntryText(entry: CodexEntry): string {
  const bodyText = Object.entries(entry.body)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join('\n')
  return [entry.name, bodyText].filter((part) => part.length > 0).join('\n')
}

type TreeChapter = ManuscriptTree['books'][number]['parts'][number]['chapters'][number]

function flattenChapters(tree: ManuscriptTree): TreeChapter[] {
  return tree.books.flatMap((book) => book.parts.flatMap((part) => part.chapters))
}

// Priority 1: the immediately preceding chapter's summary (real model-
// generated when getOrGenerateChapterSummary can produce one, extractive
// heuristic otherwise — either way, a first-class real operation per Wave 1,
// not a placeholder). Deliberately scoped to just the one directly-preceding
// chapter rather than every earlier chapter in the manuscript: "previous
// chapter summaries" (spec §9, plural) doesn't specify a count, and
// unbounded backward generation would multiply real model calls per agent
// run for a long manuscript. Returns undefined whenever there's no earlier
// chapter, its scenes aren't readable yet, or the resulting summary is empty.
async function previousChapterSummaryItem(
  projectRoot: string,
  db: AtlasDb,
  tree: ManuscriptTree,
  sceneId: string
): Promise<Item | undefined> {
  const chapters = flattenChapters(tree)
  const currentIndex = chapters.findIndex((chapter) => chapter.scenes.some((scene) => scene.id === sceneId))
  if (currentIndex <= 0) return undefined

  const previous = chapters[currentIndex - 1]
  if (previous.scenes.length === 0) return undefined

  const sceneSummaries: SceneSummary[] = []
  for (const scene of previous.scenes) {
    try {
      const { prose } = await readScene(projectRoot, db, scene.id)
      sceneSummaries.push(await getOrGenerateSceneSummary(projectRoot, scene.id, prose))
    } catch {
      // Scene not indexed/readable — chapter summary still works off
      // whichever sibling scenes are.
    }
  }
  if (sceneSummaries.length === 0) return undefined

  const chapterSummary = await getOrGenerateChapterSummary(projectRoot, previous.id, sceneSummaries)
  if (!chapterSummary.summary.trim()) return undefined

  return {
    kind: 'candidate',
    candidate: {
      class: 'chapter-summary',
      label: `Previous chapter summary — "${previous.title}"`,
      text: chapterSummary.summary
    }
  }
}

// Priority 2: the current scene's own metadata/outline — title always,
// everything else only when the writer has actually filled it in.
async function currentSceneOutlineItem(
  projectRoot: string,
  db: AtlasDb,
  sceneId: string,
  allEntries: CodexEntry[]
): Promise<Item | undefined> {
  try {
    const { meta } = await readScene(projectRoot, db, sceneId)
    const lines: string[] = [`Title: ${meta.title}`]

    if (meta.povCharacterId) {
      const pov = allEntries.find((entry) => entry.id === meta.povCharacterId)
      lines.push(`POV character: ${pov?.name ?? meta.povCharacterId}`)
    }
    if (meta.locationId) {
      const location = allEntries.find((entry) => entry.id === meta.locationId)
      lines.push(`Location: ${location?.name ?? meta.locationId}`)
    }
    if (meta.timeOrDate) lines.push(`Time/date: ${meta.timeOrDate}`)
    if (meta.purpose) lines.push(`Scene purpose: ${meta.purpose}`)

    const craft = meta.craft
    if (craft?.stakes) lines.push(`Stakes: ${craft.stakes}`)
    if (craft?.turningPoint) lines.push(`Turning point: ${craft.turningPoint}`)
    if (craft?.characterDesire) lines.push(`Character desire: ${craft.characterDesire}`)
    if (craft?.externalGoal) lines.push(`External goal: ${craft.externalGoal}`)
    if (craft?.internalConflict) lines.push(`Internal conflict: ${craft.internalConflict}`)
    if (craft?.opposition) lines.push(`Opposition: ${craft.opposition}`)
    if (craft?.outcome) lines.push(`Outcome: ${craft.outcome}`)

    return {
      kind: 'candidate',
      candidate: { class: 'scene-outline', label: `Scene outline — "${meta.title}"`, text: lines.join('\n') }
    }
  } catch {
    return undefined
  }
}

async function scenePresentCharacterIds(projectRoot: string, db: AtlasDb, sceneId: string): Promise<string[]> {
  try {
    const { meta } = await readScene(projectRoot, db, sceneId)
    const ids = new Set<string>(meta.presentCharacterIds ?? [])
    if (meta.povCharacterId) ids.add(meta.povCharacterId)
    return [...ids]
  } catch {
    return []
  }
}

// Priority 3: Codex entries relevant to this run — both explicitly-scoped
// (goal.scope.codexEntryIds) and retrieved via a real search() call keyed on
// the run's intent/selection, then spoiler-gated per the current scene's
// place in reading order (Phase 7 exit criterion: a spoiler-flagged fact from
// a later scene must never appear in an earlier scene's assembled context).
// Entries that fail the spoiler gate are returned as pre-excluded sections —
// never eligible for inclusion regardless of token budget.
async function relevantCodexItems(
  db: AtlasDb,
  projectRoot: string,
  goal: AgentGoal,
  allEntries: CodexEntry[],
  readingOrder: Map<string, number>,
  sceneId: string | undefined
): Promise<Item[]> {
  const byId = new Map(allEntries.map((entry) => [entry.id, entry]))
  const candidateIds = new Set<string>(goal.scope.codexEntryIds ?? [])

  const query = `${goal.userIntent} ${goal.scope.selectionText ?? ''}`.trim()
  if (query.length > 0) {
    try {
      const embeddingProvider = getPreferredEmbeddingProvider() ?? 'lm-studio'
      await ensureIndexed(db, projectRoot, embeddingProvider)
      const results = await search(db, query, { kind: 'codex-entry', limit: 5, model: embeddingProvider })
      for (const result of results) candidateIds.add(result.id)
    } catch {
      // Retrieval unavailable shouldn't block context assembly — fall
      // through with whatever explicit codexEntryIds were already scoped.
    }
  }

  const candidateEntries = [...candidateIds].map((id) => byId.get(id)).filter((e): e is CodexEntry => e !== undefined)
  const allowedIds = new Set(filterBySpoilerReveal(candidateEntries, sceneId, readingOrder).map((entry) => entry.id))

  const items: Item[] = []
  for (const entry of candidateEntries) {
    if (!allowedIds.has(entry.id)) {
      items.push({
        kind: 'excluded',
        section: {
          class: 'codex-entry',
          label: `Codex entry — "${entry.name}"`,
          included: false,
          tokensEstimate: estimateTokens(codexEntryText(entry)),
          excludedReason: 'spoiler-filtered for current scene'
        }
      })
      continue
    }
    items.push({
      kind: 'candidate',
      candidate: { class: 'codex-entry', label: `Codex entry — "${entry.name}"`, text: codexEntryText(entry) }
    })
  }
  return items
}

// Priority 4: voice profiles for characters actually present in this run's
// scope (POV + presentCharacterIds) — not every character in the Codex.
function voiceProfileItems(allEntries: CodexEntry[], presentCharacterIds: string[]): Item[] {
  const items: Item[] = []
  for (const id of presentCharacterIds) {
    const entry = allEntries.find((e) => e.id === id && e.type === 'character')
    const profile = entry?.voiceProfile
    if (!entry || !profile) continue

    const lines: string[] = []
    if (profile.vocabulary) lines.push(`Vocabulary: ${profile.vocabulary}`)
    if (profile.rhythm) lines.push(`Rhythm: ${profile.rhythm}`)
    if (profile.speechDirectness) lines.push(`Directness: ${profile.speechDirectness}`)
    if (profile.formalityLevel) lines.push(`Formality: ${profile.formalityLevel}`)
    if (profile.humorStyle) lines.push(`Humor style: ${profile.humorStyle}`)
    if (profile.verbalTics?.length) lines.push(`Verbal tics: ${profile.verbalTics.join(', ')}`)
    if (profile.favoritePhrases?.length) lines.push(`Favorite phrases: ${profile.favoritePhrases.join(', ')}`)
    if (profile.avoidedPhrases?.length) lines.push(`Avoided phrases: ${profile.avoidedPhrases.join(', ')}`)
    if (lines.length === 0) continue

    items.push({
      kind: 'candidate',
      candidate: { class: 'voice-profile', label: `Voice profile — "${entry.name}"`, text: lines.join('\n') }
    })
  }
  return items
}

// Priority 5: every locked world-rule entry — locked is the writer's own
// signal that a fact is settled canon an agent must never contradict, so
// unlike Codex entries generally, these aren't scoped to a search match.
function lockedWorldRuleItems(allEntries: CodexEntry[]): Item[] {
  return allEntries
    .filter((entry) => entry.type === 'world-rule' && entry.locked)
    .map((entry) => ({
      kind: 'candidate' as const,
      candidate: { class: 'locked-world-rule' as const, label: `Locked world rule — "${entry.name}"`, text: codexEntryText(entry) }
    }))
}

export async function assembleContext(
  projectRoot: string,
  db: AtlasDb,
  goal: AgentGoal,
  // World Builder interview path (see simulator.ts's runWorldBuilder): the
  // interview wizard's own compiled answers ARE the context — there's
  // nothing to retrieve yet since this run is what proposes the Codex
  // entries in the first place. Wrapping the interview text as a single
  // recent-excerpt-classed candidate (still subject to the same budget
  // packing as everything else) avoids doing full retrieval that would have
  // nothing real to find.
  opts?: { overrideText: string; overrideLabel: string }
): Promise<AssembledContext> {
  const tokenBudget = goal.constraints.maxTokens

  if (opts) {
    const items: Item[] =
      opts.overrideText.trim().length > 0
        ? [{ kind: 'candidate', candidate: { class: 'recent-excerpt', label: opts.overrideLabel, text: opts.overrideText } }]
        : []
    const { sections, contextText } = buildSections(items, tokenBudget)
    return { contextText, sections, tokenBudget }
  }

  const sceneId = goal.scope.sceneIds?.[0]
  const items: Item[] = []

  let allEntries: CodexEntry[] = []
  try {
    allEntries = await listCodexEntries(projectRoot)
  } catch {
    allEntries = []
  }

  let tree: ManuscriptTree = { books: [] }
  try {
    tree = await readManuscriptTree(projectRoot)
  } catch {
    tree = { books: [] }
  }
  const readingOrder = getManuscriptReadingOrder(tree)

  // 1. Previous chapter summary
  if (sceneId) {
    try {
      const previous = await previousChapterSummaryItem(projectRoot, db, tree, sceneId)
      if (previous) items.push(previous)
    } catch {
      // Best-effort — a summary-generation failure must never block the
      // model call itself, same "augment, don't block" contract every other
      // real-tool call in simulator.ts already follows.
    }
  }

  // 2. Current scene outline
  if (sceneId) {
    const outline = await currentSceneOutlineItem(projectRoot, db, sceneId, allEntries)
    if (outline) items.push(outline)
  }

  // 3. Relevant Codex entries (explicit + retrieved, spoiler-gated)
  try {
    items.push(...(await relevantCodexItems(db, projectRoot, goal, allEntries, readingOrder, sceneId)))
  } catch {
    // Best-effort, same reasoning as above.
  }

  // 4. Relevant character voice profiles
  const presentCharacterIds = sceneId ? await scenePresentCharacterIds(projectRoot, db, sceneId) : []
  items.push(...voiceProfileItems(allEntries, presentCharacterIds))

  // 5. Locked world rules
  items.push(...lockedWorldRuleItems(allEntries))

  // 6. Recent manuscript excerpt — the writer's own highlighted selection
  const selectionText = goal.scope.selectionText ?? ''
  if (selectionText.trim().length > 0) {
    items.push({
      kind: 'candidate',
      candidate: { class: 'recent-excerpt', label: "Writer's current selection", text: selectionText }
    })
  }

  // 7. Full scene text — lowest priority; only actually lands in contextText
  // if there's still budget left after everything above (buildSections'
  // greedy packing enforces that naturally, no special-casing needed here).
  if (sceneId) {
    try {
      const { prose } = await readScene(projectRoot, db, sceneId)
      if (prose.trim().length > 0) {
        items.push({ kind: 'candidate', candidate: { class: 'full-text', label: 'Full scene text', text: prose } })
      }
    } catch {
      // Scene not indexed — nothing to fall back to.
    }
  }

  const { sections, contextText } = buildSections(items, tokenBudget)
  return { contextText, sections, tokenBudget }
}
