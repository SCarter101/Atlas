import { describe, expect, it } from 'vitest'
import type { CodexEntry } from '@shared/schema/codex'
import { renderCodex } from './renderCodex'

// Real round-trip coverage for Codex export fidelity. Unlike the manuscript
// path, there's no dedicated "import a Codex JSON export back into a
// project" feature today (import/extractCodex.ts only extracts *candidate*
// entries by scanning manuscript prose, not by reading a prior export) — so
// the meaningful round trip here is renderCodex(..., 'json')'s own
// documented contract: a full, lossless backup format (see
// renderCodex.test.ts's "renders full JSON backup including private
// entries") that a writer could hand-restore from. This proves that
// contract by feeding the real rendered output back through JSON.parse and
// asserting nothing was dropped, reordered, or corrupted — including the
// private entry the codex-md/series-bible formats intentionally exclude.

const now = '2026-01-01T00:00:00.000Z'

function entry(partial: Partial<CodexEntry> & Pick<CodexEntry, 'id' | 'type' | 'name'>): CodexEntry {
  return {
    schemaVersion: 1,
    status: 'canon',
    body: { summary: 'A useful fact.' },
    isPrivate: false,
    localModelOnly: false,
    locked: false,
    source: 'author',
    relationships: [{ id: 'rel-1', targetEntryId: 'other-entry', kind: 'ally', notes: 'Trusted since childhood.' }],
    manuscriptLinks: [{ sceneId: 'scene-1', excerpt: 'She entered the room.' }],
    createdAt: now,
    updatedAt: now,
    history: [
      { versionId: 'v1', changedAt: now, changedBy: 'author', diffSummary: 'Initial creation', snapshot: { name: 'placeholder' } }
    ],
    ...partial
  }
}

const entries: CodexEntry[] = [
  entry({ id: 'char-1', type: 'character', name: 'Mara', body: { summary: 'Detective with a secret.' } }),
  entry({ id: 'loc-1', type: 'location', name: 'Old Mill', body: { summary: 'A ruined mill outside town.' } }),
  entry({ id: 'private-1', type: 'research-note', name: 'Private Research', isPrivate: true, body: { summary: 'Not for readers.' } })
]

const manifest = { title: 'Test Book', genre: 'Mystery' }

describe('Codex JSON export -> re-import round trip', () => {
  it('round-trips manifest and entries exactly, including private entries, through JSON.stringify/parse', async () => {
    const rendered = await renderCodex(entries, manifest, 'json')
    expect(typeof rendered).toBe('string')

    const parsed = JSON.parse(rendered as string) as { manifest: typeof manifest; entries: CodexEntry[] }

    expect(parsed.manifest).toEqual(manifest)
    expect(parsed.entries).toHaveLength(entries.length)
    expect(parsed.entries).toEqual(entries)

    // Specifically confirm the private entry — excluded from the
    // human-readable codex-md/series-bible formats — survives in this
    // full-backup format, matching renderCodex.ts's documented contract.
    const privateEntry = parsed.entries.find((e) => e.id === 'private-1')
    expect(privateEntry?.isPrivate).toBe(true)
    expect(privateEntry?.name).toBe('Private Research')

    // Nested structures (relationships, manuscript links, version history)
    // survive intact, not just top-level scalar fields.
    const mara = parsed.entries.find((e) => e.id === 'char-1')
    expect(mara?.relationships).toEqual(entries[0].relationships)
    expect(mara?.manuscriptLinks).toEqual(entries[0].manuscriptLinks)
    expect(mara?.history).toEqual(entries[0].history)
  })

  it('round-trips an empty Codex without error', async () => {
    const rendered = await renderCodex([], manifest, 'json')
    const parsed = JSON.parse(rendered as string) as { manifest: typeof manifest; entries: CodexEntry[] }

    expect(parsed.manifest).toEqual(manifest)
    expect(parsed.entries).toEqual([])
  })
})
