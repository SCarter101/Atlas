import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openIndexDb, type AtlasDb } from '../persistence/db'
import { readManuscriptTree } from '../persistence/manuscriptStore'
import { listCodexEntries } from '../persistence/codexStore'
import { generateLargeManuscriptFixture } from './largeManuscriptFixture'

// Small-scale sanity checks for the fixture generator itself, run at a tiny
// size (not the full ~120k-word default) so this stays a fast, ordinary
// unit test — the full-scale generation + timing work lives in
// manuscriptScale.perf.test.ts.
describe('generateLargeManuscriptFixture', () => {
  let projectRoot: string
  let db: AtlasDb

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-fixture-test-'))
    db = await openIndexDb(projectRoot)
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  it('writes the requested book/chapter/scene shape to real project files', async () => {
    const result = await generateLargeManuscriptFixture(projectRoot, db, {
      bookCount: 1,
      partsPerBook: 1,
      chaptersPerPart: 3,
      scenesPerChapter: 2,
      wordsPerScene: 50,
      characterCount: 4,
      locationCount: 3,
      plotThreadCount: 2
    })

    expect(result.chapterCount).toBe(3)
    expect(result.sceneCount).toBe(6)

    const tree = await readManuscriptTree(projectRoot)
    const scenes = tree.books.flatMap((b) => b.parts.flatMap((p) => p.chapters.flatMap((c) => c.scenes)))
    expect(scenes.length).toBe(6)
    // Every scene id must be unique project-wide, same invariant
    // seedSampleProject.test.ts checks for the bundled sample project.
    expect(new Set(scenes.map((s) => s.id)).size).toBe(6)
    // wordCount is computed server-side by writeScene() from the actual
    // prose it wrote, not just trusted from the generator's own tally.
    for (const scene of scenes) {
      expect(scene.wordCount).toBeGreaterThan(0)
      expect(scene.povCharacterId).toBeTruthy()
      expect(scene.locationId).toBeTruthy()
    }
  })

  it('writes character/location/plot-thread Codex entries with the requested counts', async () => {
    const result = await generateLargeManuscriptFixture(projectRoot, db, {
      bookCount: 1,
      partsPerBook: 1,
      chaptersPerPart: 1,
      scenesPerChapter: 1,
      wordsPerScene: 20,
      characterCount: 5,
      locationCount: 3,
      plotThreadCount: 2
    })

    const entries = await listCodexEntries(projectRoot)
    expect(entries.filter((e) => e.type === 'character').length).toBe(5)
    expect(entries.filter((e) => e.type === 'location').length).toBe(3)
    expect(entries.filter((e) => e.type === 'plot-thread').length).toBe(2)
    expect(entries.length).toBe(result.codexEntryCount)
  })

  it('is deterministic for a given seed (same structure and word count on repeat runs)', async () => {
    const rootA = mkdtempSync(join(tmpdir(), 'atlas-fixture-a-'))
    const rootB = mkdtempSync(join(tmpdir(), 'atlas-fixture-b-'))
    try {
      const dbA = await openIndexDb(rootA)
      const dbB = await openIndexDb(rootB)
      const opts = {
        bookCount: 1,
        partsPerBook: 1,
        chaptersPerPart: 2,
        scenesPerChapter: 2,
        wordsPerScene: 40,
        characterCount: 3,
        locationCount: 2,
        plotThreadCount: 1,
        seed: 7
      }
      const resultA = await generateLargeManuscriptFixture(rootA, dbA, opts)
      const resultB = await generateLargeManuscriptFixture(rootB, dbB, opts)
      expect(resultA.totalWordCount).toBe(resultB.totalWordCount)
      expect(resultA.sceneIds).toEqual(resultB.sceneIds)
    } finally {
      rmSync(rootA, { recursive: true, force: true })
      rmSync(rootB, { recursive: true, force: true })
    }
  })
})
