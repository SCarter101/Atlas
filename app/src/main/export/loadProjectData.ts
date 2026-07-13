import type { CodexEntry } from '@shared/schema/codex'
import type { AtlasDb } from '../persistence/db'
import { listCodexEntries } from '../persistence/codexStore'
import { readManuscriptTree } from '../persistence/manuscriptStore'
import { openProject } from '../persistence/projectStore'
import { readScene } from '../persistence/sceneStore'

export interface LoadedScene {
  title: string
  markdown: string
}

export interface LoadedChapter {
  title: string
  scenes: LoadedScene[]
}

export interface LoadedManuscript {
  title: string
  genre?: string
  chapters: LoadedChapter[]
}

export async function loadManuscript(projectRoot: string, db: AtlasDb): Promise<LoadedManuscript> {
  const [manifest, tree] = await Promise.all([openProject(projectRoot), readManuscriptTree(projectRoot)])
  const chapters: LoadedChapter[] = []

  for (const book of [...tree.books].sort((a, b) => a.order - b.order)) {
    for (const part of [...book.parts].sort((a, b) => a.order - b.order)) {
      for (const chapter of [...part.chapters].sort((a, b) => a.order - b.order)) {
        const scenes = await Promise.all(
          [...chapter.scenes]
            .sort((a, b) => a.order - b.order)
            .map(async (scene) => {
              const loaded = await readScene(projectRoot, db, scene.id)
              return { title: loaded.meta.title, markdown: loaded.prose }
            })
        )
        chapters.push({ title: chapter.title, scenes })
      }
    }
  }

  return {
    title: manifest.title,
    genre: manifest.genrePrimary,
    chapters
  }
}

export async function loadCodex(
  projectRoot: string
): Promise<{ entries: CodexEntry[]; manifest: { title: string; genre?: string } }> {
  const [manifest, entries] = await Promise.all([openProject(projectRoot), listCodexEntries(projectRoot)])
  return {
    entries,
    manifest: {
      title: manifest.title,
      genre: manifest.genrePrimary
    }
  }
}
