export interface ParsedScene {
  title: string
  prose: string
}

export interface ParsedChapter {
  title: string
  scenes: ParsedScene[]
}

export interface ParsedManuscript {
  title: string
  chapters: ParsedChapter[]
}

interface ChapterBlock {
  title: string
  lines: string[]
}

interface SceneBlock {
  title?: string
  lines: string[]
}

// These rules are intentionally heuristic. They catch common Markdown and
// plain-text manuscript exports, but they do not try to understand every
// author formatting convention or infer structure from typography.
export function parseManuscript(rawText: string, fallbackTitle: string): ParsedManuscript {
  const normalized = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')
  const h1Title = lines.map((line) => /^#\s+(.+?)\s*$/.exec(line)).find((match) => match !== null)?.[1]?.trim()
  const title = h1Title || fallbackTitle.trim() || 'Untitled Project'
  const chapterBlocks = splitChapters(lines, title)
  const chapters = chapterBlocks
    .map((chapter, index) => ({
      title: chapter.title.trim() || `Chapter ${index + 1}`,
      scenes: splitScenes(chapter.lines).map((scene, sceneIndex) => ({
        title: scene.title?.trim() || `Scene ${sceneIndex + 1}`,
        prose: scene.lines.join('\n').trim()
      }))
    }))
    .map((chapter) => ({
      ...chapter,
      scenes: chapter.scenes.filter((scene) => scene.prose.length > 0)
    }))
    .filter((chapter) => chapter.scenes.length > 0)

  if (chapters.length > 0) return { title, chapters }

  return {
    title,
    chapters: [
      {
        title,
        scenes: [{ title: 'Scene 1', prose: normalized.trim() }]
      }
    ]
  }
}

function splitChapters(lines: string[], manuscriptTitle: string): ChapterBlock[] {
  const chapters: ChapterBlock[] = []
  let current: ChapterBlock | null = null
  let foundHeading = false

  for (const line of lines) {
    const chapterTitle = chapterHeadingTitle(line, manuscriptTitle, !foundHeading && !current)
    if (chapterTitle !== null) {
      foundHeading = true
      if (current && current.lines.some((candidate) => candidate.trim().length > 0)) chapters.push(current)
      current = { title: chapterTitle, lines: [] }
      continue
    }

    if (current) current.lines.push(line)
  }

  if (current && current.lines.some((line) => line.trim().length > 0)) chapters.push(current)
  if (foundHeading) return chapters

  return [{ title: manuscriptTitle.trim() || 'Chapter 1', lines }]
}

function chapterHeadingTitle(line: string, manuscriptTitle: string, canBeDocumentTitle: boolean): string | null {
  const markdown = /^\s{0,3}#{1,2}\s+(.+?)\s*#*\s*$/.exec(line)
  if (markdown) {
    const title = markdown[1].trim()
    if (canBeDocumentTitle && title.toLowerCase() === manuscriptTitle.toLowerCase()) return null
    return title
  }

  const plain = /^\s*((chapter|part)\b.*)$/i.exec(line)
  return plain ? plain[1].trim() : null
}

function splitScenes(lines: string[]): SceneBlock[] {
  const scenes: SceneBlock[] = []
  let current: SceneBlock = { lines: [] }

  for (const line of lines) {
    const title = sceneBreakTitle(line)
    if (title !== null) {
      pushScene(scenes, current)
      current = { title, lines: [] }
      continue
    }

    current.lines.push(line)
  }

  pushScene(scenes, current)
  return scenes.length > 0 ? scenes : [{ lines }]
}

function pushScene(scenes: SceneBlock[], scene: SceneBlock): void {
  if (scene.lines.some((line) => line.trim().length > 0)) scenes.push(scene)
}

function sceneBreakTitle(line: string): string | null {
  const trimmed = line.trim()
  if (/^(\*\*\*|\*\s+\*\s+\*|---|###)$/.test(trimmed)) return ''

  const subheading = /^\s{0,3}#{3,6}\s*(.*?)\s*#*\s*$/.exec(line)
  if (subheading) return subheading[1].trim()

  return null
}
