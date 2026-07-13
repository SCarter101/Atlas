import { describe, expect, it } from 'vitest'
import type { CodexEntry } from '@shared/schema/codex'
import { renderCodex } from './renderCodex'

const now = '2026-01-01T00:00:00.000Z'

function entry(partial: Partial<CodexEntry> & Pick<CodexEntry, 'id' | 'type' | 'name'>): CodexEntry {
  return {
    schemaVersion: 1,
    status: 'canon',
    body: { summary: 'A useful public fact.' },
    isPrivate: false,
    localModelOnly: false,
    locked: false,
    source: 'author',
    relationships: [],
    manuscriptLinks: [],
    createdAt: now,
    updatedAt: now,
    history: [],
    ...partial
  }
}

const entries: CodexEntry[] = [
  entry({ id: 'char-1', type: 'character', name: 'Mara', body: { summary: 'Detective with a secret.' } }),
  entry({ id: 'loc-1', type: 'location', name: 'Old Mill', body: { summary: 'A ruined mill.' } }),
  entry({ id: 'private-1', type: 'research-note', name: 'Private Research', isPrivate: true }),
  entry({ id: 'note-1', type: 'private-author-note', name: 'Ending Twist', body: { summary: 'Do not reveal.' } })
]

const manifest = { title: 'Test Book', genre: 'Mystery' }

describe('renderCodex', () => {
  it('renders full JSON backup including private entries', async () => {
    const rendered = await renderCodex(entries, manifest, 'json')
    expect(rendered).toContain('Mara')
    expect(rendered).toContain('Private Research')
    expect(rendered).toContain('Ending Twist')
  })

  it('renders readable Codex Markdown and excludes private entries', async () => {
    const rendered = await renderCodex(entries, manifest, 'codex-md')
    expect(rendered).toContain('# Test Book Codex')
    expect(rendered).toContain('### Mara')
    expect(rendered).toContain('Detective with a secret.')
    expect(rendered).not.toContain('Private Research')
    expect(rendered).not.toContain('Ending Twist')
  })

  it('renders a summarized series bible and excludes private entries', async () => {
    const rendered = await renderCodex(entries, manifest, 'series-bible')
    expect(rendered).toContain('# Test Book Series Bible')
    expect(rendered).toContain('- **Mara**')
    expect(rendered).not.toContain('Private Research')
    expect(rendered).not.toContain('Ending Twist')
  })

  it('renders series bible PDF bytes', async () => {
    const rendered = await renderCodex(entries, manifest, 'series-bible-pdf')
    expect(Buffer.isBuffer(rendered)).toBe(true)
    expect((rendered as Buffer).subarray(0, 4).toString()).toBe('%PDF')
  })

  it('renders series bible EPUB zip bytes', async () => {
    const rendered = await renderCodex(entries, manifest, 'series-bible-epub')
    expect(Buffer.isBuffer(rendered)).toBe(true)
    expect((rendered as Buffer).subarray(0, 2).toString()).toBe('PK')
  })
})
