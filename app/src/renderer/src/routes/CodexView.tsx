import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { CodexEntry, CodexEntryType } from '@shared/schema/codex'
import { detectContradictions } from '@shared/codexLogic'
import { CodexEntryForm } from '../components/CodexEntryForm'
import { useAtlasStore } from '../state/store'

const STATUS_COLOR: Record<CodexEntry['status'], string> = {
  canon: 'var(--c-green)',
  tentative: 'var(--c-amber)',
  deprecated: 'var(--c-ink-faint)',
  contradicted: 'var(--c-red)'
}

export const TYPE_LABEL: Record<CodexEntryType, string> = {
  character: 'Character',
  location: 'Location',
  faction: 'Faction',
  object: 'Object',
  event: 'Event',
  'world-rule': 'World Rule',
  'timeline-item': 'Timeline',
  relationship: 'Relationship',
  theme: 'Theme',
  motif: 'Motif',
  'research-note': 'Research Note',
  'historical-reference': 'Historical Reference',
  'scene-note': 'Scene Note',
  'private-author-note': 'Private Note'
}

const FILTERS: Array<CodexEntryType | 'All'> = [
  'All',
  'character',
  'location',
  'faction',
  'world-rule',
  'timeline-item',
  'theme',
  'private-author-note'
]

function isPending(entry: CodexEntry): boolean {
  return entry.source !== 'author' && !entry.approvedAt
}

export function CodexView(): JSX.Element {
  const manifest = useAtlasStore((s) => s.manifest)
  const [entries, setEntries] = useState<CodexEntry[]>([])
  const [filter, setFilter] = useState<CodexEntryType | 'All'>('All')
  const [refiningId, setRefiningId] = useState<string | null>(null)
  const [formEntry, setFormEntry] = useState<CodexEntry | null | 'new'>(null)

  function refresh(): void {
    void window.atlas.codex.list().then(setEntries)
  }

  useEffect(refresh, [])

  const pending = entries.filter(isPending)
  const resolved = entries.filter((e) => !isPending(e) && (filter === 'All' || e.type === filter))

  const contradictions = useMemo(() => detectContradictions(entries), [entries])

  const canonCount = entries.filter((e) => e.status === 'canon').length
  const completenessPct = entries.length ? Math.round((canonCount / entries.length) * 100) : 0

  async function accept(entry: CodexEntry): Promise<void> {
    await window.atlas.codex.upsert({ ...entry, approvedAt: new Date().toISOString() })
    refresh()
  }

  async function reject(entry: CodexEntry): Promise<void> {
    await window.atlas.codex.delete(entry.id, entry.type)
    refresh()
  }

  async function deleteEntry(entry: CodexEntry): Promise<void> {
    if (!window.confirm(`Delete "${entry.name}" from the Codex? This can't be undone.`)) return
    await window.atlas.codex.delete(entry.id, entry.type)
    refresh()
  }

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '36px 40px 80px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: 'Source Serif 4, serif', fontSize: 24, fontWeight: 600 }}>Codex</div>
          <div style={{ fontSize: 13, color: 'var(--c-ink-faint)', marginTop: 4 }}>
            The living knowledgebase behind {manifest?.title ?? 'this project'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
          <div style={{ textAlign: 'right', minWidth: 140 }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', marginBottom: 6 }}>
              Completeness
            </div>
            <div style={{ height: 6, width: 140, borderRadius: 3, background: 'var(--c-border)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${completenessPct}%`, background: 'var(--c-accent)', borderRadius: 3 }} />
            </div>
          </div>
          <button onClick={() => setFormEntry('new')} style={newEntryButtonStyle}>
            New Entry
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 24 }}>
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '5px 11px',
              borderRadius: 999,
              border: '1px solid var(--c-border)',
              background: filter === f ? 'var(--c-accent-soft)' : 'transparent',
              color: filter === f ? 'var(--c-accent-text)' : 'var(--c-ink-soft)',
              fontSize: 12,
              cursor: 'pointer'
            }}
          >
            {f === 'All' ? 'All' : TYPE_LABEL[f]}
          </button>
        ))}
      </div>

      {pending.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--c-amber)',
              marginBottom: 10
            }}
          >
            Pending agent proposals
          </div>
          {pending.map((entry) => {
            const citation = typeof entry.body.citationsSummary === 'string' ? entry.body.citationsSummary : undefined
            return (
              <div
                key={entry.id}
                style={{
                  padding: 16,
                  borderRadius: 12,
                  border: '1px dashed var(--c-amber)',
                  background: 'var(--c-amber-soft)',
                  marginBottom: 10
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--c-amber)', marginBottom: 6 }}>
                  <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {TYPE_LABEL[entry.type]} · Proposed by World Builder
                  </span>
                  {citation && <span>{citation}</span>}
                </div>
                <div style={{ fontFamily: 'Source Serif 4, serif', fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{entry.name}</div>
                <div style={{ fontSize: 13, color: 'var(--c-ink-soft)', marginBottom: 12 }}>
                  {typeof entry.body.summary === 'string' ? entry.body.summary : ''}
                </div>

                {refiningId === entry.id ? (
                  <div style={{ fontSize: 12, color: 'var(--c-ink-faint)' }}>
                    Refine will re-run World Builder once it's wired up.{' '}
                    <button
                      onClick={() => setRefiningId(null)}
                      style={{ border: 'none', background: 'none', color: 'var(--c-accent-text)', cursor: 'pointer', padding: 0, fontSize: 12 }}
                    >
                      Dismiss
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => void accept(entry)} style={proposalButtonStyle('var(--c-green)', '#fff')}>
                      Accept
                    </button>
                    <button onClick={() => void reject(entry)} style={proposalButtonStyle('var(--c-red)', '#fff')}>
                      Reject
                    </button>
                    <button onClick={() => setRefiningId(entry.id)} style={proposalButtonStyle('transparent', 'var(--c-ink-soft)', true)}>
                      Refine
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {resolved.map((entry) => (
          <ResolvedEntryRow
            key={entry.id}
            entry={entry}
            allEntries={entries}
            contradictionReasons={contradictions.get(entry.id)}
            onEdit={() => setFormEntry(entry)}
            onDelete={() => void deleteEntry(entry)}
          />
        ))}
      </div>

      {formEntry !== null && (
        <CodexEntryForm
          entry={formEntry === 'new' ? null : formEntry}
          allEntries={entries}
          onClose={() => setFormEntry(null)}
          onSaved={() => {
            setFormEntry(null)
            refresh()
          }}
        />
      )}
    </div>
  )
}

function ResolvedEntryRow({
  entry,
  allEntries,
  contradictionReasons,
  onEdit,
  onDelete
}: {
  entry: CodexEntry
  allEntries: CodexEntry[]
  contradictionReasons: string[] | undefined
  onEdit: () => void
  onDelete: () => void
}): JSX.Element {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  const byId = new Map(allEntries.map((e) => [e.id, e]))
  const hasDetails = entry.relationships.length > 0 || entry.manuscriptLinks.length > 0
  const sortedHistory = [...entry.history].sort((a, b) => b.changedAt.localeCompare(a.changedAt))

  return (
    <div
      style={{
        padding: '14px 16px',
        borderRadius: 10,
        border: entry.isPrivate ? '1px dashed var(--c-border-strong)' : '1px solid var(--c-border)',
        background: 'var(--c-surface-raised)'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <div>
          <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--c-ink-faint)' }}>
            {TYPE_LABEL[entry.type]}
            {entry.isPrivate && entry.type !== 'private-author-note' ? ' · Private' : ''}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ fontFamily: 'Source Serif 4, serif', fontWeight: 600, fontSize: 15 }}>{entry.name}</div>
            {contradictionReasons && contradictionReasons.length > 0 && (
              <span
                title={contradictionReasons.join('; ')}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 7px',
                  borderRadius: 8,
                  background: 'var(--c-red)',
                  color: '#fff',
                  cursor: 'default'
                }}
              >
                Contradiction
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '3px 9px',
              borderRadius: 10,
              background: 'var(--c-surface)',
              color: STATUS_COLOR[entry.status],
              textTransform: 'capitalize',
              whiteSpace: 'nowrap'
            }}
          >
            {entry.status}
          </span>
          <button onClick={onEdit} style={rowButtonStyle}>
            Edit
          </button>
          <button onClick={onDelete} style={{ ...rowButtonStyle, color: 'var(--c-red)' }}>
            Delete
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        {hasDetails && (
          <button onClick={() => setDetailsOpen((v) => !v)} style={disclosureButtonStyle}>
            {detailsOpen ? 'Hide details ▾' : 'Details ▸'}
          </button>
        )}
        {sortedHistory.length > 0 && (
          <button onClick={() => setHistoryOpen((v) => !v)} style={disclosureButtonStyle}>
            {historyOpen ? 'Hide history ▾' : `History (${sortedHistory.length}) ▸`}
          </button>
        )}
      </div>

      {detailsOpen && hasDetails && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--c-ink-soft)' }}>
          {entry.relationships.length > 0 && (
            <div style={{ marginBottom: entry.manuscriptLinks.length > 0 ? 8 : 0 }}>
              <span style={{ color: 'var(--c-ink-faint)' }}>Relationships: </span>
              {entry.relationships
                .map((rel) => `${rel.kind || 'related to'} ${byId.get(rel.targetEntryId)?.name ?? rel.targetEntryId}`)
                .join(', ')}
            </div>
          )}
          {entry.manuscriptLinks.length > 0 && (
            <div>
              <span style={{ color: 'var(--c-ink-faint)' }}>Manuscript links: </span>
              {entry.manuscriptLinks.length} scene{entry.manuscriptLinks.length === 1 ? '' : 's'}
            </div>
          )}
        </div>
      )}

      {historyOpen && sortedHistory.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sortedHistory.map((version) => (
            <div key={version.versionId} style={{ fontSize: 11.5, color: 'var(--c-ink-soft)' }}>
              <span style={{ color: 'var(--c-ink-faint)' }}>{new Date(version.changedAt).toLocaleString()}</span>{' '}
              · {version.changedBy} · {version.diffSummary}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function proposalButtonStyle(bg: string, color: string, outlined = false): CSSProperties {
  return {
    padding: '6px 14px',
    borderRadius: 7,
    border: outlined ? '1px solid var(--c-border)' : 'none',
    background: bg,
    color,
    fontSize: 12.5,
    cursor: 'pointer'
  }
}

const newEntryButtonStyle: CSSProperties = {
  padding: '7px 16px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--c-accent)',
  color: '#fff',
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
  height: 'fit-content'
}

const rowButtonStyle: CSSProperties = {
  padding: '5px 10px',
  borderRadius: 7,
  border: '1px solid var(--c-border)',
  background: 'transparent',
  color: 'var(--c-ink-soft)',
  fontSize: 12,
  cursor: 'pointer'
}

const disclosureButtonStyle: CSSProperties = {
  fontSize: 11.5,
  padding: '3px 9px',
  borderRadius: 14,
  background: 'transparent',
  border: '1px dashed var(--c-border-strong)',
  color: 'var(--c-ink-faint)',
  cursor: 'pointer'
}
