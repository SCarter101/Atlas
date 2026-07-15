import { describe, expect, it } from 'vitest'
import type { ManuscriptTree, SceneMeta } from './schema/manuscript'
import type { OutlineFramework } from './schema/outline'
import { TEMPLATE_BEATS, createFrameworkFromTemplate, getBeatStatus, getGenreExpectationFindings } from './outlineLogic'

function makeScene(overrides: Partial<SceneMeta> = {}): SceneMeta {
  return {
    schemaVersion: 2,
    id: 'scene-1',
    chapterId: 'chapter-1',
    order: 0,
    title: 'Untitled Scene',
    wordCount: 0,
    status: 'outline',
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

describe('createFrameworkFromTemplate', () => {
  it('builds sequential beats from the three-act template', () => {
    const framework = createFrameworkFromTemplate('three-act', 'My Three-Act Outline')
    expect(framework.schemaVersion).toBe(1)
    expect(framework.kind).toBe('three-act')
    expect(framework.beats).toHaveLength(TEMPLATE_BEATS['three-act'].length)
    expect(framework.beats.map((b) => b.order)).toEqual(framework.beats.map((_, i) => i))
    expect(framework.beats[0].label).toBe('Setup')
    expect(framework.beats.every((b) => b.id.length > 0)).toBe(true)
  })

  it('builds all 15 Save the Cat beats', () => {
    const framework = createFrameworkFromTemplate('save-the-cat', 'Cat Outline')
    expect(framework.beats).toHaveLength(15)
    expect(framework.beats[0].label).toBe('Opening Image')
    expect(framework.beats[14].label).toBe('Final Image')
  })

  it('tags mystery-clue-grid beats with their role', () => {
    const framework = createFrameworkFromTemplate('mystery-clue-grid', 'Whodunit')
    const roles = framework.beats.map((b) => b.role)
    expect(roles).toContain('clue')
    expect(roles).toContain('suspect')
    expect(roles).toContain('red-herring')
    expect(roles).toContain('reveal')
  })

  it('tags thriller-escalation beats with ordered escalation checkpoints', () => {
    const framework = createFrameworkFromTemplate('thriller-escalation', 'Countdown')
    expect(framework.beats.map((b) => b.role)).toEqual([
      'escalation-1',
      'escalation-2',
      'escalation-3',
      'escalation-4',
      'escalation-5',
      'escalation-6',
      'escalation-7',
      'escalation-8'
    ])
  })

  it('returns an empty beat list for custom', () => {
    const framework = createFrameworkFromTemplate('custom', 'My Custom Outline')
    expect(framework.beats).toEqual([])
  })
})

describe('getBeatStatus', () => {
  const tree = makeTree([
    { id: 'chapter-1', title: 'Chapter One', scenes: [makeScene({ id: 'scene-1', chapterId: 'chapter-1' })] },
    { id: 'chapter-2', title: 'Chapter Two', scenes: [makeScene({ id: 'scene-2', chapterId: 'chapter-2' })] },
    { id: 'chapter-3', title: 'Chapter Three', scenes: [makeScene({ id: 'scene-3', chapterId: 'chapter-3' })] }
  ])

  function makeFramework(beats: OutlineFramework['beats']): OutlineFramework {
    return { schemaVersion: 1, id: 'framework-1', kind: 'three-act', name: 'Test', beats }
  }

  it('marks a beat unmapped when it has no targetChapterId', () => {
    const framework = makeFramework([{ id: 'beat-1', label: 'Setup', description: '', order: 0 }])
    const statuses = getBeatStatus(framework, tree)
    expect(statuses).toEqual([{ beatId: 'beat-1', mapped: false, orderViolation: false }])
  })

  it('marks a beat mapped with no violation when chapters are assigned in order', () => {
    const framework = makeFramework([
      { id: 'beat-1', label: 'Setup', description: '', order: 0, targetChapterId: 'chapter-1' },
      { id: 'beat-2', label: 'Climax', description: '', order: 1, targetChapterId: 'chapter-3' }
    ])
    const statuses = getBeatStatus(framework, tree)
    expect(statuses).toEqual([
      { beatId: 'beat-1', mapped: true, orderViolation: false },
      { beatId: 'beat-2', mapped: true, orderViolation: false }
    ])
  })

  it('flags an order violation when a later beat maps to an earlier chapter', () => {
    const framework = makeFramework([
      { id: 'beat-1', label: 'Setup', description: '', order: 0, targetChapterId: 'chapter-3' },
      { id: 'beat-2', label: 'Climax', description: '', order: 1, targetChapterId: 'chapter-1' }
    ])
    const statuses = getBeatStatus(framework, tree)
    expect(statuses.find((s) => s.beatId === 'beat-1')).toEqual({ beatId: 'beat-1', mapped: true, orderViolation: false })
    expect(statuses.find((s) => s.beatId === 'beat-2')).toEqual({ beatId: 'beat-2', mapped: true, orderViolation: true })
  })

  it('returns statuses in the framework beats order, independent of the order field', () => {
    const framework = makeFramework([
      { id: 'beat-b', label: 'Second', description: '', order: 1, targetChapterId: 'chapter-2' },
      { id: 'beat-a', label: 'First', description: '', order: 0, targetChapterId: 'chapter-1' }
    ])
    const statuses = getBeatStatus(framework, tree)
    expect(statuses.map((s) => s.beatId)).toEqual(['beat-b', 'beat-a'])
  })
})

describe('getGenreExpectationFindings', () => {
  function draftedChapter(id: string): { id: string; title: string; scenes: SceneMeta[] } {
    return { id, title: id, scenes: [makeScene({ id: `${id}-scene`, chapterId: id, status: 'drafted', wordCount: 500 })] }
  }
  function outlineOnlyChapter(id: string): { id: string; title: string; scenes: SceneMeta[] } {
    return { id, title: id, scenes: [makeScene({ id: `${id}-scene`, chapterId: id, status: 'outline', wordCount: 0 })] }
  }

  function makeFramework(beats: OutlineFramework['beats']): OutlineFramework {
    return { schemaVersion: 1, id: 'framework-1', kind: 'three-act', name: 'Test', beats }
  }

  it('returns nothing for a framework with no beats', () => {
    const tree = makeTree([draftedChapter('chapter-1')])
    expect(getGenreExpectationFindings(makeFramework([]), tree)).toEqual([])
  })

  it('flags an unmapped early-order beat once the manuscript is mostly drafted', () => {
    // 4 chapters, 3 of 4 (75%) already drafted — above the 70% threshold.
    const tree = makeTree([
      draftedChapter('chapter-1'),
      draftedChapter('chapter-2'),
      draftedChapter('chapter-3'),
      outlineOnlyChapter('chapter-4')
    ])
    const framework = makeFramework([
      { id: 'beat-1', label: 'Inciting Incident', description: '', order: 0 },
      { id: 'beat-2', label: 'Climax', description: '', order: 3 }
    ])

    const findings = getGenreExpectationFindings(framework, tree)
    expect(findings.some((f) => f.beatId === 'beat-1')).toBe(true)
    expect(findings.find((f) => f.beatId === 'beat-1')?.severity).toBe('medium')
    // beat-2 sits in the framework's second half, so it's not flagged even
    // though it's also unmapped.
    expect(findings.some((f) => f.beatId === 'beat-2')).toBe(false)
  })

  it('does not flag an unmapped early beat when the manuscript has barely started', () => {
    const tree = makeTree([
      draftedChapter('chapter-1'),
      outlineOnlyChapter('chapter-2'),
      outlineOnlyChapter('chapter-3'),
      outlineOnlyChapter('chapter-4')
    ])
    const framework = makeFramework([{ id: 'beat-1', label: 'Inciting Incident', description: '', order: 0 }])
    expect(getGenreExpectationFindings(framework, tree)).toEqual([])
  })

  it('surfaces high severity once the manuscript is almost entirely drafted', () => {
    const chapters = Array.from({ length: 10 }, (_, i) => draftedChapter(`chapter-${i + 1}`))
    chapters[9] = outlineOnlyChapter('chapter-10') // 90% drafted
    const tree = makeTree(chapters)
    const framework = makeFramework([{ id: 'beat-1', label: 'Inciting Incident', description: '', order: 0 }])
    const findings = getGenreExpectationFindings(framework, tree)
    expect(findings.find((f) => f.beatId === 'beat-1')?.severity).toBe('high')
  })

  it('surfaces an orderViolation beat as its own finding', () => {
    const tree = makeTree([draftedChapter('chapter-1'), draftedChapter('chapter-2')])
    const framework = makeFramework([
      { id: 'beat-1', label: 'Setup', description: '', order: 0, targetChapterId: 'chapter-2' },
      { id: 'beat-2', label: 'Climax', description: '', order: 1, targetChapterId: 'chapter-1' }
    ])
    const findings = getGenreExpectationFindings(framework, tree)
    expect(findings.some((f) => f.beatId === 'beat-2' && f.severity === 'medium')).toBe(true)
  })
})
