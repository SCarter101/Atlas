import { describe, expect, it } from 'vitest'
import { CRAFT_CONCEPTS, getCraftConcept } from './craftReference'

const EXPECTED_IDS = ['hooks', 'scene-turns', 'causality', 'stakes', 'setup-and-payoff', 'point-of-view', 'pacing']

describe('CRAFT_CONCEPTS', () => {
  it('covers every concept named in the Phase 4 spec', () => {
    for (const id of EXPECTED_IDS) {
      expect(CRAFT_CONCEPTS[id]).toBeDefined()
    }
  })

  it('keys every entry by its own id', () => {
    for (const [key, concept] of Object.entries(CRAFT_CONCEPTS)) {
      expect(concept.id).toBe(key)
    }
  })

  it('gives every concept a non-empty label and a concise (1-4 sentence) explainer', () => {
    for (const concept of Object.values(CRAFT_CONCEPTS)) {
      expect(concept.label.length).toBeGreaterThan(0)
      const sentenceCount = (concept.explainer.match(/[.!?]+(\s|$)/g) ?? []).length
      expect(sentenceCount).toBeGreaterThanOrEqual(1)
      expect(sentenceCount).toBeLessThanOrEqual(4)
      // "Concise... not turning the interface into a writing course" — a
      // rough length guard against anything that reads like a lesson.
      expect(concept.explainer.length).toBeLessThan(600)
    }
  })
})

describe('getCraftConcept', () => {
  it('returns the matching concept for a known id', () => {
    expect(getCraftConcept('pacing')?.label).toBe('Pacing')
  })

  it('returns undefined for an unknown id', () => {
    expect(getCraftConcept('not-a-real-concept')).toBeUndefined()
  })
})
