import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodexEntry } from '@shared/schema/codex'
import type { Book, Chapter, Part, SceneMeta } from '@shared/schema/manuscript'

// derivedSummaryStore.ts routes through generateSummaryViaModel(), which
// calls the real OpenRouterAdapter (reads its key via
// main/security/keyVault.ts's getSecret()) — mocked here the same way
// summaryStore.test.ts and modelSummaryFallback.test.ts do, so this stays a
// hermetic unit test regardless of what's running on the developer's
// machine.
const getSecretMock = vi.fn()
vi.mock('../security/keyVault', () => ({
  getSecret: (name: string) => getSecretMock(name)
}))

const { getOrGenerateDerivedSummary } = await import('./derivedSummaryStore')
const { writeBookMeta, writeChapterMeta, writePartMeta } = await import('./manuscriptStore')
const { CODEX_TYPE_DIRS, projectPaths } = await import('./paths')

const LM_STUDIO_CHAT_URL = 'http://localhost:1234/v1/chat/completions'

function alwaysFailFetchMock(): ReturnType<typeof vi.fn> {
  return vi.fn((url: string) => {
    if (url === LM_STUDIO_CHAT_URL) return Promise.reject(new Error('ECONNREFUSED'))
    throw new Error(`unexpected fetch to ${url}`)
  })
}

function makeSceneMeta(overrides: Partial<SceneMeta> & Pick<SceneMeta, 'id' | 'chapterId' | 'order' | 'title'>): SceneMeta {
  return {
    schemaVersion: 2,
    wordCount: 100,
    status: 'drafted',
    updatedAt: new Date().toISOString(),
    ...overrides
  }
}

async function writeSceneMetaFile(
  projectRoot: string,
  bookId: string,
  partId: string,
  chapterId: string,
  meta: SceneMeta
): Promise<void> {
  const dir = join(projectPaths(projectRoot).manuscriptDir, bookId, partId, chapterId)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${meta.id}.meta.json`), JSON.stringify(meta, null, 2), 'utf-8')
}

function makeCodexEntry(overrides: Partial<CodexEntry> & Pick<CodexEntry, 'id' | 'type' | 'name'>): CodexEntry {
  return {
    schemaVersion: 1,
    status: 'canon',
    body: {},
    isPrivate: false,
    localModelOnly: false,
    locked: false,
    source: 'author',
    relationships: [],
    manuscriptLinks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
    ...overrides
  }
}

async function writeCodexEntryFile(projectRoot: string, entry: CodexEntry): Promise<void> {
  const dirName = CODEX_TYPE_DIRS[entry.type]
  const dir = join(projectPaths(projectRoot).codexDir, dirName)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${entry.id}.json`), JSON.stringify(entry, null, 2), 'utf-8')
}

async function setupManuscript(projectRoot: string): Promise<void> {
  const book: Book = { id: 'book-1', projectId: 'proj-1', title: 'Book One', order: 0 }
  const part: Part = { id: 'part-1', bookId: 'book-1', title: 'Part One', order: 0 }
  const chapter1: Chapter = { id: 'ch-1', partId: 'part-1', title: 'Chapter One', order: 0, sceneIds: ['scene-1'] }
  const chapter2: Chapter = { id: 'ch-2', partId: 'part-1', title: 'Chapter Two', order: 1, sceneIds: ['scene-2'] }

  await writeBookMeta(projectRoot, book)
  await writePartMeta(projectRoot, 'book-1', part)
  await writeChapterMeta(projectRoot, 'book-1', 'part-1', chapter1)
  await writeChapterMeta(projectRoot, 'book-1', 'part-1', chapter2)

  await writeSceneMetaFile(
    projectRoot,
    'book-1',
    'part-1',
    'ch-1',
    makeSceneMeta({
      id: 'scene-1',
      chapterId: 'ch-1',
      order: 0,
      title: 'Scene One',
      povCharacterId: 'char-1',
      craft: { turningPoint: 'She decides to leave the levee for good.' },
      continuity: { timelinePlacement: 'Day 1, dawn', setupIds: ['thread-1'] }
    })
  )
  await writeSceneMetaFile(
    projectRoot,
    'book-1',
    'part-1',
    'ch-2',
    makeSceneMeta({
      id: 'scene-2',
      chapterId: 'ch-2',
      order: 0,
      title: 'Scene Two',
      presentCharacterIds: ['char-1'],
      craft: { emotionalShift: 'Relief turns to dread when the levee breaks.' },
      continuity: { timelinePlacement: 'Day 3, night' }
    })
  )
}

describe('getOrGenerateDerivedSummary', () => {
  let projectRoot: string

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-derived-summary-test-'))
    getSecretMock.mockReset()
    getSecretMock.mockResolvedValue(null)
    vi.stubGlobal('fetch', alwaysFailFetchMock())
    await setupManuscript(projectRoot)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    rmSync(projectRoot, { recursive: true, force: true })
  })

  describe('character-arc', () => {
    beforeEach(async () => {
      await writeCodexEntryFile(
        projectRoot,
        makeCodexEntry({ id: 'char-1', type: 'character', name: 'Dale', body: { description: 'A stubborn levee-keeper.' } })
      )
    })

    it('gathers presence + craft beats into a heuristic summary and mentions the character', async () => {
      const summary = await getOrGenerateDerivedSummary(projectRoot, 'character-arc', 'char-1')
      expect(summary.kind).toBe('character-arc')
      expect(summary.subjectId).toBe('char-1')
      expect(summary.generatedBy).toBe('heuristic')
      expect(summary.summary).toContain('Dale')
    })

    it('throws when the character does not exist in the Codex', async () => {
      await expect(getOrGenerateDerivedSummary(projectRoot, 'character-arc', 'char-nonexistent')).rejects.toMatchObject({
        code: 'DERIVED_SUMMARY_CHARACTER_NOT_FOUND'
      })
    })

    it('uses a real model completion and records usage when LM Studio is available', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => {
          if (url === LM_STUDIO_CHAT_URL) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  choices: [{ message: { content: "Dale's arc so far: leaving, then loss." } }],
                  usage: { prompt_tokens: 25, completion_tokens: 10 }
                }),
                { status: 200 }
              )
            )
          }
          throw new Error(`unexpected fetch to ${url}`)
        })
      )

      const summary = await getOrGenerateDerivedSummary(projectRoot, 'character-arc', 'char-1')
      expect(summary.generatedBy).toBe('model')
      expect(summary.summary).toBe("Dale's arc so far: leaving, then loss.")
      expect(summary.modelRef).toEqual({ provider: 'lm-studio', modelId: 'local-summarizer', viaOpenRouter: false })

      const usageLog = await readFile(join(projectRoot, 'settings', 'usage.jsonl'), 'utf-8')
      const entry = JSON.parse(usageLog.trim())
      expect(entry).toMatchObject({ callKind: 'summary-generation', label: 'character-arc:char-1' })
    })

    it('does not regenerate when nothing about the character has changed', async () => {
      const first = await getOrGenerateDerivedSummary(projectRoot, 'character-arc', 'char-1')
      const fetchMock = vi.fn(() => {
        throw new Error('should not attempt any model call on a cache hit')
      })
      vi.stubGlobal('fetch', fetchMock)

      const second = await getOrGenerateDerivedSummary(projectRoot, 'character-arc', 'char-1')
      expect(second).toEqual(first)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('regenerates when the character gains a new scene appearance', async () => {
      const first = await getOrGenerateDerivedSummary(projectRoot, 'character-arc', 'char-1')

      await writeSceneMetaFile(
        projectRoot,
        'book-1',
        'part-1',
        'ch-2',
        makeSceneMeta({
          id: 'scene-3',
          chapterId: 'ch-2',
          order: 1,
          title: 'Scene Three',
          povCharacterId: 'char-1',
          craft: { outcome: 'Dale rebuilds the levee himself.' }
        })
      )

      const second = await getOrGenerateDerivedSummary(projectRoot, 'character-arc', 'char-1')
      expect(second.sourceFingerprint).not.toBe(first.sourceFingerprint)
      expect(second.summary).toContain('rebuilds')
    })
  })

  describe('project-level singleton kinds', () => {
    it('rejects a non-"project" subjectId for a singleton kind', async () => {
      await expect(getOrGenerateDerivedSummary(projectRoot, 'timeline', 'char-1')).rejects.toMatchObject({
        code: 'DERIVED_SUMMARY_INVALID_SUBJECT'
      })
    })

    it('builds a timeline summary from timeline-item/event entries and scene timeline placements', async () => {
      await writeCodexEntryFile(
        projectRoot,
        makeCodexEntry({ id: 'event-1', type: 'event', name: 'The Flood', body: { when: 'Day 3', description: 'The levee breaks.' } })
      )

      const summary = await getOrGenerateDerivedSummary(projectRoot, 'timeline', 'project')
      expect(summary.kind).toBe('timeline')
      expect(summary.subjectId).toBe('project')
      expect(summary.summary).toContain('Flood')
    })

    it('builds a world-state summary from location/faction/world-rule/object entries', async () => {
      await writeCodexEntryFile(
        projectRoot,
        makeCodexEntry({
          id: 'loc-1',
          type: 'location',
          name: 'The Levee Road',
          body: { description: 'A long gravel road above the water line.' }
        })
      )

      const summary = await getOrGenerateDerivedSummary(projectRoot, 'world-state', 'project')
      expect(summary.summary).toContain('Levee Road')
    })

    it('reports an open plot thread that has a setup scene but no payoff scene', async () => {
      await writeCodexEntryFile(projectRoot, makeCodexEntry({ id: 'thread-1', type: 'plot-thread', name: 'The Levee Break' }))

      const summary = await getOrGenerateDerivedSummary(projectRoot, 'open-promises', 'project')
      expect(summary.summary).toContain('Levee Break')
    })

    it('reports a resolved plot thread once both its setup and payoff scenes exist', async () => {
      await writeCodexEntryFile(projectRoot, makeCodexEntry({ id: 'thread-1', type: 'plot-thread', name: 'The Levee Break' }))

      // scene-2 (written in setupManuscript) already carries payoffIds: [] by
      // default — add the payoff link so this thread resolves.
      await writeSceneMetaFile(
        projectRoot,
        'book-1',
        'part-1',
        'ch-2',
        makeSceneMeta({
          id: 'scene-2',
          chapterId: 'ch-2',
          order: 0,
          title: 'Scene Two',
          presentCharacterIds: ['char-1'],
          continuity: { timelinePlacement: 'Day 3, night', payoffIds: ['thread-1'] }
        })
      )

      const openSummary = await getOrGenerateDerivedSummary(projectRoot, 'open-promises', 'project')
      expect(openSummary.summary).not.toContain('Levee Break')

      const payoffSummary = await getOrGenerateDerivedSummary(projectRoot, 'payoff-status', 'project')
      expect(payoffSummary.summary).toContain('Levee Break')
    })

    it('caches a project-level singleton and does not regenerate when nothing changed', async () => {
      const first = await getOrGenerateDerivedSummary(projectRoot, 'world-state', 'project')
      const fetchMock = vi.fn(() => {
        throw new Error('should not attempt any model call on a cache hit')
      })
      vi.stubGlobal('fetch', fetchMock)

      const second = await getOrGenerateDerivedSummary(projectRoot, 'world-state', 'project')
      expect(second).toEqual(first)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
