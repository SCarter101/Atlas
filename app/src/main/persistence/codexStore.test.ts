import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CodexEntry } from '@shared/schema/codex'
import type { ManuscriptTree } from '@shared/schema/manuscript'
import { openIndexDb, type AtlasDb } from './db'
import {
  detectContradictions,
  filterBySpoilerReveal,
  getManuscriptReadingOrder,
  upsertCodexEntry
} from './codexStore'

function makeEntry(overrides: Partial<CodexEntry> = {}): CodexEntry {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    id: 'entry-1',
    type: 'character',
    name: 'Ray',
    status: 'canon',
    body: {},
    isPrivate: false,
    localModelOnly: false,
    locked: false,
    source: 'author',
    relationships: [],
    manuscriptLinks: [],
    createdAt: now,
    updatedAt: now,
    history: [],
    ...overrides
  }
}

describe('upsertCodexEntry — history append', () => {
  let projectRoot: string
  let db: AtlasDb

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-codex-test-'))
    db = await openIndexDb(projectRoot)
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  it('does not append a history entry on first create', async () => {
    const entry = makeEntry({ body: { age: '34' } })
    await upsertCodexEntry(projectRoot, db, entry)

    expect(entry.history).toHaveLength(0)
  })

  it('appends a CodexVersion describing the change on a subsequent upsert', async () => {
    const created = makeEntry({ status: 'canon', body: { age: '34' } })
    await upsertCodexEntry(projectRoot, db, created)

    const edited = makeEntry({
      status: 'tentative',
      body: { age: '35' },
      updatedAt: new Date().toISOString(),
      history: created.history
    })
    await upsertCodexEntry(projectRoot, db, edited)

    expect(edited.history).toHaveLength(1)
    const version = edited.history[0]
    expect(version.changedBy).toBe('author')
    expect(version.diffSummary).toContain('status: canon → tentative')
    expect(version.diffSummary).toContain('body.age changed')
    expect(version.snapshot).toEqual({ name: 'Ray', status: 'canon', body: { age: '34' } })
  })

  it('accumulates history across multiple edits', async () => {
    const v1 = makeEntry({ body: { age: '34' } })
    await upsertCodexEntry(projectRoot, db, v1)

    const v2 = makeEntry({ body: { age: '35' }, history: v1.history, updatedAt: new Date().toISOString() })
    await upsertCodexEntry(projectRoot, db, v2)

    const v3 = makeEntry({ body: { age: '36' }, history: v2.history, updatedAt: new Date().toISOString() })
    await upsertCodexEntry(projectRoot, db, v3)

    expect(v3.history).toHaveLength(2)
  })
})

describe('detectContradictions', () => {
  it('flags both entries on an explicit relationships[].kind === "contradicts" edge', () => {
    const a = makeEntry({ id: 'a', name: 'Ray', relationships: [{ id: 'r1', targetEntryId: 'b', kind: 'contradicts' }] })
    const b = makeEntry({ id: 'b', name: 'Raymond' })

    const result = detectContradictions([a, b])

    expect(result.get('a')?.[0]).toContain('Raymond')
    expect(result.get('b')?.[0]).toContain('Ray')
  })

  it('flags two same-type entries with the same name but conflicting body values', () => {
    const a = makeEntry({ id: 'a', name: 'Tull', type: 'character', body: { eyeColor: 'blue' } })
    const b = makeEntry({ id: 'b', name: 'tull', type: 'character', body: { eyeColor: 'brown' } })

    const result = detectContradictions([a, b])

    expect(result.get('a')?.[0]).toContain('eyeColor')
    expect(result.get('b')?.[0]).toContain('eyeColor')
  })

  it('does not flag entries with no conflict', () => {
    const a = makeEntry({ id: 'a', name: 'Tull', type: 'character', body: { eyeColor: 'blue' } })
    const b = makeEntry({ id: 'b', name: 'Ray', type: 'character', body: { eyeColor: 'brown' } })
    const c = makeEntry({ id: 'c', name: 'Tull', type: 'location', body: { eyeColor: 'brown' } })

    const result = detectContradictions([a, b, c])

    expect(result.size).toBe(0)
  })

  it('does not flag same-name entries when the conflicting body value is empty on one side', () => {
    const a = makeEntry({ id: 'a', name: 'Tull', type: 'character', body: { eyeColor: 'blue' } })
    const b = makeEntry({ id: 'b', name: 'tull', type: 'character', body: { eyeColor: '' } })

    const result = detectContradictions([a, b])

    expect(result.size).toBe(0)
  })
})

describe('getManuscriptReadingOrder + filterBySpoilerReveal', () => {
  const tree: ManuscriptTree = {
    books: [
      {
        id: 'book-1',
        projectId: 'proj-1',
        title: 'Book One',
        order: 0,
        parts: [
          {
            id: 'part-1',
            bookId: 'book-1',
            title: 'Part One',
            order: 0,
            chapters: [
              {
                id: 'chapter-1',
                partId: 'part-1',
                title: 'Chapter One',
                order: 0,
                sceneIds: ['scene-1', 'scene-2'],
                scenes: [
                  {
                    schemaVersion: 1,
                    id: 'scene-1',
                    chapterId: 'chapter-1',
                    order: 0,
                    title: 'Scene One',
                    wordCount: 100,
                    status: 'drafted',
                    updatedAt: new Date().toISOString()
                  },
                  {
                    schemaVersion: 1,
                    id: 'scene-2',
                    chapterId: 'chapter-1',
                    order: 1,
                    title: 'Scene Two',
                    wordCount: 100,
                    status: 'drafted',
                    updatedAt: new Date().toISOString()
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }

  it('assigns ascending ordinals in book/part/chapter/scene order', () => {
    const order = getManuscriptReadingOrder(tree)
    expect(order.get('scene-1')).toBe(0)
    expect(order.get('scene-2')).toBe(1)
  })

  it('includes entries when asOfSceneId is undefined (fail open)', () => {
    const order = getManuscriptReadingOrder(tree)
    const entry = makeEntry({ spoilerRevealSceneId: 'scene-2' })
    expect(filterBySpoilerReveal([entry], undefined, order)).toEqual([entry])
  })

  it('includes entries with no spoilerRevealSceneId', () => {
    const order = getManuscriptReadingOrder(tree)
    const entry = makeEntry({})
    expect(filterBySpoilerReveal([entry], 'scene-1', order)).toEqual([entry])
  })

  it('includes entries when either scene id is missing from readingOrder (fail open)', () => {
    const order = getManuscriptReadingOrder(tree)
    const entry = makeEntry({ spoilerRevealSceneId: 'scene-unknown' })
    expect(filterBySpoilerReveal([entry], 'scene-1', order)).toEqual([entry])
    expect(filterBySpoilerReveal([makeEntry({ spoilerRevealSceneId: 'scene-1' })], 'scene-unknown', order)).toHaveLength(1)
  })

  it('excludes entries whose reveal scene is strictly after asOfSceneId', () => {
    const order = getManuscriptReadingOrder(tree)
    const entry = makeEntry({ spoilerRevealSceneId: 'scene-2' })
    expect(filterBySpoilerReveal([entry], 'scene-1', order)).toEqual([])
  })

  it('includes entries whose reveal scene is at or before asOfSceneId', () => {
    const order = getManuscriptReadingOrder(tree)
    const entry = makeEntry({ spoilerRevealSceneId: 'scene-1' })
    expect(filterBySpoilerReveal([entry], 'scene-2', order)).toEqual([entry])
    expect(filterBySpoilerReveal([entry], 'scene-1', order)).toEqual([entry])
  })
})
