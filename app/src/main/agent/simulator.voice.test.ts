import { describe, expect, it } from 'vitest'
import type { CharacterVoiceProfile } from '@shared/schema/codex'
import { buildTensionAlternatives, detectSimilarVoices } from './simulator'

describe('buildTensionAlternatives', () => {
  it('always returns exactly one option per tension tier', () => {
    const options = buildTensionAlternatives("I can't do this anymore.")
    expect(options.map((o) => o.tier)).toEqual(['calm', 'guarded', 'confrontational'])
  })

  it('falls back to profile-agnostic phrasing when no voice profile is given', () => {
    const options = buildTensionAlternatives("I can't do this anymore.")
    for (const option of options) {
      expect(option.text.length).toBeGreaterThan(0)
    }
  })

  it('softens the confrontational tier for a formal, non-direct character', () => {
    const profile: CharacterVoiceProfile = { formalityLevel: 'formal', speechDirectness: 'indirect' }
    const options = buildTensionAlternatives('Get out.', profile)
    const confrontational = options.find((o) => o.tier === 'confrontational')!
    expect(confrontational.text).not.toContain('Full stop.')
  })

  it('sharpens the confrontational tier for a direct or casual character', () => {
    const profile: CharacterVoiceProfile = { speechDirectness: 'direct' }
    const options = buildTensionAlternatives('Get out.', profile)
    const confrontational = options.find((o) => o.tier === 'confrontational')!
    expect(confrontational.text).toContain('Full stop.')
  })

  it('hedges the calm tier for an indirect character', () => {
    const profile: CharacterVoiceProfile = { speechDirectness: 'indirect' }
    const options = buildTensionAlternatives('Get out.', profile)
    const calm = options.find((o) => o.tier === 'calm')!
    expect(calm.text.startsWith('I wonder if')).toBe(true)
  })

  it('falls back to a placeholder line when the selection is empty', () => {
    const options = buildTensionAlternatives('   ')
    expect(options.every((o) => o.text.length > 0)).toBe(true)
  })
})

describe('detectSimilarVoices', () => {
  function profile(overrides: Partial<CharacterVoiceProfile> = {}): CharacterVoiceProfile {
    return {
      vocabulary: 'plain, working-class',
      rhythm: 'short clipped sentences',
      formalityLevel: 'casual',
      speechDirectness: 'direct',
      ...overrides
    }
  }

  it('flags a pair whose profiles match on 3 or more fields', () => {
    const characters = [
      { id: 'a', name: 'Ray', voiceProfile: profile() },
      { id: 'b', name: 'Tull', voiceProfile: profile() }
    ]
    const pairs = detectSimilarVoices(characters)
    expect(pairs).toHaveLength(1)
    expect(pairs[0].matchedFields.length).toBeGreaterThanOrEqual(3)
    expect([pairs[0].aName, pairs[0].bName].sort()).toEqual(['Ray', 'Tull'])
  })

  it('does not flag a pair with fewer than 3 matching fields', () => {
    const characters = [
      { id: 'a', name: 'Ray', voiceProfile: profile() },
      { id: 'b', name: 'Elena', voiceProfile: profile({ vocabulary: 'ornate, literary', rhythm: 'long winding clauses', formalityLevel: 'formal' }) }
    ]
    const pairs = detectSimilarVoices(characters)
    expect(pairs).toHaveLength(0)
  })

  it('counts an array-field overlap (e.g. shared verbal tics) as a single matched field', () => {
    const characters = [
      { id: 'a', name: 'Ray', voiceProfile: { verbalTics: ['you know', 'listen'], formalityLevel: 'casual' as const } },
      { id: 'b', name: 'Tull', voiceProfile: { verbalTics: ['listen', 'anyway'], formalityLevel: 'casual' as const } }
    ]
    const pairs = detectSimilarVoices(characters, 2)
    expect(pairs).toHaveLength(1)
    expect(pairs[0].matchedFields).toContain('verbalTics')
    expect(pairs[0].matchedFields).toContain('formalityLevel')
  })

  it('returns no pairs when fewer than two characters have a profile', () => {
    const pairs = detectSimilarVoices([{ id: 'a', name: 'Ray', voiceProfile: profile() }])
    expect(pairs).toEqual([])
  })
})
