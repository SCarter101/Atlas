import { describe, expect, it } from 'vitest'
import { parseManuscript } from './parseManuscript'

describe('parseManuscript', () => {
  it('splits chapter headings and scene breaks', () => {
    const parsed = parseManuscript(
      `# The River Book

## Chapter One

Marlowe waited by the river.

***

The boat came in after midnight.

## Chapter Two

Ada locked the store.`,
      'fallback'
    )

    expect(parsed.title).toBe('The River Book')
    expect(parsed.chapters).toHaveLength(2)
    expect(parsed.chapters[0].title).toBe('Chapter One')
    expect(parsed.chapters[0].scenes).toHaveLength(2)
    expect(parsed.chapters[0].scenes[0].title).toBe('Scene 1')
    expect(parsed.chapters[1].title).toBe('Chapter Two')
    expect(parsed.chapters[1].scenes).toHaveLength(1)
  })

  it('uses a single fallback chapter when no chapter headings exist', () => {
    const parsed = parseManuscript(
      `Marlowe crossed the bridge.

***

He did not look back.`,
      'Bridge Draft'
    )

    expect(parsed.title).toBe('Bridge Draft')
    expect(parsed.chapters).toHaveLength(1)
    expect(parsed.chapters[0].title).toBe('Bridge Draft')
    expect(parsed.chapters[0].scenes).toHaveLength(2)
  })
})
