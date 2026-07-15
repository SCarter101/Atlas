import { describe, expect, it } from 'vitest'
import type { CodexEntry } from './schema/codex'
import type { ManuscriptTree, SceneMeta } from './schema/manuscript'
import {
  checkInjuryContinuity,
  checkSeasonConsistency,
  checkStatedAgeConsistency,
  checkTimelineMonotonicity,
  checkTravelTime
} from './continuityChecks'

function makeScene(overrides: Partial<SceneMeta> = {}): SceneMeta {
  return {
    schemaVersion: 2,
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

function makeEntry(overrides: Partial<CodexEntry> & Pick<CodexEntry, 'id' | 'type' | 'name'>): CodexEntry {
  const now = new Date().toISOString()
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
    createdAt: now,
    updatedAt: now,
    history: [],
    ...overrides
  }
}

describe('checkTimelineMonotonicity', () => {
  it('flags a scene dated earlier than an earlier scene, when not a flashback', () => {
    const tree = makeTree([
      {
        id: 'chapter-1',
        title: 'Chapter One',
        scenes: [
          makeScene({ id: 'scene-1', title: 'Scene One', continuity: { storyDate: '2024-03-10' } }),
          makeScene({ id: 'scene-2', title: 'Scene Two', continuity: { storyDate: '2024-03-05' } })
        ]
      }
    ])

    const findings = checkTimelineMonotonicity([], tree)

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ kind: 'timeline', relatedSceneIds: ['scene-2'] })
  })

  it('does not flag an out-of-order scene explicitly marked as a flashback', () => {
    const tree = makeTree([
      {
        id: 'chapter-1',
        title: 'Chapter One',
        scenes: [
          makeScene({ id: 'scene-1', title: 'Scene One', continuity: { storyDate: '2024-03-10' } }),
          makeScene({
            id: 'scene-2',
            title: 'Scene Two',
            continuity: { storyDate: '2024-03-05', isFlashback: true }
          })
        ]
      }
    ])

    expect(checkTimelineMonotonicity([], tree)).toEqual([])
  })
})

describe('checkInjuryContinuity', () => {
  it('flags an injury healed in a scene that appears before the scene it occurred in', () => {
    const tree = makeTree([
      {
        id: 'chapter-1',
        title: 'Chapter One',
        scenes: [makeScene({ id: 'scene-1' }), makeScene({ id: 'scene-2' })]
      }
    ])
    const entries: CodexEntry[] = [
      makeEntry({
        id: 'char-1',
        type: 'character',
        name: 'Ray',
        continuityProfile: {
          injuries: [
            {
              id: 'injury-1',
              description: 'broken arm',
              occurredSceneId: 'scene-2',
              healedSceneId: 'scene-1'
            }
          ]
        }
      })
    ]

    const findings = checkInjuryContinuity(entries, tree)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ kind: 'injury', relatedCodexEntryIds: ['char-1'] })
  })

  it('flags a healedDate earlier than occurredDate', () => {
    const tree = makeTree([{ id: 'chapter-1', title: 'Chapter One', scenes: [makeScene()] }])
    const entries: CodexEntry[] = [
      makeEntry({
        id: 'char-1',
        type: 'character',
        name: 'Ray',
        continuityProfile: {
          injuries: [
            { id: 'injury-1', description: 'sprained ankle', occurredDate: '2024-05-01', healedDate: '2024-04-20' }
          ]
        }
      })
    ]
    expect(checkInjuryContinuity(entries, tree)).toHaveLength(1)
  })

  it('does not flag a well-ordered, correctly-dated injury', () => {
    const tree = makeTree([
      {
        id: 'chapter-1',
        title: 'Chapter One',
        scenes: [makeScene({ id: 'scene-1' }), makeScene({ id: 'scene-2' })]
      }
    ])
    const entries: CodexEntry[] = [
      makeEntry({
        id: 'char-1',
        type: 'character',
        name: 'Ray',
        continuityProfile: {
          injuries: [
            {
              id: 'injury-1',
              description: 'broken arm',
              occurredSceneId: 'scene-1',
              healedSceneId: 'scene-2',
              occurredDate: '2024-04-01',
              healedDate: '2024-05-01'
            }
          ]
        }
      })
    ]
    expect(checkInjuryContinuity(entries, tree)).toEqual([])
  })
})

describe('checkTravelTime', () => {
  const entries: CodexEntry[] = [
    makeEntry({ id: 'char-1', type: 'character', name: 'Ray' }),
    makeEntry({ id: 'loc-a', type: 'location', name: 'Rivermouth', travelLinks: [{ locationId: 'loc-b', days: 5 }] }),
    makeEntry({ id: 'loc-b', type: 'location', name: 'Highkeep' })
  ]

  it('flags a gap shorter than the recorded travel time', () => {
    const tree = makeTree([
      {
        id: 'chapter-1',
        title: 'Chapter One',
        scenes: [
          makeScene({
            id: 'scene-1',
            povCharacterId: 'char-1',
            locationId: 'loc-a',
            continuity: { storyDate: '2024-06-01' }
          }),
          makeScene({
            id: 'scene-2',
            povCharacterId: 'char-1',
            locationId: 'loc-b',
            continuity: { storyDate: '2024-06-02' }
          })
        ]
      }
    ])

    const findings = checkTravelTime(entries, tree)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ kind: 'travel', relatedSceneIds: ['scene-1', 'scene-2'] })
  })

  it('does not flag a gap that is long enough for the recorded travel time', () => {
    const tree = makeTree([
      {
        id: 'chapter-1',
        title: 'Chapter One',
        scenes: [
          makeScene({
            id: 'scene-1',
            povCharacterId: 'char-1',
            locationId: 'loc-a',
            continuity: { storyDate: '2024-06-01' }
          }),
          makeScene({
            id: 'scene-2',
            povCharacterId: 'char-1',
            locationId: 'loc-b',
            continuity: { storyDate: '2024-06-10' }
          })
        ]
      }
    ])

    expect(checkTravelTime(entries, tree)).toEqual([])
  })
})

describe('checkSeasonConsistency', () => {
  it('flags a storyDate/season mismatch', () => {
    const tree = makeTree([
      {
        id: 'chapter-1',
        title: 'Chapter One',
        scenes: [makeScene({ id: 'scene-1', continuity: { storyDate: '2024-07-15', season: 'winter' } })]
      }
    ])
    const findings = checkSeasonConsistency(tree)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ kind: 'season', relatedSceneIds: ['scene-1'] })
  })

  it('does not flag a matching storyDate/season pair', () => {
    const tree = makeTree([
      {
        id: 'chapter-1',
        title: 'Chapter One',
        scenes: [makeScene({ id: 'scene-1', continuity: { storyDate: '2024-07-15', season: 'summer' } })]
      }
    ])
    expect(checkSeasonConsistency(tree)).toEqual([])
  })
})

describe('checkStatedAgeConsistency', () => {
  it('flags a scene continuityNotes age mention that disagrees with birthDate by more than a year', () => {
    const tree = makeTree([
      {
        id: 'chapter-1',
        title: 'Chapter One',
        scenes: [
          makeScene({
            id: 'scene-1',
            povCharacterId: 'char-1',
            continuity: { storyDate: '2024-01-01', continuityNotes: 'Ray, 40 years old, still limps.' }
          })
        ]
      }
    ])
    const entries: CodexEntry[] = [
      makeEntry({ id: 'char-1', type: 'character', name: 'Ray', continuityProfile: { birthDate: '1994-01-01' } })
    ]

    const findings = checkStatedAgeConsistency(entries, tree)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ kind: 'age', relatedCodexEntryIds: ['char-1'] })
  })

  it('does not flag when the stated age matches the birth date within a year', () => {
    const tree = makeTree([
      {
        id: 'chapter-1',
        title: 'Chapter One',
        scenes: [
          makeScene({
            id: 'scene-1',
            povCharacterId: 'char-1',
            continuity: { storyDate: '2024-01-01', continuityNotes: 'Ray, 30 years old, still limps.' }
          })
        ]
      }
    ])
    const entries: CodexEntry[] = [
      makeEntry({ id: 'char-1', type: 'character', name: 'Ray', continuityProfile: { birthDate: '1994-01-01' } })
    ]

    expect(checkStatedAgeConsistency(entries, tree)).toEqual([])
  })
})
