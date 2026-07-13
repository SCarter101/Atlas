import { app } from 'electron'
import { join } from 'node:path'
import type { CodexCandidate } from '@shared/schema/import'
import type { ProjectManifest } from '@shared/schema/project'
import { ProjectSession, setCurrentProjectSession } from '../projectSession'
import { writeBookMeta, writeChapterMeta, writePartMeta } from '../persistence/manuscriptStore'
import { createProject } from '../persistence/projectStore'
import { writeScene } from '../persistence/sceneStore'
import { slugify } from '../persistence/createProjectFromFoundations'
import { extractCodexCandidates } from './extractCodex'
import { parseManuscript } from './parseManuscript'
import { readSourceFile } from './readSourceFile'

export async function importManuscriptFromFile(
  filePath: string
): Promise<{ projectRoot: string; manifest: ProjectManifest; codexCandidates: CodexCandidate[] }> {
  const { text, baseName } = await readSourceFile(filePath)
  const parsed = parseManuscript(text, baseName)
  const projectRoot = join(app.getPath('documents'), 'Atlas Projects', `${slugify(parsed.title)}.atlas`)
  const session = await ProjectSession.create(projectRoot)
  setCurrentProjectSession(session)
  const manifest = await createProject(projectRoot, { title: parsed.title })

  const bookId = 'book-01'
  const partId = 'part-01'
  await writeBookMeta(projectRoot, { id: bookId, projectId: '', title: 'Book One', order: 0 })
  await writePartMeta(projectRoot, bookId, { id: partId, bookId, title: 'Part One', order: 0 })

  for (const [chapterIndex, chapter] of parsed.chapters.entries()) {
    const chapterId = `chapter-${String(chapterIndex + 1).padStart(3, '0')}`
    const sceneIds = chapter.scenes.map((_, sceneIndex) => {
      const sceneSlug = `scene-${String(sceneIndex + 1).padStart(3, '0')}`
      return `${chapterId}-${sceneSlug}`
    })

    await writeChapterMeta(projectRoot, bookId, partId, {
      id: chapterId,
      partId,
      title: chapter.title,
      order: chapterIndex,
      summary: '',
      sceneIds
    })

    const relativeDir = `${bookId}/${partId}/${chapterId}`
    for (const [sceneIndex, scene] of chapter.scenes.entries()) {
      const sceneSlug = `scene-${String(sceneIndex + 1).padStart(3, '0')}`
      const globalSceneId = `${chapterId}-${sceneSlug}`
      await writeScene(
        projectRoot,
        session.db,
        globalSceneId,
        {
          meta: {
            schemaVersion: 1,
            id: globalSceneId,
            chapterId,
            order: sceneIndex,
            title: scene.title,
            status: 'drafted'
          },
          prose: scene.prose
        },
        relativeDir,
        sceneSlug
      )
    }
  }

  return { projectRoot, manifest, codexCandidates: extractCodexCandidates(text) }
}
