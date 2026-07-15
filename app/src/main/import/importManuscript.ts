import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CodexCandidate } from '@shared/schema/import'
import type { ProjectManifest } from '@shared/schema/project'
import { ProjectSession, setCurrentProjectSession } from '../projectSession'
import { withBatchedPersist } from '../persistence/db'
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
  const projectsDir = join(app.getPath('documents'), 'Atlas Projects')
  const slug = slugify(parsed.title)
  // Never overwrite an existing project on import: deriving the path from the
  // title slug alone means importing a manuscript that shares a title with an
  // existing project would clobber that project's manifest and scenes.
  // Suffix until the target folder is free so import is always additive.
  let projectRoot = join(projectsDir, `${slug}.atlas`)
  for (let n = 2; existsSync(projectRoot); n++) {
    projectRoot = join(projectsDir, `${slug}-${n}.atlas`)
  }
  const session = await ProjectSession.create(projectRoot)
  setCurrentProjectSession(session)
  const manifest = await createProject(projectRoot, { title: parsed.title })

  const bookId = 'book-01'
  const partId = 'part-01'
  await writeBookMeta(projectRoot, { id: bookId, projectId: '', title: 'Book One', order: 0 })
  await writePartMeta(projectRoot, bookId, { id: partId, bookId, title: 'Part One', order: 0 })

  // Batches every writeScene() call's index-write below into one
  // db.persist() at the end of the whole import instead of one per scene —
  // see withBatchedPersist's comment in persistence/db.ts. A several-hundred
  // -scene manuscript import (e.g. a 120k-word novel) was previously
  // re-serializing the entire growing SQLite index once per scene, going
  // quadratic in scene count.
  await withBatchedPersist(session.db, async () => {
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
              schemaVersion: 2,
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
  })

  return { projectRoot, manifest, codexCandidates: extractCodexCandidates(text) }
}
