import { describe, expect, it } from 'vitest'
import {
  WORLD_BUILDER_GENRE_TEMPLATES,
  WORLD_BUILDER_INTERVIEW_TOPICS,
  decodeWorldBuilderInterview,
  emptyWorldBuilderInterviewAnswers,
  encodeWorldBuilderInterview,
  genreTemplateLabel
} from './worldBuilderInterview'

describe('World Builder interview — genre templates & topics', () => {
  it('lists all 8 templates from spec §7.5, ending with custom', () => {
    expect(WORLD_BUILDER_GENRE_TEMPLATES).toHaveLength(8)
    expect(WORLD_BUILDER_GENRE_TEMPLATES.at(-1)?.id).toBe('custom')
  })

  it('lists all 6 minimum interview topics', () => {
    expect(WORLD_BUILDER_INTERVIEW_TOPICS).toHaveLength(6)
    expect(new Set(WORLD_BUILDER_INTERVIEW_TOPICS.map((t) => t.key)).size).toBe(6)
  })

  it('genreTemplateLabel resolves known ids and falls back for unknown input', () => {
    expect(genreTemplateLabel('fantasy-kingdom')).toBe('Fantasy kingdom')
    expect(genreTemplateLabel('custom')).toBe('Custom')
    // @ts-expect-error — exercising the runtime fallback with an invalid id
    expect(genreTemplateLabel('not-a-real-template')).toBe('World')
  })
})

describe('World Builder interview — encode/decode round trip', () => {
  it('round-trips a fully-answered interview', () => {
    const answers = {
      ...emptyWorldBuilderInterviewAnswers(),
      genreTemplate: 'crime-city' as const,
      worldGrounding: 'A port city run by three rival families.',
      sensoryDetail: 'Diesel, rain on concrete, sodium streetlight orange.',
      characterImpact: 'Everyone owes someone.',
      plotPressure: 'A shipment deadline nobody can move.',
      consistencyFacts: 'The docks close at midnight, always.',
      flexibleRules: 'Which family controls the docks is still undecided.'
    }
    const encoded = encodeWorldBuilderInterview(answers)
    expect(decodeWorldBuilderInterview(encoded)).toEqual(answers)
  })

  it('round-trips an interview with blank topic answers', () => {
    const answers = emptyWorldBuilderInterviewAnswers()
    expect(decodeWorldBuilderInterview(encodeWorldBuilderInterview(answers))).toEqual(answers)
  })

  it('returns null for an ordinary manuscript selection', () => {
    expect(decodeWorldBuilderInterview('Ray watched the door for a long moment.')).toBeNull()
  })

  it('returns null for an empty selection', () => {
    expect(decodeWorldBuilderInterview('')).toBeNull()
  })

  it('returns null for a marker-prefixed but malformed payload instead of throwing', () => {
    expect(() => decodeWorldBuilderInterview('@@atlas-world-builder-interview-v1@@not json')).not.toThrow()
    expect(decodeWorldBuilderInterview('@@atlas-world-builder-interview-v1@@not json')).toBeNull()
  })

  it('returns null when the encoded genre template id is not a recognized template', () => {
    const bad = `@@atlas-world-builder-interview-v1@@${JSON.stringify({ ...emptyWorldBuilderInterviewAnswers(), genreTemplate: 'made-up' })}`
    expect(decodeWorldBuilderInterview(bad)).toBeNull()
  })

  it('returns null when a required topic field is missing', () => {
    const partial = emptyWorldBuilderInterviewAnswers() as unknown as Record<string, unknown>
    delete partial.sensoryDetail
    const bad = `@@atlas-world-builder-interview-v1@@${JSON.stringify(partial)}`
    expect(decodeWorldBuilderInterview(bad)).toBeNull()
  })
})
