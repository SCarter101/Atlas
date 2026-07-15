import { mkdtempSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LoadedManuscript } from '../export/loadProjectData'
import { loadManuscript } from '../export/loadProjectData'
import { renderManuscript } from '../export/renderManuscript'
import { openIndexDb, type AtlasDb } from '../persistence/db'
import { writeBookMeta, writeChapterMeta, writePartMeta } from '../persistence/manuscriptStore'
import { createProject } from '../persistence/projectStore'
import { writeScene } from '../persistence/sceneStore'
import { cleanupTestDir } from '../testUtils'
import { readSourceFile } from './readSourceFile'
import { parseManuscript } from './parseManuscript'

// Real round-trip coverage for the export -> import path Track D (data
// safety) is responsible for: a manuscript is rendered to Markdown by the
// real main/export/renderManuscript.ts, written to a real file on disk,
// read back by the real main/import/readSourceFile.ts + parseManuscript.ts,
// then persisted into a real .atlas project (via the same
// projectStore/manuscriptStore/sceneStore calls
// main/import/importManuscript.ts itself uses — that orchestration function
// isn't called directly here since it depends on Electron's
// app.getPath('documents') and the global ProjectSession singleton, neither
// of which is available outside a running Electron main process) and read
// back out through main/export/loadProjectData.ts's loadManuscript(), the
// same function export:manuscript's IPC handler uses. No mocking anywhere
// in this file — every step is the real function operating on a real
// tmpdir project.

const fixture: LoadedManuscript = {
  title: 'The Levee Road',
  genre: 'Literary Fiction',
  chapters: [
    {
      title: 'Dawn',
      scenes: [{ title: 'Scene 1', markdown: 'Ray walked the levee road at dawn.\n\nThe water was low.' }]
    },
    {
      title: 'Dusk',
      scenes: [{ title: 'Scene 1', markdown: 'Elena waited by the boathouse until dusk fell.' }]
    }
  ]
}

async function persistParsedManuscript(
  projectRoot: string,
  db: AtlasDb,
  parsed: ReturnType<typeof parseManuscript>
): Promise<void> {
  await createProject(projectRoot, { title: parsed.title })
  const bookId = 'book-01'
  const partId = 'part-01'
  await writeBookMeta(projectRoot, { id: bookId, projectId: '', title: 'Book One', order: 0 })
  await writePartMeta(projectRoot, bookId, { id: partId, bookId, title: 'Part One', order: 0 })

  for (const [chapterIndex, chapter] of parsed.chapters.entries()) {
    const chapterId = `chapter-${String(chapterIndex + 1).padStart(3, '0')}`
    const sceneIds = chapter.scenes.map((_, sceneIndex) => `${chapterId}-scene-${String(sceneIndex + 1).padStart(3, '0')}`)
    await writeChapterMeta(projectRoot, bookId, partId, {
      id: chapterId,
      partId,
      title: chapter.title,
      order: chapterIndex,
      sceneIds
    })

    const relativeDir = `${bookId}/${partId}/${chapterId}`
    for (const [sceneIndex, scene] of chapter.scenes.entries()) {
      const sceneSlug = `scene-${String(sceneIndex + 1).padStart(3, '0')}`
      await writeScene(
        projectRoot,
        db,
        `${chapterId}-${sceneSlug}`,
        { meta: { id: `${chapterId}-${sceneSlug}`, chapterId, order: sceneIndex, title: scene.title }, prose: scene.prose },
        relativeDir,
        sceneSlug
      )
    }
  }
}

describe('manuscript export -> import round trip', () => {
  let sourceDir: string
  let projectRoot: string
  let db: AtlasDb

  beforeEach(async () => {
    sourceDir = mkdtempSync(join(tmpdir(), 'atlas-export-source-'))
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-import-target-'))
    db = await openIndexDb(projectRoot)
  })

  afterEach(() => {
    cleanupTestDir(sourceDir)
    cleanupTestDir(projectRoot)
  })

  it('preserves title, chapter titles, and scene prose through export -> file -> parse', async () => {
    const rendered = await renderManuscript(fixture, 'md')
    expect(typeof rendered).toBe('string')

    const filePath = join(sourceDir, 'the-levee-road.md')
    await writeFile(filePath, rendered as string, 'utf-8')

    const { text, baseName } = await readSourceFile(filePath)
    const parsed = parseManuscript(text, baseName)

    // The document title round-trips through the real H1 line
    // renderManuscript.ts now emits — not through the fallback filename.
    expect(parsed.title).toBe(fixture.title)
    expect(parsed.chapters).toHaveLength(fixture.chapters.length)
    expect(parsed.chapters[0].title).toBe('Dawn')
    expect(parsed.chapters[1].title).toBe('Dusk')
    // Chapter One's prose must survive — this is exactly the content-loss
    // regression documented in renderManuscript.ts's renderMarkdown comment.
    expect(parsed.chapters[0].scenes[0].prose).toContain('Ray walked the levee road at dawn.')
    expect(parsed.chapters[0].scenes[0].prose).toContain('The water was low.')
    expect(parsed.chapters[1].scenes[0].prose).toContain('Elena waited by the boathouse until dusk fell.')
  })

  it('survives a full export -> file -> parse -> persist -> reload cycle into a real project', async () => {
    const rendered = (await renderManuscript(fixture, 'md')) as string
    const filePath = join(sourceDir, 'the-levee-road.md')
    await writeFile(filePath, rendered, 'utf-8')

    const { text, baseName } = await readSourceFile(filePath)
    const parsed = parseManuscript(text, baseName)

    await persistParsedManuscript(projectRoot, db, parsed)

    const reloaded = await loadManuscript(projectRoot, db)

    expect(reloaded.title).toBe(fixture.title)
    expect(reloaded.chapters).toHaveLength(2)
    expect(reloaded.chapters[0].title).toBe('Dawn')
    expect(reloaded.chapters[0].scenes[0].markdown).toContain('Ray walked the levee road at dawn.')
    expect(reloaded.chapters[1].title).toBe('Dusk')
    expect(reloaded.chapters[1].scenes[0].markdown).toContain('Elena waited by the boathouse until dusk fell.')
  })
})
