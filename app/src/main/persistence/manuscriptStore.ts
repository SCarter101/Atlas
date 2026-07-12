import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Book, Chapter, ManuscriptTree, Part, SceneMeta } from '@shared/schema/manuscript'
import { projectPaths } from './paths'

export async function writeBookMeta(projectRoot: string, book: Book): Promise<void> {
  const dir = join(projectPaths(projectRoot).manuscriptDir, book.id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'meta.json'), JSON.stringify(book, null, 2), 'utf-8')
}

export async function writePartMeta(projectRoot: string, bookId: string, part: Part): Promise<void> {
  const dir = join(projectPaths(projectRoot).manuscriptDir, bookId, part.id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'meta.json'), JSON.stringify(part, null, 2), 'utf-8')
}

export async function writeChapterMeta(
  projectRoot: string,
  bookId: string,
  partId: string,
  chapter: Chapter
): Promise<void> {
  const dir = join(projectPaths(projectRoot).manuscriptDir, bookId, partId, chapter.id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'meta.json'), JSON.stringify(chapter, null, 2), 'utf-8')
}

async function readJsonSafe<T>(path: string): Promise<T | null> {
  const raw = await readFile(path, 'utf-8').catch(() => null)
  return raw ? (JSON.parse(raw) as T) : null
}

// Walks the manuscript folder tree directly from disk — this is what the
// left-nav renders. It never touches SQLite, matching the "files are the
// only source of truth" rule in the data-contracts doc §4.
export async function readManuscriptTree(projectRoot: string): Promise<ManuscriptTree> {
  const manuscriptDir = projectPaths(projectRoot).manuscriptDir
  const bookDirs = await readdir(manuscriptDir, { withFileTypes: true }).catch(() => [])
  const books: ManuscriptTree['books'] = []

  for (const bookDirEnt of bookDirs) {
    if (!bookDirEnt.isDirectory()) continue
    const bookDir = join(manuscriptDir, bookDirEnt.name)
    const book = await readJsonSafe<Book>(join(bookDir, 'meta.json'))
    if (!book) continue

    const partDirs = await readdir(bookDir, { withFileTypes: true }).catch(() => [])
    const parts: ManuscriptTree['books'][number]['parts'] = []

    for (const partDirEnt of partDirs) {
      if (!partDirEnt.isDirectory()) continue
      const partDir = join(bookDir, partDirEnt.name)
      const part = await readJsonSafe<Part>(join(partDir, 'meta.json'))
      if (!part) continue

      const chapterDirs = await readdir(partDir, { withFileTypes: true }).catch(() => [])
      const chapters: ManuscriptTree['books'][number]['parts'][number]['chapters'] = []

      for (const chapterDirEnt of chapterDirs) {
        if (!chapterDirEnt.isDirectory()) continue
        const chapterDir = join(partDir, chapterDirEnt.name)
        const chapter = await readJsonSafe<Chapter>(join(chapterDir, 'meta.json'))
        if (!chapter) continue

        const files = await readdir(chapterDir).catch(() => [])
        const scenes: SceneMeta[] = []
        for (const file of files) {
          if (!file.endsWith('.meta.json')) continue
          const meta = await readJsonSafe<SceneMeta>(join(chapterDir, file))
          if (meta) scenes.push(meta)
        }
        scenes.sort((a, b) => a.order - b.order)
        chapters.push({ ...chapter, scenes })
      }
      chapters.sort((a, b) => a.order - b.order)
      parts.push({ ...part, chapters })
    }
    parts.sort((a, b) => a.order - b.order)
    books.push({ ...book, parts })
  }

  return { books }
}
