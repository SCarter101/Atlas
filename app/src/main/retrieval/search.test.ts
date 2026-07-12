import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openIndexDb, upsertVectorIndex, type AtlasDb } from '../persistence/db'
import { indexText, search } from './search'
import { cosineSimilarity, vectorize } from './vectorize'

describe('vectorize', () => {
  it('is deterministic for the same input', () => {
    const a = vectorize('The riverboat drifted past the old fish house.')
    const b = vectorize('The riverboat drifted past the old fish house.')
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('L2-normalizes non-empty input', () => {
    const v = vectorize('catfish catfish levee dale ray bellhaven')
    let magnitude = 0
    for (const x of v) magnitude += x * x
    expect(Math.sqrt(magnitude)).toBeCloseTo(1, 5)
  })

  it('returns the zero vector unchanged for input with no tokens', () => {
    const v = vectorize('   ')
    expect(Array.from(v)).toEqual(new Array(v.length).fill(0))
  })
})

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    const v = vectorize('the levee road at dusk')
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5)
  })

  it('is higher for texts sharing more tokens than for unrelated texts', () => {
    const a = vectorize('Ray Chambliss walked the levee road at dawn')
    const b = vectorize('Ray Chambliss returned to the levee road again')
    const c = vectorize('The icehouse logistics contract expired in March')

    expect(cosineSimilarity(a, b)).toBeGreaterThan(cosineSimilarity(a, c))
  })

  it('is 0 when either vector has zero magnitude', () => {
    const zero = new Float32Array(256)
    const v = vectorize('some text')
    expect(cosineSimilarity(zero, v)).toBe(0)
    expect(cosineSimilarity(v, zero)).toBe(0)
  })
})

describe('vector BLOB round trip through a real sql.js index db', () => {
  let projectRoot: string
  let db: AtlasDb

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-retrieval-test-'))
    db = await openIndexDb(projectRoot)
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  it('preserves exact vector bytes across an upsert + search round trip', () => {
    const vector = vectorize('a distinctive, hopefully-unique fingerprint of tokens')
    upsertVectorIndex(db, 'entry-1', 'codex-entry', vector)

    const [result] = search(db, 'a distinctive, hopefully-unique fingerprint of tokens', { limit: 1 })
    expect(result.id).toBe('entry-1')
    expect(result.kind).toBe('codex-entry')
    expect(result.score).toBeCloseTo(1, 5)
  })

  it('ranks indexed entries by similarity to the query, most similar first', () => {
    indexText(db, 'scene-1', 'scene', 'Ray walked the levee road at dawn, thinking of Dale')
    indexText(db, 'scene-2', 'scene', 'The icehouse contract expired and nobody noticed for weeks')
    indexText(db, 'entry-dale', 'codex-entry', 'Dale Chambliss, Ray\'s brother, found dead near the levee')

    const results = search(db, 'Ray Dale levee road', { limit: 3 })
    expect(results.length).toBe(3)
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score)
    expect(results[1].score).toBeGreaterThanOrEqual(results[2].score)
    expect(['scene-1', 'entry-dale']).toContain(results[0].id)
  })

  it('filters by kind when requested', () => {
    indexText(db, 'scene-1', 'scene', 'The fish house smelled of brine and diesel')
    indexText(db, 'entry-1', 'codex-entry', 'The fish house is a location on the levee')

    const results = search(db, 'fish house', { kind: 'codex-entry' })
    expect(results.every((r) => r.kind === 'codex-entry')).toBe(true)
    expect(results.some((r) => r.id === 'entry-1')).toBe(true)
  })

  it('upserting the same id again replaces rather than duplicates its vector', () => {
    indexText(db, 'scene-1', 'scene', 'first version of the prose')
    indexText(db, 'scene-1', 'scene', 'completely different second version about catfish')

    const results = search(db, 'catfish', { limit: 10 })
    const matches = results.filter((r) => r.id === 'scene-1')
    expect(matches.length).toBe(1)
  })
})
