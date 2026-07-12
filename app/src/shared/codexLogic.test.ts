import { describe, expect, it } from 'vitest'
import type { ManuscriptTree, SceneMeta } from './schema/manuscript'
import { getCharacterPresenceMap, getConflictCurve, getPlotThreadSceneLinks } from './codexLogic'

function makeScene(overrides: Partial<SceneMeta> = {}): SceneMeta {
  return {
    schemaVersion: 1,
    id: 'scene-1',
    chapterId: 'chapter-1',
    order: 0,
    title: 'Untitled Scene',
    wordCount: 0,
    status: 'drafting',
    updatedAt: new Date().toISOString(),
    ...overrides
  }
}

function makeTree(chapters: { id: string; title: string; scenes: SceneMeta[] }[]): ManuscriptTree {
  return {
    books: [
      {
        id: 'book-1',
        projectId: 'project-1',
        title: 'Book One',
        order: 0,
        parts: [
          {
            id: 'part-1',
            bookId: 'book-1',
            title: 'Part One',
            order: 0,
            chapters: chapters.map((c) => ({
              id: c.id,
              partId: 'part-1',
              title: c.title,
              order: 0,
              sceneIds: c.scenes.map((s) => s.id),
              scenes: c.scenes
            }))
          }
        ]
      }
    ]
  }
}

describe('getPlotThreadSceneLinks', () => {
  it('inverts scene setupIds/payoffIds into thread id -> linked scenes', () => {
    const tree = makeTree([
      {
        id: 'chapter-1',
        title: 'Chapter One',
        scenes: [
          makeScene({ id: 'scene-1', title: 'Scene One', continuity: { setupIds: ['thread-a'] } }),
          makeScene({ id: 'scene-2', title: 'Scene Two', continuity: { payoffIds: ['thread-a'], setupIds: ['thread-b'] } })
        ]
      }
    ])

    const links = getPlotThreadSceneLinks(tree)

    expect(links.get('thread-a')).toEqual({ setupSceneIds: ['scene-1'], payoffSceneIds: ['scene-2'] })
    expect(links.get('thread-b')).toEqual({ setupSceneIds: ['scene-2'], payoffSceneIds: [] })
    expect(links.get('thread-nonexistent')).toBeUndefined()
  })

  it('returns an empty map when no scene references any thread', () => {
    const tree = makeTree([{ id: 'chapter-1', title: 'Chapter One', scenes: [makeScene()] }])
    expect(getPlotThreadSceneLinks(tree).size).toBe(0)
  })
})

describe('getConflictCurve', () => {
  it('includes only scenes with an explicit conflictLevel, in reading order', () => {
    const tree = makeTree([
      {
        id: 'chapter-1',
        title: 'Chapter One',
        scenes: [
          makeScene({ id: 'scene-1', title: 'Scene One', craft: { conflictLevel: 2 } }),
          makeScene({ id: 'scene-2', title: 'Scene Two' }), // unset — must be skipped, not defaulted to 0
          makeScene({ id: 'scene-3', title: 'Scene Three', craft: { conflictLevel: 4 } })
        ]
      }
    ])

    const curve = getConflictCurve(tree)

    expect(curve).toHaveLength(2)
    expect(curve.map((p) => p.sceneId)).toEqual(['scene-1', 'scene-3'])
    expect(curve[0]).toMatchObject({ sceneId: 'scene-1', conflictLevel: 2, ordinal: 0 })
    expect(curve[1]).toMatchObject({ sceneId: 'scene-3', conflictLevel: 4, ordinal: 2 })
  })

  it('returns an empty array when no scene has a conflictLevel set', () => {
    const tree = makeTree([{ id: 'chapter-1', title: 'Chapter One', scenes: [makeScene()] }])
    expect(getConflictCurve(tree)).toEqual([])
  })
})

describe('getCharacterPresenceMap', () => {
  it('marks a chapter present if any scene has the character as POV or in presentCharacterIds', () => {
    const tree = makeTree([
      {
        id: 'chapter-1',
        title: 'Chapter One',
        scenes: [makeScene({ id: 'scene-1', povCharacterId: 'char-ray' })]
      },
      {
        id: 'chapter-2',
        title: 'Chapter Two',
        scenes: [makeScene({ id: 'scene-2', presentCharacterIds: ['char-ray', 'char-tull'] })]
      },
      {
        id: 'chapter-3',
        title: 'Chapter Three',
        scenes: [makeScene({ id: 'scene-3' })]
      }
    ])

    const rows = getCharacterPresenceMap(tree, [
      { id: 'char-ray', name: 'Ray' },
      { id: 'char-tull', name: 'Tull' }
    ])

    const ray = rows.find((r) => r.characterId === 'char-ray')!
    expect(ray.presentByChapter.get('chapter-1')).toBe(true)
    expect(ray.presentByChapter.get('chapter-2')).toBe(true)
    expect(ray.presentByChapter.get('chapter-3')).toBe(false)

    const tull = rows.find((r) => r.characterId === 'char-tull')!
    expect(tull.presentByChapter.get('chapter-1')).toBe(false)
    expect(tull.presentByChapter.get('chapter-2')).toBe(true)
  })

  it('returns a row for every character even with no scenes', () => {
    const tree = makeTree([])
    const rows = getCharacterPresenceMap(tree, [{ id: 'char-ray', name: 'Ray' }])
    expect(rows).toHaveLength(1)
    expect(rows[0].presentByChapter.size).toBe(0)
  })
})
