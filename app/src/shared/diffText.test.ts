import { describe, expect, it } from 'vitest'
import { diffWords } from './diffText'

// The full behavioral coverage of this algorithm lives in
// persistence/revisionStore.test.ts (which exercises it indirectly via
// diffSnapshots). This file just confirms the extracted shared module works
// standalone, since it's now imported directly by the renderer
// (DraftComparisonView.tsx) with no main-process indirection.
describe('diffWords', () => {
  it('marks identical text as entirely equal', () => {
    const runs = diffWords('A calm and quiet morning.', 'A calm and quiet morning.')
    expect(runs.every((r) => r.type === 'equal')).toBe(true)
  })

  it('detects an add-only difference between two drafts', () => {
    const runs = diffWords('She opened the door.', 'She slowly opened the heavy door.')
    const adds = runs.filter((r) => r.type === 'add').map((r) => r.text).join(' ')
    expect(adds).toContain('slowly')
    expect(adds).toContain('heavy')
  })

  it('treats two empty strings as producing no runs', () => {
    expect(diffWords('', '')).toEqual([])
  })
})
