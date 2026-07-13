import { TextRun } from 'docx'

export interface InlineRun {
  text: string
  bold?: boolean
  italics?: boolean
}

export function splitParagraphs(markdown: string): string[] {
  return markdown
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
}

export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/^>\s?/gm, '')
    .replace(/^-{3,}$/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

export function parseInlineRuns(line: string): InlineRun[] {
  const runs: InlineRun[] = []
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(line)) !== null) {
    if (match.index > cursor) {
      runs.push({ text: stripMarkdown(line.slice(cursor, match.index)) })
    }

    const raw = match[0]
    const bold = raw.startsWith('**') || raw.startsWith('__')
    const text = raw.slice(bold ? 2 : 1, bold ? -2 : -1)
    runs.push({ text: stripMarkdown(text), bold, italics: !bold })
    cursor = match.index + raw.length
  }

  if (cursor < line.length) {
    runs.push({ text: stripMarkdown(line.slice(cursor)) })
  }

  return runs.filter((run) => run.text.length > 0)
}

export function textRunsFromMarkdown(line: string): TextRun[] {
  const runs = parseInlineRuns(line)
  return runs.length > 0
    ? runs.map((run) => new TextRun({ text: run.text, bold: run.bold, italics: run.italics }))
    : [new TextRun('')]
}
