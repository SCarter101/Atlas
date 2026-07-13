import JSZip from 'jszip'
import PDFDocument from 'pdfkit'
import type { CodexEntry } from '@shared/schema/codex'
import type { CodexExportFormat } from '@shared/ipc'
import { stripMarkdown } from './markdown'

export async function renderCodex(
  entries: CodexEntry[],
  manifest: { title: string; genre?: string },
  format: CodexExportFormat
): Promise<Buffer | string> {
  switch (format) {
    case 'json':
      return JSON.stringify({ manifest, entries }, null, 2)
    case 'codex-md':
      return renderCodexMarkdown(entries, manifest)
    case 'series-bible':
      return renderSeriesBible(entries, manifest)
    case 'series-bible-pdf':
      return renderSeriesBiblePdf(renderSeriesBible(entries, manifest), manifest)
    case 'series-bible-epub':
      return renderSeriesBibleEpub(renderSeriesBible(entries, manifest), manifest)
  }
}

function renderCodexMarkdown(entries: CodexEntry[], manifest: { title: string; genre?: string }): string {
  const lines = [`# ${manifest.title} Codex`]
  if (manifest.genre) lines.push('', `Genre: ${manifest.genre}`)

  for (const [type, typeEntries] of groupedPublicEntries(entries)) {
    lines.push('', `## ${labelType(type)}`)
    for (const entry of typeEntries) {
      lines.push('', `### ${entry.name}`, '', `Status: ${entry.status}`)
      const bodyLines = bodyMarkdown(entry.body)
      if (bodyLines.length > 0) lines.push('', ...bodyLines)
    }
  }

  return lines.join('\n').trimEnd()
}

function renderSeriesBible(entries: CodexEntry[], manifest: { title: string; genre?: string }): string {
  const lines = [`# ${manifest.title} Series Bible`]
  if (manifest.genre) lines.push('', `Genre: ${manifest.genre}`)

  for (const [type, typeEntries] of groupedPublicEntries(entries)) {
    lines.push('', `## ${labelType(type)}`)
    for (const entry of typeEntries) {
      lines.push(`- **${entry.name}** (${entry.status}): ${entrySummary(entry)}`)
    }
  }

  return lines.join('\n').trimEnd()
}

async function renderSeriesBiblePdf(content: string, manifest: { title: string }): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 72 })
  const chunks: Buffer[] = []

  doc.on('data', (chunk: Buffer) => chunks.push(chunk))
  const ended = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
  })

  doc.fontSize(22).text(`${manifest.title} Series Bible`)
  doc.moveDown()
  for (const line of content.split('\n').slice(1)) {
    if (line.startsWith('## ')) {
      doc.moveDown().fontSize(15).text(stripMarkdown(line))
    } else if (line.startsWith('- ')) {
      doc.fontSize(10.5).text(stripMarkdown(line), { paragraphGap: 5, lineGap: 2 })
    } else if (line.trim()) {
      doc.fontSize(10.5).text(stripMarkdown(line), { paragraphGap: 5, lineGap: 2 })
    }
  }

  doc.end()
  return ended
}

async function renderSeriesBibleEpub(content: string, manifest: { title: string }): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    xml`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  )
  zip.file('OEBPS/nav.xhtml', navXhtml(manifest.title))
  zip.file('OEBPS/series-bible.xhtml', seriesBibleXhtml(content, manifest.title))
  zip.file('OEBPS/content.opf', opf(manifest.title))
  return zip.generateAsync({ type: 'nodebuffer' })
}

function groupedPublicEntries(entries: CodexEntry[]): [string, CodexEntry[]][] {
  const groups = new Map<string, CodexEntry[]>()
  for (const entry of entries.filter((candidate) => !candidate.isPrivate && candidate.type !== 'private-author-note')) {
    groups.set(entry.type, [...(groups.get(entry.type) ?? []), entry])
  }
  return [...groups.entries()]
    .map(([type, typeEntries]) => [type, typeEntries.sort((a, b) => a.name.localeCompare(b.name))] as [string, CodexEntry[]])
    .sort(([a], [b]) => a.localeCompare(b))
}

function bodyMarkdown(body: Record<string, unknown>): string[] {
  return Object.entries(body)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `- **${labelKey(key)}:** ${formatValue(value)}`)
}

function entrySummary(entry: CodexEntry): string {
  const firstBodyValue = Object.values(entry.body).find((value) => value !== undefined && value !== null && value !== '')
  const summary = firstBodyValue ? formatValue(firstBodyValue) : 'No summary recorded.'
  return summary.length > 220 ? `${summary.slice(0, 217).trimEnd()}...` : summary
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(formatValue).join(', ')
  if (typeof value === 'object' && value !== null) return JSON.stringify(value)
  return String(value)
}

function labelType(type: string): string {
  return type
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function labelKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/[-_]+/g, ' ')
    .replace(/^./, (char) => char.toUpperCase())
}

function seriesBibleXhtml(content: string, title: string): string {
  const html = content
    .split('\n')
    .map((line) => {
      if (line.startsWith('# ')) return `<h1>${escapeXml(stripMarkdown(line))}</h1>`
      if (line.startsWith('## ')) return `<h2>${escapeXml(stripMarkdown(line))}</h2>`
      if (line.startsWith('- ')) return `<p>${escapeXml(stripMarkdown(line))}</p>`
      if (line.trim()) return `<p>${escapeXml(stripMarkdown(line))}</p>`
      return ''
    })
    .filter(Boolean)
    .join('\n')

  return xml`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>${escapeXml(title)} Series Bible</title></head>
  <body>${html}</body>
</html>`
}

function navXhtml(title: string): string {
  return xml`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>${escapeXml(title)} Navigation</title></head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>${escapeXml(title)}</h1>
      <ol><li><a href="series-bible.xhtml">Series Bible</a></li></ol>
    </nav>
  </body>
</html>`
}

function opf(title: string): string {
  return xml`<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="book-id" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">atlas-series-bible-${escapeXml(slug(title))}</dc:identifier>
    <dc:title>${escapeXml(title)} Series Bible</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="series-bible" href="series-bible.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="series-bible"/>
  </spine>
</package>`
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'codex'
}

function xml(strings: TemplateStringsArray, ...values: string[]): string {
  return strings.reduce((acc, part, index) => `${acc}${part}${values[index] ?? ''}`, '')
}
