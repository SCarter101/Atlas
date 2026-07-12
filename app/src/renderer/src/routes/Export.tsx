import { useState } from 'react'

interface FormatOption {
  id: string
  label: string
  hint: string
}

const MANUSCRIPT_FORMATS: FormatOption[] = [
  { id: 'md', label: 'Markdown', hint: '.md, scene files' },
  { id: 'docx', label: 'DOCX', hint: 'Word-compatible' },
  { id: 'pdf', label: 'PDF', hint: 'Print-ready' },
  { id: 'epub', label: 'EPUB', hint: 'E-reader format' },
  { id: 'txt', label: 'Plain text', hint: '.txt' }
]

const CODEX_FORMATS: FormatOption[] = [
  { id: 'json', label: 'JSON', hint: 'Structured data' },
  { id: 'codex-md', label: 'Markdown', hint: 'Readable bible' },
  { id: 'series-bible', label: 'Series Bible (summary)', hint: 'Compressed overview' }
]

export function Export(): JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '36px 40px 80px' }}>
      <div style={{ fontFamily: 'Source Serif 4, serif', fontSize: 24, fontWeight: 600, marginBottom: 4 }}>Export</div>
      <div style={{ fontSize: 13.5, color: 'var(--c-ink-faint)', marginBottom: 28 }}>Export the manuscript or the Codex</div>

      <FormatSection title="Manuscript" formats={MANUSCRIPT_FORMATS} selected={selected} onSelect={setSelected} />
      <FormatSection title="Codex" formats={CODEX_FORMATS} selected={selected} onSelect={setSelected} />

      {selected && (
        <div
          style={{
            marginTop: 8,
            padding: '10px 14px',
            borderRadius: 10,
            background: 'var(--c-amber-soft)',
            color: 'var(--c-amber)',
            fontSize: 12.5
          }}
        >
          Real export rendering isn't built yet (spec §12, Phase 5) — this picker is the UI shell it will plug into.
        </div>
      )}
    </div>
  )
}

function FormatSection({
  title,
  formats,
  selected,
  onSelect
}: {
  title: string
  formats: FormatOption[]
  selected: string | null
  onSelect: (id: string) => void
}): JSX.Element {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', marginBottom: 12 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {formats.map((format) => {
          const isSelected = selected === format.id
          return (
            <button
              key={format.id}
              onClick={() => onSelect(format.id)}
              style={{
                width: 190,
                textAlign: 'left',
                padding: '16px 18px',
                borderRadius: 12,
                border: `1px solid ${isSelected ? 'var(--c-accent)' : 'var(--c-border)'}`,
                background: isSelected ? 'var(--c-accent-soft)' : 'var(--c-surface-raised)',
                cursor: 'pointer'
              }}
            >
              <div style={{ fontFamily: 'Source Serif 4, serif', fontWeight: 600, fontSize: 15, color: isSelected ? 'var(--c-accent-text)' : 'var(--c-ink)' }}>
                {format.label}
              </div>
              <div style={{ fontSize: 12, color: 'var(--c-ink-faint)', marginTop: 3 }}>{format.hint}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
