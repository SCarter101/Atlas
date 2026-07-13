import { useState } from 'react'
import type { CodexExportFormat, ExportResult, ManuscriptExportFormat } from '@shared/ipc'

interface FormatOption<TFormat extends string> {
  id: TFormat
  label: string
  hint: string
}

const MANUSCRIPT_FORMATS: FormatOption<ManuscriptExportFormat>[] = [
  { id: 'md', label: 'Markdown', hint: '.md, scene files' },
  { id: 'docx', label: 'DOCX', hint: 'Word-compatible' },
  { id: 'pdf', label: 'PDF', hint: 'Print-ready' },
  { id: 'epub', label: 'EPUB', hint: 'E-reader format' },
  { id: 'txt', label: 'Plain text', hint: '.txt' }
]

const CODEX_FORMATS: FormatOption<CodexExportFormat>[] = [
  { id: 'json', label: 'JSON', hint: 'Structured data' },
  { id: 'codex-md', label: 'Markdown', hint: 'Readable bible' },
  { id: 'series-bible', label: 'Series Bible (Markdown)', hint: 'Compressed overview' },
  { id: 'series-bible-pdf', label: 'Series Bible (PDF)', hint: 'Typeset overview' },
  { id: 'series-bible-epub', label: 'Series Bible (EPUB)', hint: 'E-reader overview' }
]

export function Export(): JSX.Element {
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [result, setResult] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  async function runExport(action: string, exportFn: () => Promise<ExportResult>): Promise<void> {
    setBusyAction(action)
    setResult(null)
    const next = await exportFn()
    setBusyAction(null)

    if (next.canceled) return
    if (next.ok && next.filePath) {
      setResult({ kind: 'success', message: `Exported to ${next.filePath}` })
    } else {
      setResult({ kind: 'error', message: next.error ?? 'Export failed.' })
    }
  }

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '36px 40px 80px' }}>
      <div style={{ fontFamily: 'Source Serif 4, serif', fontSize: 24, fontWeight: 600, marginBottom: 4 }}>Export</div>
      <div style={{ fontSize: 13.5, color: 'var(--c-ink-faint)', marginBottom: 28 }}>Export the manuscript or the Codex</div>

      <FormatSection
        title="Manuscript"
        formats={MANUSCRIPT_FORMATS}
        busyAction={busyAction}
        actionPrefix="manuscript"
        onSelect={(format) => runExport(`manuscript:${format}`, () => window.atlas.export.manuscript(format))}
      />
      <FormatSection
        title="Codex"
        formats={CODEX_FORMATS}
        busyAction={busyAction}
        actionPrefix="codex"
        onSelect={(format) => runExport(`codex:${format}`, () => window.atlas.export.codex(format))}
      />

      {result && (
        <div
          style={{
            marginTop: 8,
            padding: '10px 14px',
            borderRadius: 10,
            background: result.kind === 'success' ? 'var(--c-accent-soft)' : 'var(--c-amber-soft)',
            color: result.kind === 'success' ? 'var(--c-accent-text)' : 'var(--c-amber)',
            fontSize: 12.5
          }}
        >
          {result.message}
        </div>
      )}
    </div>
  )
}

function FormatSection<TFormat extends string>({
  title,
  formats,
  busyAction,
  actionPrefix,
  onSelect
}: {
  title: string
  formats: FormatOption<TFormat>[]
  busyAction: string | null
  actionPrefix: string
  onSelect: (id: TFormat) => void
}): JSX.Element {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', marginBottom: 12 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {formats.map((format) => {
          const action = `${actionPrefix}:${format.id}`
          const isBusy = busyAction === action
          return (
            <button
              key={format.id}
              onClick={() => onSelect(format.id)}
              disabled={busyAction !== null}
              style={{
                width: 190,
                textAlign: 'left',
                padding: '16px 18px',
                borderRadius: 12,
                border: `1px solid ${isBusy ? 'var(--c-accent)' : 'var(--c-border)'}`,
                background: isBusy ? 'var(--c-accent-soft)' : 'var(--c-surface-raised)',
                cursor: busyAction ? 'default' : 'pointer',
                opacity: busyAction && !isBusy ? 0.62 : 1
              }}
            >
              <div style={{ fontFamily: 'Source Serif 4, serif', fontWeight: 600, fontSize: 15, color: isBusy ? 'var(--c-accent-text)' : 'var(--c-ink)' }}>
                {isBusy ? 'Exporting...' : format.label}
              </div>
              <div style={{ fontSize: 12, color: 'var(--c-ink-faint)', marginTop: 3 }}>{format.hint}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
