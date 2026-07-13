import { readFile } from 'node:fs/promises'
import { extname, basename } from 'node:path'
import mammoth from 'mammoth'

export async function readSourceFile(filePath: string): Promise<{ text: string; baseName: string }> {
  const extension = extname(filePath).toLowerCase()
  const baseName = basename(filePath, extension)

  if (extension === '.md' || extension === '.markdown' || extension === '.txt') {
    return { text: await readFile(filePath, 'utf-8'), baseName }
  }

  if (extension === '.docx') {
    // extractRawText is mammoth's stable API and returns plain text only, so
    // Word heading STYLES don't survive as Markdown headings — a .docx whose
    // chapters are marked with Word's Heading styles (rather than literal
    // "Chapter N" text lines) will import as a single chapter. mammoth's
    // Markdown output that would preserve those styles is unofficial/experimental
    // and isn't in the shipped type defs, so we accept this honest limitation.
    const { value } = await mammoth.extractRawText({ path: filePath })
    return { text: value, baseName }
  }

  throw new Error(`Unsupported manuscript file type: ${extension || 'unknown'}`)
}
