import { describe, expect, it } from 'vitest'
import { extractCodexCandidates } from './extractCodex'

describe('extractCodexCandidates', () => {
  it('finds repeated character names near dialogue attribution', () => {
    const candidates = extractCodexCandidates(`
      "We should leave," said Marlowe.
      Marlowe checked the door before Marlowe crossed the room.
      "Not yet," Marlowe said.
      They waited in Briar House and later returned to Briar House.
    `)

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'character', name: 'Marlowe' })
      ])
    )
  })

  it('excludes stopwords and one-off capitalized words', () => {
    const candidates = extractCodexCandidates(`
      The lantern failed once.
      Chapter Nine began in silence.
      Eleanor watched Eleanor wait while Eleanor listened.
    `)

    expect(candidates.some((candidate) => candidate.name === 'The')).toBe(false)
    expect(candidates.some((candidate) => candidate.name === 'Chapter')).toBe(false)
    expect(candidates.some((candidate) => candidate.name === 'Lantern')).toBe(false)
  })
})
