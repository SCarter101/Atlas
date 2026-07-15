import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deriveChapterStatus } from '@shared/deriveChapterStatus'
import { cleanupTestDir } from '../testUtils'
import { listCapabilityManifests } from './capabilityStore'
import { openIndexDb, type AtlasDb } from './db'
import { readManuscriptTree } from './manuscriptStore'
import { openProject } from './projectStore'
import { seedCottonmouthProject } from './seedSampleProject'

describe('seedCottonmouthProject', () => {
  let projectRoot: string
  let db: AtlasDb

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-seed-test-'))
    db = await openIndexDb(projectRoot)
  })

  afterEach(() => {
    cleanupTestDir(projectRoot)
  })

  it('seeds a project manifest with the writer display name', async () => {
    await seedCottonmouthProject(projectRoot, db)
    const manifest = await openProject(projectRoot)
    expect(manifest.title).toBe('Cottonmouth')
    expect(manifest.writerDisplayName).toBe('Sam')
  })

  it('matches the Phase 1 prototype outline: 5 chapters with the right derived statuses', async () => {
    await seedCottonmouthProject(projectRoot, db)
    const tree = await readManuscriptTree(projectRoot)
    const chapters = tree.books.flatMap((b) => b.parts.flatMap((p) => p.chapters))

    expect(chapters.map((c) => c.title)).toEqual([
      'Chapter One — Homecoming',
      'Chapter Two — Blood Kin',
      'Chapter Three — The Fish House',
      'Chapter Four — The Levee Road',
      'Chapter Five — Low Water'
    ])

    const statuses = chapters.map((c) => deriveChapterStatus(c.scenes))
    expect(statuses).toEqual(['drafted', 'drafted', 'in-progress', 'not-started', 'not-started'])
  })

  it('seeds two pending ai-proposed Codex entries awaiting approval', async () => {
    await seedCottonmouthProject(projectRoot, db)
    const codexDir = join(projectRoot, 'codex')
    const worldRule = JSON.parse(readFileSync(join(codexDir, 'world-rules', 'catfishboom.json'), 'utf-8'))
    const researchNote = JSON.parse(readFileSync(join(codexDir, 'research', 'icehouselogistics.json'), 'utf-8'))

    for (const entry of [worldRule, researchNote]) {
      expect(entry.source).toBe('ai-proposed')
      expect(entry.approvedAt).toBeUndefined()
    }
  })

  it('gives every scene a project-wide unique id, even across chapters that reuse local slugs', async () => {
    await seedCottonmouthProject(projectRoot, db)
    const tree = await readManuscriptTree(projectRoot)
    const allSceneIds = tree.books.flatMap((b) => b.parts.flatMap((p) => p.chapters.flatMap((c) => c.scenes.map((s) => s.id))))

    expect(new Set(allSceneIds).size).toBe(allSceneIds.length)
  })

  it('seeds four ordered timeline-item Codex entries for the Story Timeline view', async () => {
    await seedCottonmouthProject(projectRoot, db)
    const codexDir = join(projectRoot, 'codex')
    const files = ['father-duvall-plant', 'daletimeline', 'ray-returns-bellhaven', 'ch3-fishhouse-confrontation']
    const entries = files.map((f) => JSON.parse(readFileSync(join(codexDir, 'timeline', `${f}.json`), 'utf-8')))
    const sorted = [...entries].sort((a, b) => a.body.order - b.body.order)

    expect(sorted.map((e) => e.name)).toEqual([
      "Ray & Dale's father works the Duvall plant",
      'Dale Chambliss found dead',
      'Ray returns to Bellhaven',
      'Ch.3 — The Fish House confrontation'
    ])
    for (const e of entries) {
      expect(typeof e.body.date).toBe('string')
      expect(typeof e.body.order).toBe('number')
    }
  })

  it('seeds a read-only sample capability library spanning global and project scope', async () => {
    await seedCottonmouthProject(projectRoot, db)
    const manifests = await listCapabilityManifests(projectRoot)

    expect(manifests.length).toBe(5)
    expect(manifests.some((m) => m.scope === 'global' && m.type === 'tool')).toBe(true)
    expect(manifests.some((m) => m.scope === 'global' && m.type === 'skill')).toBe(true)
    expect(manifests.some((m) => m.scope === 'project')).toBe(true)
    for (const m of manifests) {
      expect(m.validationStatus).toBe('passed')
      expect(m.lifecycleState).toBe('enabled')
    }
  })

  it('gives Chapter Three Scene Two the prototype’s real sample prose', async () => {
    await seedCottonmouthProject(projectRoot, db)
    const tree = await readManuscriptTree(projectRoot)
    const chapterThree = tree.books
      .flatMap((b) => b.parts.flatMap((p) => p.chapters))
      .find((c) => c.id === 'chapter-003')

    expect(chapterThree?.scenes.map((s) => s.title)).toEqual(['Scene 1 — Cold Storage', 'Scene 2 — The Fish House'])
  })
})
