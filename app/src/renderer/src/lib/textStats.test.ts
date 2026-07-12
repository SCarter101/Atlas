import { describe, expect, it } from 'vitest'
import { countWords } from './textStats'

describe('countWords', () => {
  it('counts space-separated words', () => {
    expect(countWords('Ray parked the Bronco.')).toBe(4)
  })

  it('returns 0 for empty or whitespace-only prose', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   \n\t  ')).toBe(0)
  })

  it('collapses runs of whitespace, including newlines, between words', () => {
    expect(countWords('Ray parked.\n\nHe sat there   a minute.')).toBe(7)
  })

  it('trims leading and trailing whitespace before counting', () => {
    expect(countWords('  one two three  ')).toBe(3)
  })
})
