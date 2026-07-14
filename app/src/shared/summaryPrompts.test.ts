import { describe, expect, it } from 'vitest'
import {
  buildCharacterArcSummaryPrompt,
  buildChapterSummaryPrompt,
  buildOpenPromisesSummaryPrompt,
  buildPayoffStatusSummaryPrompt,
  buildSceneSummaryPrompt,
  buildTimelineSummaryPrompt,
  buildWorldStateSummaryPrompt
} from './summaryPrompts'

// Pure prompt builders — no fs/model dependency, so these are cheap to
// verify directly: every kind must produce a non-empty, distinct pair, and
// buildCharacterArcSummaryPrompt must actually fold its argument in (it's
// the one builder that takes subject-identifying data, per the brief).
describe('summaryPrompts', () => {
  const builders = [
    ['scene', () => buildSceneSummaryPrompt()],
    ['chapter', () => buildChapterSummaryPrompt()],
    ['character-arc', () => buildCharacterArcSummaryPrompt('Dale')],
    ['timeline', () => buildTimelineSummaryPrompt()],
    ['world-state', () => buildWorldStateSummaryPrompt()],
    ['open-promises', () => buildOpenPromisesSummaryPrompt()],
    ['payoff-status', () => buildPayoffStatusSummaryPrompt()]
  ] as const

  it.each(builders)('%s builder returns a non-empty systemPrompt and userIntent', (_label, build) => {
    const pair = build()
    expect(pair.systemPrompt.trim().length).toBeGreaterThan(0)
    expect(pair.userIntent.trim().length).toBeGreaterThan(0)
  })

  it('produces distinct userIntent text per kind (no accidental copy-paste)', () => {
    const intents = builders.map(([, build]) => build().userIntent)
    expect(new Set(intents).size).toBe(intents.length)
  })

  it('produces distinct systemPrompt text per kind', () => {
    const prompts = builders.map(([, build]) => build().systemPrompt)
    expect(new Set(prompts).size).toBe(prompts.length)
  })

  it('folds the character name into the character-arc prompt', () => {
    const pair = buildCharacterArcSummaryPrompt('Dale Whitfield')
    expect(pair.userIntent).toContain('Dale Whitfield')
  })
})
