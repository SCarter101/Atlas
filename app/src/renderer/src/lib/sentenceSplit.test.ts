import { describe, expect, it } from 'vitest'
import { splitIntoSentences } from './sentenceSplit'

describe('splitIntoSentences', () => {
  it('splits on sentence-ending punctuation followed by whitespace', () => {
    expect(splitIntoSentences('Ray parked the Bronco. He sat there a minute. The roof shimmered.')).toEqual([
      'Ray parked the Bronco.',
      'He sat there a minute.',
      'The roof shimmered.'
    ])
  })

  it('handles ! and ? terminators', () => {
    expect(splitIntoSentences('Wait! Is that Dale? It has to be.')).toEqual(['Wait!', 'Is that Dale?', 'It has to be.'])
  })

  it('splits across paragraph breaks', () => {
    expect(splitIntoSentences('First paragraph sentence.\n\nSecond paragraph sentence.')).toEqual([
      'First paragraph sentence.',
      'Second paragraph sentence.'
    ])
  })

  it('drops empty segments and trims whitespace', () => {
    expect(splitIntoSentences('  One sentence.   \n\n  \n\n  Another.  ')).toEqual(['One sentence.', 'Another.'])
  })

  it('returns an empty array for blank prose', () => {
    expect(splitIntoSentences('')).toEqual([])
    expect(splitIntoSentences('   ')).toEqual([])
  })

  it('treats prose with no terminal punctuation as one sentence', () => {
    expect(splitIntoSentences('a fragment with no ending punctuation')).toEqual(['a fragment with no ending punctuation'])
  })
})
