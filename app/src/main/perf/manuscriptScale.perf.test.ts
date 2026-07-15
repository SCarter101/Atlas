import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { diffWords } from '@shared/diffText'
import { openIndexDb, upsertVectorIndex, withBatchedPersist, type AtlasDb } from '../persistence/db'
import { readManuscriptTree } from '../persistence/manuscriptStore'
import { readScene, writeScene } from '../persistence/sceneStore'
import { ensureIndexed, search } from '../retrieval/search'
import { getOrGenerateChapterSummary, getOrGenerateSceneSummary } from '../persistence/summaryStore'
import { getOrGenerateDerivedSummary } from '../persistence/derivedSummaryStore'
import { loadCodex, loadManuscript } from '../export/loadProjectData'
import { renderManuscript } from '../export/renderManuscript'
import { renderCodex } from '../export/renderCodex'
import { generateLargeManuscriptFixture, buildProse, type LargeManuscriptFixtureResult } from './largeManuscriptFixture'

// Round 10 / Phase 9 Track C: performance profiling at real manuscript
// scale (~120k words), using the from-scratch fixture built in
// largeManuscriptFixture.ts. Every `it` below prints its measured
// wall-clock time to the console (search for "[perf]") so a human can read
// the actual numbers this round measured, and also asserts a generous upper
// bound — generous specifically so this suite catches a real regression
// (e.g. an accidental revert of the persist-batching fix below going back
// to O(n^2)) without becoming flaky on a slower CI machine. These are not
// tight performance SLAs.
//
// Summary generation (summaryStore.ts / derivedSummaryStore.ts) always
// tries a real model call before its heuristic fallback — see
// modelSummaryFallback.ts. No real LM Studio/OpenRouter is running in this
// environment (or in CI), so that call would otherwise fail only after a
// real network-level timeout (the same kind of stall Track C's LM Studio
// fetchWithTimeout fix addresses elsewhere in this diff) — network latency
// that has nothing to do with the local file-I/O/hashing logic this file
// actually owns and is profiling. Mocking generateSummaryViaModel to
// resolve null immediately isolates exactly the part of summary generation
// this track can measure and fix, matching the realistic "no model
// configured" case every writer hits before they ever open Settings.
vi.mock('../persistence/modelSummaryFallback', () => ({
  generateSummaryViaModel: vi.fn().mockResolvedValue(null)
}))

const FIXTURE_TIMEOUT_MS = 120_000

function logTiming(label: string, ms: number): void {
  // eslint-disable-next-line no-console
  console.log(`[perf] ${label}: ${ms.toFixed(1)}ms`)
}

async function timeAsync<T>(label: string, fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = performance.now()
  const result = await fn()
  const ms = performance.now() - start
  logTiming(label, ms)
  return { result, ms }
}

describe('performance at ~120k-word manuscript scale', () => {
  let projectRoot: string
  let db: AtlasDb
  let fixture: LargeManuscriptFixtureResult

  beforeAll(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-perf-'))
    db = await openIndexDb(projectRoot)
    const { result, ms } = await timeAsync('fixture generation (full ~120k-word project, all writes)', () =>
      generateLargeManuscriptFixture(projectRoot, db)
    )
    fixture = result
    logTiming(
      `fixture shape: ${fixture.sceneCount} scenes / ${fixture.chapterCount} chapters / ${fixture.codexEntryCount} Codex entries / ${fixture.totalWordCount} words`,
      ms
    )
  }, FIXTURE_TIMEOUT_MS)

  afterAll(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  it('generated a real ~120k-word manuscript (sanity check on the fixture itself)', () => {
    expect(fixture.sceneCount).toBeGreaterThanOrEqual(150)
    expect(fixture.totalWordCount).toBeGreaterThan(100_000)
    expect(fixture.totalWordCount).toBeLessThan(140_000)
    expect(fixture.codexEntryCount).toBeGreaterThanOrEqual(30)
  })

  // --- Manuscript tree / scene-switch --------------------------------

  it('readManuscriptTree() walks the whole manuscript folder tree', async () => {
    const { ms } = await timeAsync('readManuscriptTree (full walk, ~200 scenes)', () => readManuscriptTree(projectRoot))
    // Generous: this is a real fs walk (readdir + JSON read per scene meta
    // file), not an in-memory op — 3s covers a slow disk without masking a
    // real regression (a correctly-parallelized walk of ~450 small JSON
    // files should be well under 1s on any dev machine).
    expect(ms).toBeLessThan(3000)
  })

  it('a single scene write (autosave) stays fast regardless of manuscript size', async () => {
    const sceneId = fixture.sceneIds[100]
    const { prose } = await readScene(projectRoot, db, sceneId)
    const newProse = `${prose}\n\nA new paragraph the writer just typed.`

    // writeScene() takes relativeDir/slug rather than resolving them itself
    // (findSceneLocation does that on the read side) — resolve them from
    // the tree once here, the same way any real caller (the SceneWrite IPC
    // handler) already has them on hand from the scene's own location.
    const tree = await readManuscriptTree(projectRoot)
    const chapter = tree.books
      .flatMap((b) => b.parts.flatMap((p) => p.chapters))
      .find((c) => c.scenes.some((s) => s.id === sceneId))!
    const book = tree.books.find((b) => b.parts.some((p) => p.chapters.includes(chapter)))!
    const part = book.parts.find((p) => p.chapters.includes(chapter))!
    const relativeDir = `${book.id}/${part.id}/${chapter.id}`
    const slug = sceneId.slice(chapter.id.length + 1)

    const { ms } = await timeAsync('single scene write (one autosave)', () =>
      writeScene(projectRoot, db, sceneId, { prose: newProse }, relativeDir, slug)
    )
    // A single scene write touches exactly that scene's two files plus one
    // SQLite index upsert+persist — should be near-instant and, critically,
    // must not degrade as the manuscript grows (it's O(scene size), not
    // O(manuscript size)). 500ms is generous for a single small write.
    expect(ms).toBeLessThan(500)
  })

  // --- Retrieval indexing ---------------------------------------------

  it('ensureIndexed() performs a full retrieval index pass over every Codex entry + scene', async () => {
    const { ms } = await timeAsync(
      `ensureIndexed (full pass, ${fixture.sceneCount} scenes + ${fixture.codexEntryCount} Codex entries, hashing embeddings)`,
      () => ensureIndexed(db, projectRoot)
    )
    // This is the exact operation the persist-batching fix in
    // persistence/db.ts targets — see that file's withBatchedPersist
    // comment. Pre-fix, this called db.persist() (a full db.export() +
    // writeFileSync of the whole growing SQLite index) once per item,
    // which went quadratic; post-fix it's one persist() for the whole
    // pass. 5s is a generous ceiling for ~250 real embedding+index writes.
    expect(ms).toBeLessThan(5000)
  }, 30_000)

  it('a second ensureIndexed() call on an already-indexed project is a near-instant no-op', async () => {
    const { ms } = await timeAsync('ensureIndexed (second call, already indexed)', () => ensureIndexed(db, projectRoot))
    expect(ms).toBeLessThan(500)
  })

  it('search() returns ranked results quickly once indexed', async () => {
    const { ms } = await timeAsync('search (single query against full index)', async () =>
      search(db, 'ledger crossing quiet', { limit: 10 })
    )
    expect(ms).toBeLessThan(500)
  })

  // --- Persist-batching micro-benchmark (isolates the specific fix) ----

  it('demonstrates the concrete cost of unbatched per-row persist() vs batched, in isolation', async () => {
    // A focused, reproducible before/after for the exact fix in
    // persistence/db.ts: N vector upserts each followed by their own
    // db.export()+writeFileSync, vs the same N upserts sharing one
    // persist() at the end. Run against a fresh, empty db (not the shared
    // fixture db above, which already has ~250 rows in it from the tests
    // above) so both halves start from the same baseline.
    const benchRoot = mkdtempSync(join(tmpdir(), 'atlas-perf-batch-bench-'))
    try {
      const benchDb = await openIndexDb(benchRoot)
      const n = 300
      const vector = new Float32Array(256).fill(0.5)

      const unbatchedStart = performance.now()
      for (let i = 0; i < n; i++) {
        upsertVectorIndex(benchDb, `unbatched-${i}`, 'scene', vector)
      }
      const unbatchedMs = performance.now() - unbatchedStart
      logTiming(`${n} unbatched upsertVectorIndex calls (persist() per row)`, unbatchedMs)

      const batchedStart = performance.now()
      await withBatchedPersist(benchDb, () => {
        for (let i = 0; i < n; i++) {
          upsertVectorIndex(benchDb, `batched-${i}`, 'scene', vector)
        }
      })
      const batchedMs = performance.now() - batchedStart
      logTiming(`${n} batched upsertVectorIndex calls (one persist() total)`, batchedMs)

      // The unbatched pass re-serializes an ever-larger DB on every one of
      // the n rows (the batched pass's own earlier rows are already in
      // benchDb by this point too, so this is a fair, slightly-conservative
      // comparison in the batched pass's favor... except the unbatched loop
      // runs first, so if anything this understates the real gap). Batched
      // should be at least several times faster; assert a conservative 2x
      // rather than the much larger factor actually observed, so this
      // doesn't flake on a fast machine where n=300 is cheap either way.
      expect(batchedMs).toBeLessThan(unbatchedMs / 2)
    } finally {
      rmSync(benchRoot, { recursive: true, force: true })
    }
  }, 30_000)

  // --- Summary generation ------------------------------------------------

  it('generates rolling scene summaries for every scene (heuristic fallback, model call mocked out)', async () => {
    const { ms } = await timeAsync(`getOrGenerateSceneSummary x${fixture.sceneCount}`, async () => {
      for (const sceneId of fixture.sceneIds) {
        const { prose } = await readScene(projectRoot, db, sceneId)
        await getOrGenerateSceneSummary(projectRoot, sceneId, prose)
      }
    })
    expect(ms).toBeLessThan(15_000)
  }, 30_000)

  it('generates chapter summaries for every chapter from its scene summaries', async () => {
    const tree = await readManuscriptTree(projectRoot)
    const chapters = tree.books.flatMap((b) => b.parts.flatMap((p) => p.chapters))
    const { ms } = await timeAsync(`getOrGenerateChapterSummary x${chapters.length}`, async () => {
      for (const chapter of chapters) {
        const sceneSummaries = await Promise.all(
          chapter.scenes.map(async (s) => {
            const { prose } = await readScene(projectRoot, db, s.id)
            return getOrGenerateSceneSummary(projectRoot, s.id, prose)
          })
        )
        await getOrGenerateChapterSummary(projectRoot, chapter.id, sceneSummaries)
      }
    })
    expect(ms).toBeLessThan(10_000)
  }, 30_000)

  it('generates project-level derived summaries (timeline, open-promises, world-state)', async () => {
    const { ms } = await timeAsync('getOrGenerateDerivedSummary x3 (project-level kinds)', async () => {
      await getOrGenerateDerivedSummary(projectRoot, 'timeline', 'project')
      await getOrGenerateDerivedSummary(projectRoot, 'open-promises', 'project')
      await getOrGenerateDerivedSummary(projectRoot, 'world-state', 'project')
    })
    expect(ms).toBeLessThan(10_000)
  }, 20_000)

  it('generates a character-arc derived summary for one character', async () => {
    const characterId = fixture.characterIds[0]
    const { ms } = await timeAsync('getOrGenerateDerivedSummary (character-arc, one character)', () =>
      getOrGenerateDerivedSummary(projectRoot, 'character-arc', characterId)
    )
    expect(ms).toBeLessThan(5000)
  })

  // --- Diffing -------------------------------------------------------

  it('diffWords() at realistic scene scale (a scene-sized revision)', () => {
    const a = buildProse(700, 1)
    const b = buildProse(720, 2)
    const start = performance.now()
    const runs = diffWords(a, b)
    const ms = performance.now() - start
    logTiming('diffWords (scene-scale, ~700 words each side)', ms)
    expect(runs.length).toBeGreaterThan(0)
    expect(ms).toBeLessThan(500)
  })

  it('diffWords() at manuscript scale — documents the O(n*m) risk this module\'s own header already calls out', () => {
    // diffText.ts is explicit that it's a plain O(n*m) LCS table "fine at
    // scene-length inputs... not built to scale past that." Every real
    // caller (revisionStore.ts's snapshot diff, DraftComparisonView.tsx's
    // draft compare) only ever diffs one scene's prose, never the whole
    // manuscript — confirmed by grepping every call site before writing
    // this suite. This test isn't guarding a real call path; it exists to
    // put a concrete number on the documented risk so it's a measurement,
    // not a guess, if a future feature is ever tempted to diff at this
    // scale (e.g. a hypothetical "compare whole-manuscript revisions").
    const a = buildProse(20_000, 3)
    const b = buildProse(20_500, 4)
    const start = performance.now()
    diffWords(a, b)
    const ms = performance.now() - start
    logTiming('diffWords (STRESS: manuscript-scale, ~20k words each side, no real caller does this)', ms)
    // Not asserting a tight bound here — the point of this test is the
    // logged number, not a pass/fail gate on an intentionally-out-of-spec
    // input. A very loose ceiling just catches a total hang.
    expect(ms).toBeLessThan(60_000)
  }, 60_000)

  // --- Export --------------------------------------------------------

  it('renders the full manuscript to every export format', async () => {
    const { result: manuscript, ms: loadMs } = await timeAsync('loadManuscript (full manuscript)', () =>
      loadManuscript(projectRoot, db)
    )
    expect(loadMs).toBeLessThan(5000)

    for (const format of ['md', 'txt', 'docx', 'pdf', 'epub'] as const) {
      const { ms } = await timeAsync(`renderManuscript (${format})`, () => renderManuscript(manuscript, format))
      expect(ms).toBeLessThan(20_000)
    }
  }, 90_000)

  it('renders the full Codex to every export format', async () => {
    const { result: codex, ms: loadMs } = await timeAsync('loadCodex (full Codex)', () => loadCodex(projectRoot))
    expect(loadMs).toBeLessThan(2000)

    for (const format of ['json', 'codex-md', 'series-bible'] as const) {
      const { ms } = await timeAsync(`renderCodex (${format})`, () => renderCodex(codex.entries, codex.manifest, format))
      expect(ms).toBeLessThan(10_000)
    }
  }, 30_000)
})
