import { Document, HeadingLevel, Packer, Paragraph } from 'docx'
import JSZip from 'jszip'
import PDFDocument from 'pdfkit'
import type { ManuscriptExportFormat } from '@shared/ipc'
import type { LoadedManuscript } from './loadProjectData'
import { splitParagraphs, stripMarkdown, textRunsFromMarkdown } from './markdown'

export async function renderManuscript(
  manuscript: LoadedManuscript,
  format: ManuscriptExportFormat
): Promise<Buffer | string> {
  switch (format) {
    case 'md':
      return renderMarkdown(manuscript)
    case 'txt':
      return stripMarkdown(renderMarkdown(manuscript))
    case 'docx':
      return renderDocx(manuscript)
    case 'pdf':
      return renderPdf(manuscript)
    case 'epub':
      return renderEpub(manuscript)
  }
}

// Chapters render as H2 (not H1) with the manuscript title as its own H1
// line first — this isn't just cosmetic: main/import/parseManuscript.ts's
// own heuristic (see its tests) expects exactly this H1-title/H2-chapter
// convention. Rendering chapters as H1 (as an earlier version of this
// function did, with no title line at all) meant a round-trip through
// export -> import silently dropped the title and, worse, dropped an
// entire chapter's worth of prose outright — parseManuscript's "is this
// heading actually the document title?" check only inspects the *first*
// heading-like line, so with no distinct title line every export's first
// chapter heading was mistaken for the title and its content orphaned
// before any chapter block was opened to hold it. Keeping this aligned
// with parseManuscript's convention is exactly what
// main/import/manuscriptRoundTrip.test.ts guards against regressing.
function renderMarkdown(manuscript: LoadedManuscript): string {
  const chapters = manuscript.chapters
    .map((chapter) => {
      const scenes = chapter.scenes
        .map((scene) => scene.markdown.trim())
        .filter(Boolean)
        .join('\n\n')
      return [`## ${chapter.title}`, scenes].filter(Boolean).join('\n\n')
    })
    .join('\n\n---\n\n')

  return [`# ${manuscript.title}`, chapters].filter(Boolean).join('\n\n')
}

async function renderDocx(manuscript: LoadedManuscript): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({
      text: manuscript.title,
      heading: HeadingLevel.TITLE
    })
  ]

  for (const chapter of manuscript.chapters) {
    children.push(new Paragraph({ text: chapter.title, heading: HeadingLevel.HEADING_1 }))
    for (const scene of chapter.scenes) {
      for (const paragraph of splitParagraphs(scene.markdown)) {
        children.push(new Paragraph({ children: textRunsFromMarkdown(paragraph.replace(/\n/g, ' ')) }))
      }
    }
  }

  const document = new Document({ sections: [{ children }] })
  return Packer.toBuffer(document)
}

async function renderPdf(manuscript: LoadedManuscript): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 72 })
  const chunks: Buffer[] = []

  doc.on('data', (chunk: Buffer) => chunks.push(chunk))
  const ended = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
  })

  doc.fontSize(26).text(manuscript.title, { align: 'center' })
  if (manuscript.genre) doc.moveDown().fontSize(12).text(manuscript.genre, { align: 'center' })

  for (const chapter of manuscript.chapters) {
    doc.addPage()
    doc.fontSize(18).text(chapter.title)
    doc.moveDown()
    for (const scene of chapter.scenes) {
      for (const paragraph of splitParagraphs(scene.markdown)) {
        doc.fontSize(11).text(stripMarkdown(paragraph.replace(/\n/g, ' ')), {
          align: 'left',
          paragraphGap: 8,
          lineGap: 3
        })
      }
    }
  }

  doc.end()
  return ended
}

async function renderEpub(manuscript: LoadedManuscript): Promise<Buffer> {
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

  const chapterFiles = manuscript.chapters.map((chapter, index) => ({
    id: `chapter-${index + 1}`,
    href: `chapter-${index + 1}.xhtml`,
    title: chapter.title,
    content: chapterToXhtml(chapter.title, chapter.scenes)
  }))

  for (const chapter of chapterFiles) {
    zip.file(`OEBPS/${chapter.href}`, chapter.content)
  }
  zip.file('OEBPS/nav.xhtml', navXhtml(manuscript.title, chapterFiles))
  zip.file('OEBPS/content.opf', opf(manuscript.title, chapterFiles))

  return zip.generateAsync({ type: 'nodebuffer' })
}

function chapterToXhtml(title: string, scenes: LoadedManuscript['chapters'][number]['scenes']): string {
  const paragraphs = scenes
    .flatMap((scene) => splitParagraphs(scene.markdown))
    .map((paragraph) => `<p>${escapeXml(stripMarkdown(paragraph.replace(/\n/g, ' ')))}</p>`)
    .join('\n')

  return xml`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>${escapeXml(title)}</title></head>
  <body>
    <section>
      <h1>${escapeXml(title)}</h1>
      ${paragraphs}
    </section>
  </body>
</html>`
}

function navXhtml(title: string, chapters: { href: string; title: string }[]): string {
  const links = chapters
    .map((chapter) => `<li><a href="${escapeXml(chapter.href)}">${escapeXml(chapter.title)}</a></li>`)
    .join('\n')
  return xml`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>${escapeXml(title)} Navigation</title></head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>${escapeXml(title)}</h1>
      <ol>${links}</ol>
    </nav>
  </body>
</html>`
}

function opf(title: string, chapters: { id: string; href: string }[]): string {
  const manifestItems = chapters
    .map((chapter) => `<item id="${chapter.id}" href="${chapter.href}" media-type="application/xhtml+xml"/>`)
    .join('\n')
  const spineItems = chapters.map((chapter) => `<itemref idref="${chapter.id}"/>`).join('\n')
  return xml`<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="book-id" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">atlas-${escapeXml(slug(title))}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${manifestItems}
  </manifest>
  <spine>
    ${spineItems}
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
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'manuscript'
}

function xml(strings: TemplateStringsArray, ...values: string[]): string {
  return strings.reduce((acc, part, index) => `${acc}${part}${values[index] ?? ''}`, '')
}
