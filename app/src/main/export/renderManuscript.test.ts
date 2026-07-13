import { describe, expect, it } from 'vitest'
import type { LoadedManuscript } from './loadProjectData'
import { renderManuscript } from './renderManuscript'

const manuscript: LoadedManuscript = {
  title: 'Test Book',
  genre: 'Mystery',
  chapters: [
    {
      title: 'Chapter One',
      scenes: [
        {
          title: 'Opening',
          markdown: 'This is **bold** and *quiet*.\n\n[Door](https://example.com) opens.'
        }
      ]
    },
    {
      title: 'Chapter Two',
      scenes: [
        {
          title: 'Turn',
          markdown: 'A second scene.'
        }
      ]
    }
  ]
}

describe('renderManuscript', () => {
  it('renders Markdown with chapter headings and separators', async () => {
    const rendered = await renderManuscript(manuscript, 'md')
    expect(rendered).toContain('# Chapter One')
    expect(rendered).toContain('This is **bold**')
    expect(rendered).toContain('---')
  })

  it('renders plain text without basic Markdown syntax', async () => {
    const rendered = await renderManuscript(manuscript, 'txt')
    expect(rendered).toContain('Chapter One')
    expect(rendered).toContain('This is bold and quiet.')
    expect(rendered).toContain('Door opens.')
    expect(rendered).not.toContain('**bold**')
  })

  it('renders PDF bytes', async () => {
    const rendered = await renderManuscript(manuscript, 'pdf')
    expect(Buffer.isBuffer(rendered)).toBe(true)
    expect((rendered as Buffer).subarray(0, 4).toString()).toBe('%PDF')
  })

  it('renders DOCX zip bytes', async () => {
    const rendered = await renderManuscript(manuscript, 'docx')
    expect(Buffer.isBuffer(rendered)).toBe(true)
    expect((rendered as Buffer).subarray(0, 2).toString()).toBe('PK')
  })

  it('renders EPUB zip bytes', async () => {
    const rendered = await renderManuscript(manuscript, 'epub')
    expect(Buffer.isBuffer(rendered)).toBe(true)
    expect((rendered as Buffer).subarray(0, 2).toString()).toBe('PK')
  })
})
