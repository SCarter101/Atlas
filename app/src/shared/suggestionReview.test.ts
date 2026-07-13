import { describe, expect, it } from 'vitest'
import {
  groupSuggestionsByKind,
  isReviewable,
  nextReviewIndex,
  orderSuggestionsForReview,
  prevReviewIndex
} from './suggestionReview'
import type { SuggestionRef } from './schema/agent'

function makeSuggestion(overrides: Partial<SuggestionRef> & Pick<SuggestionRef, 'id' | 'kind'>): SuggestionRef {
  return {
    agentRole: 'Line-Editor',
    payload: {},
    provenance: { runId: 'run-1' },
    state: 'pending',
    ...overrides
  }
}

describe('groupSuggestionsByKind', () => {
  it('groups suggestions by kind in the canonical display order, omitting empty kinds', () => {
    const suggestions = [
      makeSuggestion({ id: 'a', kind: 'codex-addition' }),
      makeSuggestion({ id: 'b', kind: 'editorial-finding' }),
      makeSuggestion({ id: 'c', kind: 'editorial-finding' }),
      makeSuggestion({ id: 'd', kind: 'insertion' })
    ]

    const groups = groupSuggestionsByKind(suggestions)

    expect(groups.map((g) => g.kind)).toEqual(['editorial-finding', 'insertion', 'codex-addition'])
    expect(groups[0].items.map((s) => s.id)).toEqual(['b', 'c'])
  })

  it('returns an empty array for an empty input', () => {
    expect(groupSuggestionsByKind([])).toEqual([])
  })

  it('includes metadata-proposal and capability-recommendation last, after codex-addition', () => {
    const suggestions = [
      makeSuggestion({ id: 'a', kind: 'capability-recommendation' }),
      makeSuggestion({ id: 'b', kind: 'metadata-proposal' }),
      makeSuggestion({ id: 'c', kind: 'codex-addition' })
    ]
    expect(groupSuggestionsByKind(suggestions).map((g) => g.kind)).toEqual([
      'codex-addition',
      'metadata-proposal',
      'capability-recommendation'
    ])
  })
})

describe('orderSuggestionsForReview', () => {
  it('flattens groups into the same top-to-bottom order used for rendering', () => {
    const suggestions = [
      makeSuggestion({ id: 'a', kind: 'insertion' }),
      makeSuggestion({ id: 'b', kind: 'editorial-finding' }),
      makeSuggestion({ id: 'c', kind: 'tracked-change' })
    ]

    expect(orderSuggestionsForReview(suggestions).map((s) => s.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('isReviewable', () => {
  it('treats pending and refining as reviewable', () => {
    expect(isReviewable(makeSuggestion({ id: 'a', kind: 'insertion', state: 'pending' }))).toBe(true)
    expect(isReviewable(makeSuggestion({ id: 'a', kind: 'insertion', state: 'refining' }))).toBe(true)
  })

  it('treats accepted, rejected, and fixed as not reviewable', () => {
    expect(isReviewable(makeSuggestion({ id: 'a', kind: 'insertion', state: 'accepted' }))).toBe(false)
    expect(isReviewable(makeSuggestion({ id: 'a', kind: 'insertion', state: 'rejected' }))).toBe(false)
    expect(isReviewable(makeSuggestion({ id: 'a', kind: 'editorial-finding', state: 'fixed' }))).toBe(false)
  })
})

describe('nextReviewIndex', () => {
  it('starts at the first item when nothing is focused', () => {
    expect(nextReviewIndex(-1, 3)).toBe(0)
  })

  it('advances by one', () => {
    expect(nextReviewIndex(0, 3)).toBe(1)
  })

  it('wraps from the last item back to the first', () => {
    expect(nextReviewIndex(2, 3)).toBe(0)
  })

  it('returns -1 for an empty list', () => {
    expect(nextReviewIndex(-1, 0)).toBe(-1)
  })

  it('recovers to the first item when current is out of range (e.g. stale after list shrank)', () => {
    expect(nextReviewIndex(9, 3)).toBe(0)
  })
})

describe('prevReviewIndex', () => {
  it('starts at the last item when nothing is focused', () => {
    expect(prevReviewIndex(-1, 3)).toBe(2)
  })

  it('moves back by one', () => {
    expect(prevReviewIndex(2, 3)).toBe(1)
  })

  it('wraps from the first item back to the last', () => {
    expect(prevReviewIndex(0, 3)).toBe(2)
  })

  it('returns -1 for an empty list', () => {
    expect(prevReviewIndex(-1, 0)).toBe(-1)
  })

  it('recovers to the last item when current is out of range', () => {
    expect(prevReviewIndex(9, 3)).toBe(2)
  })
})
