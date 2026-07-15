import { randomUUID } from 'node:crypto'
import type { CodexEntry, CodexEntryType } from '@shared/schema/codex'
import type { SceneMeta, SceneStatus } from '@shared/schema/manuscript'
import type { AtlasDb } from '../persistence/db'
import { withBatchedPersist } from '../persistence/db'
import { upsertCodexEntry } from '../persistence/codexStore'
import { writeBookMeta, writeChapterMeta, writePartMeta } from '../persistence/manuscriptStore'
import { createProject } from '../persistence/projectStore'
import { writeScene } from '../persistence/sceneStore'

// Round 10 / Phase 9 Track C: a from-scratch fixture generator for
// performance profiling at real manuscript scale. Nothing like this existed
// before this track — the bundled "Cottonmouth" sample project
// (seedSampleProject.ts) is ~5 scenes / under 1,000 words, nowhere near
// enough to expose an O(n) file-walk or an O(n^2) persistence pattern that
// only shows up once a project has hundreds of scenes.
//
// The generated PROSE is synthetic/lorem-ipsum-style on purpose — realism of
// the words doesn't matter for a performance fixture. Realism of the
// STRUCTURE does: scene/chapter/word counts here are chosen to resemble what
// an actual ~120k-word novel looks like (a handful of books/parts, dozens of
// chapters, several scenes each), not one giant scene or one giant chapter,
// so every profiled code path (tree walk, per-scene indexing, per-chapter
// summarization, ...) sees the same shape of fan-out a real manuscript would
// produce.

// Small deterministic PRNG (mulberry32) so a given seed always produces byte-
// identical fixture content — needed for repeatable timing runs and for the
// content-hash-keyed summary/index caches (summaryStore.ts's hashContent,
// search.ts's indexedKey) not to behave differently across runs.
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WORD_BANK = [
  'river', 'ledger', 'harbor', 'quiet', 'iron', 'window', 'letter', 'shadow', 'north', 'ember',
  'silence', 'engine', 'copper', 'trail', 'orchard', 'signal', 'harvest', 'lantern', 'ridge', 'current',
  'stranger', 'promise', 'debt', 'threshold', 'salt', 'cargo', 'wire', 'season', 'porch', 'timber',
  'ash', 'compass', 'ledgerbook', 'wharf', 'granite', 'hollow', 'passage', 'ration', 'convoy', 'archive',
  'was', 'is', 'seemed', 'stood', 'walked', 'watched', 'remembered', 'wondered', 'said', 'answered',
  'crossed', 'carried', 'waited', 'listened', 'turned', 'followed', 'held', 'gathered', 'counted', 'searched',
  'quietly', 'slowly', 'again', 'still', 'never', 'always', 'somehow', 'almost', 'barely', 'finally',
  'the', 'a', 'and', 'but', 'because', 'before', 'after', 'until', 'though', 'while',
  'her', 'his', 'their', 'its', 'this', 'that', 'these', 'those', 'every', 'another'
]

const NAMES = [
  'Mara', 'Talen', 'Odessa', 'Corwin', 'Ines', 'Bram', 'Sable', 'Renna', 'Dashiell', 'Priya',
  'Ezra', 'Wren', 'Callum', 'Idris', 'Noor'
]

function makeRng(seed: number): () => number {
  return mulberry32(seed)
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

// Builds a sentence of roughly `length` words, sometimes as plain narration,
// sometimes as a quoted dialogue line — dialogue-shaped lines matter for
// structural realism since several profiled/downstream consumers
// (extractCodexCandidates' dialogue-attribution heuristic, the Dialoguer's
// voice-profile reasoning) specifically look for quoted speech.
function buildSentence(rng: () => number, length: number, dialogueChance: number): string {
  const words: string[] = []
  for (let i = 0; i < length; i++) words.push(pick(rng, WORD_BANK))
  const sentence = `${capitalize(words[0])} ${words.slice(1).join(' ')}.`
  if (rng() < dialogueChance) {
    const speaker = pick(rng, NAMES)
    return `"${sentence.slice(0, -1)}," ${speaker} said.`
  }
  return sentence
}

// Builds prose with `targetWords` words split into paragraphs of ~60-140
// words each (a realistic paragraph size), matching the double-newline
// convention ManuscriptEditor.tsx's proseToHtml()/import's parseManuscript.ts
// both already treat as a paragraph break.
export function buildProse(targetWords: number, seed: number): string {
  const rng = makeRng(seed)
  const paragraphs: string[] = []
  let wordsLeft = targetWords
  while (wordsLeft > 0) {
    const paraWords = Math.min(wordsLeft, 60 + Math.floor(rng() * 80))
    const sentences: string[] = []
    let paraWordsLeft = paraWords
    while (paraWordsLeft > 0) {
      const sentenceLen = Math.min(paraWordsLeft, 8 + Math.floor(rng() * 14))
      sentences.push(buildSentence(rng, sentenceLen, 0.15))
      paraWordsLeft -= sentenceLen
    }
    paragraphs.push(sentences.join(' '))
    wordsLeft -= paraWords
  }
  return paragraphs.join('\n\n')
}

export interface LargeManuscriptFixtureOptions {
  bookCount?: number
  partsPerBook?: number
  chaptersPerPart?: number
  scenesPerChapter?: number
  wordsPerScene?: number
  characterCount?: number
  locationCount?: number
  plotThreadCount?: number
  seed?: number
}

export interface LargeManuscriptFixtureResult {
  projectRoot: string
  bookCount: number
  chapterCount: number
  sceneCount: number
  totalWordCount: number
  codexEntryCount: number
  sceneIds: string[]
  chapterIds: string[]
  characterIds: string[]
  locationIds: string[]
  plotThreadIds: string[]
}

const DEFAULTS: Required<LargeManuscriptFixtureOptions> = {
  bookCount: 2,
  partsPerBook: 2,
  chaptersPerPart: 10,
  scenesPerChapter: 5,
  wordsPerScene: 600,
  characterCount: 15,
  locationCount: 10,
  plotThreadCount: 8,
  seed: 42
}

const SCENE_STATUSES: SceneStatus[] = ['outline', 'drafting', 'drafted', 'revised', 'final']

function baseCodexEntry(
  partial: Pick<CodexEntry, 'id' | 'type' | 'name' | 'body'> & Partial<CodexEntry>
): CodexEntry {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    status: 'canon',
    isPrivate: false,
    localModelOnly: false,
    locked: false,
    source: 'author',
    relationships: [],
    manuscriptLinks: [],
    createdAt: now,
    updatedAt: now,
    history: [],
    ...partial
  }
}

// Generates and writes a full project to disk (real files, real SQLite
// index — the same writeScene/upsertCodexEntry/createProject functions any
// real project uses, not a synthetic in-memory shortcut) sized to resemble
// a ~120k-word novel: multiple books/parts/chapters/scenes, a Codex spanning
// characters/locations/plot-threads, and plausible per-scene Tier 1-3
// metadata (POV, location, craft beats, continuity links) rather than bare
// prose with no structure.
export async function generateLargeManuscriptFixture(
  projectRoot: string,
  db: AtlasDb,
  options: LargeManuscriptFixtureOptions = {}
): Promise<LargeManuscriptFixtureResult> {
  const opts = { ...DEFAULTS, ...options }
  const rng = makeRng(opts.seed)

  await createProject(projectRoot, {
    id: randomUUID(),
    title: 'The Long Ledger (Perf Fixture)',
    genrePrimary: 'Literary thriller',
    targetWordCount: opts.bookCount * opts.partsPerBook * opts.chaptersPerPart * opts.scenesPerChapter * opts.wordsPerScene,
    writerDisplayName: 'Perf Fixture'
  })

  const characterIds = Array.from({ length: opts.characterCount }, (_, i) => `character-${i + 1}`)
  const locationIds = Array.from({ length: opts.locationCount }, (_, i) => `location-${i + 1}`)
  const plotThreadIds = Array.from({ length: opts.plotThreadCount }, (_, i) => `plot-thread-${i + 1}`)

  const codexEntries: CodexEntry[] = []
  for (const [i, id] of characterIds.entries()) {
    codexEntries.push(
      baseCodexEntry({
        id,
        type: 'character',
        name: `${pick(rng, NAMES)} ${capitalize(pick(rng, WORD_BANK))} ${i + 1}`,
        body: { summary: buildProse(40, opts.seed + i + 1) },
        voiceProfile:
          i % 2 === 0
            ? {
                vocabulary: pick(rng, ['plain', 'formal', 'clipped', 'ornate']),
                rhythm: pick(rng, ['staccato', 'flowing', 'measured']),
                speechDirectness: pick(rng, ['indirect', 'balanced', 'direct'] as const),
                formalityLevel: pick(rng, ['casual', 'neutral', 'formal'] as const)
              }
            : undefined
      })
    )
  }
  for (const [i, id] of locationIds.entries()) {
    codexEntries.push(
      baseCodexEntry({
        id,
        type: 'location',
        name: `${capitalize(pick(rng, WORD_BANK))} ${pick(rng, ['Landing', 'Crossing', 'Yard', 'Quarter', 'Hollow'])} ${i + 1}`,
        body: { summary: buildProse(30, opts.seed + 1000 + i) }
      })
    )
  }
  for (const [i, id] of plotThreadIds.entries()) {
    codexEntries.push(
      baseCodexEntry({
        id,
        type: 'plot-thread',
        name: `Thread ${i + 1}: ${capitalize(pick(rng, WORD_BANK))} and ${pick(rng, WORD_BANK)}`,
        body: { summary: buildProse(30, opts.seed + 2000 + i) }
      })
    )
  }
  // A handful of themes/world-rules/factions rounds out "a reasonable
  // number of Codex entries" beyond just characters/locations/plot-threads.
  const extraTypes: { type: CodexEntryType; count: number }[] = [
    { type: 'faction', count: 4 },
    { type: 'theme', count: 5 },
    { type: 'world-rule', count: 4 },
    { type: 'timeline-item', count: 6 }
  ]
  let extraIndex = 0
  for (const { type, count } of extraTypes) {
    for (let i = 0; i < count; i++) {
      extraIndex++
      codexEntries.push(
        baseCodexEntry({
          id: `${type}-${i + 1}`,
          type,
          name: `${capitalize(pick(rng, WORD_BANK))} ${type} ${i + 1}`,
          body:
            type === 'timeline-item'
              ? { date: `Year ${i + 1}`, order: i, summary: buildProse(20, opts.seed + 3000 + extraIndex) }
              : { summary: buildProse(20, opts.seed + 3000 + extraIndex) }
        })
      )
    }
  }

  // Codex writes are batched the same way a bulk manuscript import is (see
  // withBatchedPersist's comment in persistence/db.ts) — writing ~50 Codex
  // entries one at a time, each with its own full-db persist(), is the same
  // quadratic pattern as the scene-writing loop below, just smaller.
  await withBatchedPersist(db, async () => {
    for (const entry of codexEntries) {
      await upsertCodexEntry(projectRoot, db, entry)
    }
  })

  const bookIds: string[] = []
  const chapterIds: string[] = []
  const sceneIds: string[] = []
  let totalWordCount = 0
  let chapterCounter = 0
  let sceneSeed = opts.seed + 10_000

  await withBatchedPersist(db, async () => {
    for (let bookIdx = 0; bookIdx < opts.bookCount; bookIdx++) {
      const bookId = `book-${String(bookIdx + 1).padStart(2, '0')}`
      bookIds.push(bookId)
      await writeBookMeta(projectRoot, { id: bookId, projectId: '', title: `Book ${bookIdx + 1}`, order: bookIdx })

      for (let partIdx = 0; partIdx < opts.partsPerBook; partIdx++) {
        const partId = `part-${String(partIdx + 1).padStart(2, '0')}`
        await writePartMeta(projectRoot, bookId, { id: partId, bookId, title: `Part ${partIdx + 1}`, order: partIdx })

        for (let chapterIdx = 0; chapterIdx < opts.chaptersPerPart; chapterIdx++) {
          chapterCounter++
          const chapterId = `chapter-${String(chapterCounter).padStart(3, '0')}`
          chapterIds.push(chapterId)
          const relativeDir = `${bookId}/${partId}/${chapterId}`

          const chapterSceneIds: string[] = []
          for (let sceneIdx = 0; sceneIdx < opts.scenesPerChapter; sceneIdx++) {
            chapterSceneIds.push(`${chapterId}-scene-${String(sceneIdx + 1).padStart(3, '0')}`)
          }

          await writeChapterMeta(projectRoot, bookId, partId, {
            id: chapterId,
            partId,
            title: `Chapter ${chapterCounter}`,
            order: chapterIdx,
            summary: buildProse(15, sceneSeed++),
            sceneIds: chapterSceneIds
          })

          for (let sceneIdx = 0; sceneIdx < opts.scenesPerChapter; sceneIdx++) {
            const sceneSlug = `scene-${String(sceneIdx + 1).padStart(3, '0')}`
            const globalSceneId = `${chapterId}-${sceneSlug}`
            sceneIds.push(globalSceneId)

            const prose = buildProse(opts.wordsPerScene, sceneSeed++)
            totalWordCount += prose.trim().split(/\s+/).filter(Boolean).length

            const povCharacterId = pick(rng, characterIds)
            const locationId = pick(rng, locationIds)
            const meta: SceneMeta = {
              schemaVersion: 2,
              id: globalSceneId,
              chapterId,
              order: sceneIdx,
              title: `Chapter ${chapterCounter}, Scene ${sceneIdx + 1}`,
              povCharacterId,
              locationId,
              timeOrDate: `Day ${chapterCounter}`,
              purpose: buildProse(10, sceneSeed++),
              presentCharacterIds: [povCharacterId, pick(rng, characterIds)],
              localModelOnly: false,
              craft: {
                characterDesire: buildProse(6, sceneSeed++),
                externalGoal: buildProse(6, sceneSeed++),
                stakes: buildProse(6, sceneSeed++),
                conflictLevel: 1 + Math.floor(rng() * 5)
              },
              continuity: {
                relatedCodexIds: [povCharacterId, locationId, pick(rng, plotThreadIds)],
                setupIds: rng() < 0.3 ? [pick(rng, plotThreadIds)] : undefined,
                payoffIds: rng() < 0.3 ? [pick(rng, plotThreadIds)] : undefined
              },
              wordCount: 0,
              status: pick(rng, SCENE_STATUSES),
              updatedAt: new Date().toISOString()
            }

            await writeScene(projectRoot, db, globalSceneId, { meta, prose }, relativeDir, sceneSlug)
          }
        }
      }
    }
  })

  return {
    projectRoot,
    bookCount: opts.bookCount,
    chapterCount: chapterIds.length,
    sceneCount: sceneIds.length,
    totalWordCount,
    codexEntryCount: codexEntries.length,
    sceneIds,
    chapterIds,
    characterIds,
    locationIds,
    plotThreadIds
  }
}
