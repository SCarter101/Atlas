import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanupTestDir } from '../testUtils'
import { createProjectFromFoundations, slugify } from './createProjectFromFoundations'
import { listCodexEntries } from './codexStore'
import { openIndexDb, type AtlasDb } from './db'
import { openProject } from './projectStore'

describe('slugify', () => {
  it('lowercases, hyphenates, and strips punctuation', () => {
    expect(slugify('The Levee Road!')).toBe('the-levee-road')
  })

  it('falls back to a placeholder for an empty/whitespace title', () => {
    expect(slugify('   ')).toBe('untitled-project')
  })
})

describe('createProjectFromFoundations', () => {
  let projectRoot: string
  let db: AtlasDb

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-foundations-test-'))
    db = await openIndexDb(projectRoot)
  })

  afterEach(() => {
    cleanupTestDir(projectRoot)
  })

  it('creates a real project manifest and writes each answered entry to the Codex', async () => {
    const manifest = await createProjectFromFoundations(projectRoot, db, 'The Levee Road', 'Mystery', [
      { type: 'character', name: 'Protagonist', summary: 'A retired ranger with one last case.', status: 'canon' },
      { type: 'world-rule', name: 'World Rule', summary: 'No phones work past the levee.', status: 'tentative' }
    ])

    expect(manifest.title).toBe('The Levee Road')
    expect(manifest.genrePrimary).toBe('Mystery')

    const reopened = await openProject(projectRoot)
    expect(reopened.id).toBe(manifest.id)

    const entries = await listCodexEntries(projectRoot)
    expect(entries).toHaveLength(2)
    expect(entries.every((e) => e.source === 'author')).toBe(true)
    expect(entries.find((e) => e.type === 'character')?.body.summary).toBe('A retired ranger with one last case.')
  })

  it('creates a valid project with no Codex entries when everything was skipped', async () => {
    const manifest = await createProjectFromFoundations(projectRoot, db, 'Untitled Draft', undefined, [])
    expect(manifest.title).toBe('Untitled Draft')
    expect(await listCodexEntries(projectRoot)).toHaveLength(0)
  })
})
