import { describe, expect, it } from 'vitest'
import { detectContradictions } from '@shared/codexLogic'
import type { CodexEntry } from '@shared/schema/codex'
import { runSandboxed } from './sandbox'
import { codexContradictionCheckTool, wordCountTool } from './seedTools'

function entry(partial: Partial<CodexEntry> & Pick<CodexEntry, 'id' | 'name' | 'type'>): CodexEntry {
  const now = '2026-01-01T00:00:00.000Z'
  return {
    schemaVersion: 1,
    status: 'canon',
    body: {},
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

describe('wordCountTool', () => {
  it('counts words, treating whitespace-only text as zero', async () => {
    const { output } = await runSandboxed(wordCountTool, { text: 'Ray parked the Bronco.' })
    expect(output).toEqual({ wordCount: 4 })

    const empty = await runSandboxed(wordCountTool, { text: '   ' })
    expect(empty.output).toEqual({ wordCount: 0 })
  })
})

describe('codexContradictionCheckTool vs. detectContradictions', () => {
  it('produces the same result as the real shared/codexLogic implementation, sandboxed', async () => {
    const entries: CodexEntry[] = [
      entry({
        id: 'a',
        name: 'Ray',
        type: 'character',
        relationships: [{ id: 'r1', targetEntryId: 'b', kind: 'contradicts' }]
      }),
      entry({ id: 'b', name: 'Tull', type: 'character' }),
      entry({ id: 'c', name: 'Marisol', type: 'character', body: { eyeColor: 'brown' } }),
      entry({ id: 'd', name: 'marisol', type: 'character', body: { eyeColor: 'blue' } })
    ]

    const expected = [...detectContradictions(entries).entries()].sort(([a], [b]) => a.localeCompare(b))

    const { output, error } = await runSandboxed(codexContradictionCheckTool, { entries })
    expect(error).toBeUndefined()
    const { contradictions } = output as { contradictions: [string, string[]][] }
    const actual = [...contradictions].sort(([a], [b]) => a.localeCompare(b))

    expect(actual).toEqual(expected)
    expect(actual.length).toBeGreaterThan(0)
  })

  it('reports no contradictions for entries with nothing in common', async () => {
    const entries: CodexEntry[] = [
      entry({ id: 'a', name: 'Ray', type: 'character' }),
      entry({ id: 'b', name: 'The Delta', type: 'location' })
    ]

    const { output } = await runSandboxed(codexContradictionCheckTool, { entries })
    expect((output as { contradictions: unknown[] }).contradictions).toEqual([])
  })
})
