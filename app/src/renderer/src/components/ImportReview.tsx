import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CodexEntry } from '@shared/schema/codex'
import type { CodexCandidate } from '@shared/ipc'
import { useAtlasStore } from '../state/store'

export function ImportReview(): JSX.Element {
  const navigate = useNavigate()
  const candidates = useAtlasStore((s) => s.pendingImportCandidates)
  const clearPendingImportCandidates = useAtlasStore((s) => s.clearPendingImportCandidates)
  const [kept, setKept] = useState<Set<string>>(() => new Set(candidates.map(candidateKey)))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedCount = useMemo(
    () => candidates.filter((candidate) => kept.has(candidateKey(candidate))).length,
    [candidates, kept]
  )

  const finish = (route: string): void => {
    clearPendingImportCandidates()
    navigate(route)
  }

  const addSelected = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const now = new Date().toISOString()
      for (const candidate of candidates) {
        if (!kept.has(candidateKey(candidate))) continue
        const entry: CodexEntry = {
          schemaVersion: 1,
          id: crypto.randomUUID(),
          type: candidate.type,
          name: candidate.name,
          status: 'tentative',
          body: { summary: candidate.summary },
          isPrivate: false,
          localModelOnly: false,
          locked: false,
          source: 'ai-extracted',
          relationships: [],
          manuscriptLinks: [],
          createdAt: now,
          updatedAt: now,
          history: []
        }
        await window.atlas.codex.upsert(entry)
      }
      finish('/codex')
    } catch (err) {
      setError(String(err))
      setSaving(false)
    }
  }

  if (candidates.length === 0) {
    return (
      <div style={{ padding: 28, maxWidth: 900 }}>
        <h1 style={{ margin: 0, fontFamily: 'Source Serif 4, serif', fontSize: 30 }}>Codex Import Review</h1>
        <p style={{ color: 'var(--c-ink-soft)', lineHeight: 1.6 }}>No extracted Codex candidates are waiting for review.</p>
        <button onClick={() => navigate('/manuscript')} style={primaryButtonStyle}>
          Continue
        </button>
      </div>
    )
  }

  return (
    <div style={{ padding: 28, maxWidth: 960 }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ margin: 0, fontFamily: 'Source Serif 4, serif', fontSize: 30 }}>Codex Import Review</h1>
        <p style={{ color: 'var(--c-ink-soft)', lineHeight: 1.6, maxWidth: 680 }}>
          Review the extracted candidates before adding them to the Codex. Kept items will be saved as tentative AI-extracted entries.
        </p>
      </div>

      {error && (
        <div style={{ marginBottom: 16, padding: 12, border: '1px solid var(--c-red)', borderRadius: 8, background: 'var(--c-red-soft)', color: 'var(--c-red)' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gap: 10, marginBottom: 20 }}>
        {candidates.map((candidate) => {
          const key = candidateKey(candidate)
          const isKept = kept.has(key)
          return (
            <label
              key={key}
              style={{
                display: 'grid',
                gridTemplateColumns: '24px 1fr auto',
                gap: 12,
                alignItems: 'start',
                padding: 14,
                border: '1px solid var(--c-border)',
                borderRadius: 8,
                background: 'var(--c-surface-raised)'
              }}
            >
              <input
                type="checkbox"
                checked={isKept}
                onChange={(event) => {
                  setKept((current) => {
                    const next = new Set(current)
                    if (event.target.checked) next.add(key)
                    else next.delete(key)
                    return next
                  })
                }}
              />
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{candidate.name}</div>
                <div style={{ fontSize: 13, color: 'var(--c-ink-soft)', lineHeight: 1.5 }}>{candidate.summary}</div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--c-ink-faint)', textTransform: 'capitalize' }}>
                {candidate.type} / {candidate.confidence}
              </div>
            </label>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button disabled={saving} onClick={() => finish('/manuscript')} style={secondaryButtonStyle}>
          Skip for now
        </button>
        <button disabled={saving || selectedCount === 0} onClick={() => void addSelected()} style={primaryButtonStyle}>
          {saving ? 'Adding...' : `Add selected to Codex (${selectedCount})`}
        </button>
      </div>
    </div>
  )
}

function candidateKey(candidate: CodexCandidate): string {
  return `${candidate.type}:${candidate.name.toLowerCase()}`
}

const primaryButtonStyle = {
  padding: '9px 14px',
  borderRadius: 8,
  border: '1px solid var(--c-accent)',
  background: 'var(--c-accent)',
  color: '#fff',
  fontWeight: 700,
  cursor: 'pointer'
}

const secondaryButtonStyle = {
  padding: '9px 14px',
  borderRadius: 8,
  border: '1px solid var(--c-border)',
  background: 'var(--c-surface)',
  color: 'var(--c-ink-soft)',
  fontWeight: 700,
  cursor: 'pointer'
}
