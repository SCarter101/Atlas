import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getOrGenerateChapterSummary, getOrGenerateSceneSummary } from './summaryStore'

describe('getOrGenerateSceneSummary', () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-summary-test-'))
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  it('generates a summary on first call', async () => {
    const summary = await getOrGenerateSceneSummary(
      projectRoot,
      'scene-1',
      'Ray walked the levee road at dawn. He thought about Dale. The water was low.'
    )
    expect(summary.sceneId).toBe('scene-1')
    expect(summary.summary.length).toBeGreaterThan(0)
    expect(summary.summary).toContain('Ray walked the levee road at dawn')
  })

  it('does not regenerate when the source prose is unchanged', async () => {
    const prose = 'Ray walked the levee road at dawn. He thought about Dale.'
    const first = await getOrGenerateSceneSummary(projectRoot, 'scene-1', prose)
    const second = await getOrGenerateSceneSummary(projectRoot, 'scene-1', prose)

    expect(second).toEqual(first)
  })

  it('regenerates when the source prose changes', async () => {
    const first = await getOrGenerateSceneSummary(projectRoot, 'scene-1', 'Original prose about the levee road.')
    const second = await getOrGenerateSceneSummary(projectRoot, 'scene-1', 'Completely rewritten prose about catfish.')

    expect(second.sourceUpdatedAt).not.toBe(first.sourceUpdatedAt)
    expect(second.summary).toContain('catfish')
  })
})

describe('getOrGenerateChapterSummary', () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-summary-test-'))
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  it('generates a summary on first call from its scene summaries', async () => {
    const s1 = await getOrGenerateSceneSummary(projectRoot, 'scene-1', 'The fish house was cold and quiet.')
    const s2 = await getOrGenerateSceneSummary(projectRoot, 'scene-2', 'Ray confronted his brother by the water.')

    const chapter = await getOrGenerateChapterSummary(projectRoot, 'chapter-1', [s1, s2])
    expect(chapter.chapterId).toBe('chapter-1')
    expect(chapter.summary.length).toBeGreaterThan(0)
  })

  it('does not regenerate when its scene summaries are unchanged', async () => {
    const s1 = await getOrGenerateSceneSummary(projectRoot, 'scene-1', 'The fish house was cold and quiet.')
    const first = await getOrGenerateChapterSummary(projectRoot, 'chapter-1', [s1])
    const second = await getOrGenerateChapterSummary(projectRoot, 'chapter-1', [s1])

    expect(second).toEqual(first)
  })

  it('regenerates when a scene summary changes', async () => {
    const s1 = await getOrGenerateSceneSummary(projectRoot, 'scene-1', 'The fish house was cold and quiet.')
    const first = await getOrGenerateChapterSummary(projectRoot, 'chapter-1', [s1])

    const s1Updated = await getOrGenerateSceneSummary(projectRoot, 'scene-1', 'The fish house burned down overnight.')
    const second = await getOrGenerateChapterSummary(projectRoot, 'chapter-1', [s1Updated])

    expect(second.sourceUpdatedAt).not.toBe(first.sourceUpdatedAt)
    expect(second.summary).toContain('burned down')
  })
})
