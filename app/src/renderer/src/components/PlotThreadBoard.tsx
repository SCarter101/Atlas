import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { CodexEntry } from '@shared/schema/codex'
import { getPlotThreadSceneLinks, type PlotThreadSceneLinks } from '@shared/codexLogic'
import { CodexEntryForm } from './CodexEntryForm'
import { useAtlasStore } from '../state/store'

type ThreadType = 'setup' | 'clue' | 'promise' | 'payoff'
type ThreadStatus = 'open' | 'closed'

const COLUMNS: Array<{ key: ThreadType; label: string }> = [
  { key: 'setup', label: 'Setup' },
  { key: 'clue', label: 'Clue' },
  { key: 'promise', label: 'Promise' },
  { key: 'payoff', label: 'Payoff' }
]

function threadType(entry: CodexEntry): ThreadType {
  const value = entry.body.threadType
  return value === 'setup' || value === 'clue' || value === 'promise' || value === 'payoff' ? value : 'setup'
}

function threadStatus(entry: CodexEntry): ThreadStatus {
  return entry.body.status === 'closed' ? 'closed' : 'open'
}

// Groups plot-thread Codex entries (spec: body carries { threadType, status })
// into columns, deriving each card's linked scenes from the manuscript
// tree's own setupIds/payoffIds rather than a redundant field on the thread
// itself — see codexLogic.getPlotThreadSceneLinks.
export function PlotThreadBoard(): JSX.Element {
  const manuscriptTree = useAtlasStore((s) => s.manuscriptTree)
  const [entries, setEntries] = useState<CodexEntry[]>([])
  const [formEntry, setFormEntry] = useState<CodexEntry | null | 'new'>(null)

  function refresh(): void {
    void window.atlas.codex.list({ type: 'plot-thread' }).then(setEntries)
  }
  useEffect(refresh, [])

  const sceneLinks = useMemo(
    () => (manuscriptTree ? getPlotThreadSceneLinks(manuscriptTree) : new Map<string, PlotThreadSceneLinks>()),
    [manuscriptTree]
  )

  const sceneTitleById = useMemo(() => {
    const map = new Map<string, string>()
    for (const book of manuscriptTree?.books ?? []) {
      for (const part of book.parts) {
        for (const chapter of part.chapters) {
          for (const scene of chapter.scenes) map.set(scene.id, scene.title)
        }
      }
    }
    return map
  }, [manuscriptTree])

  async function toggleStatus(entry: CodexEntry): Promise<void> {
    const nextStatus: ThreadStatus = threadStatus(entry) === 'open' ? 'closed' : 'open'
    await window.atlas.codex.upsert({ ...entry, body: { ...entry.body, status: nextStatus }, updatedAt: new Date().toISOString() })
    refresh()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button onClick={() => setFormEntry('new')} style={newThreadButtonStyle}>
          New Thread
        </button>
      </div>

      {entries.length === 0 ? (
        <div style={{ color: 'var(--c-ink-soft)', fontSize: 14, lineHeight: 1.6 }}>
          No plot threads yet. A plot thread is a Codex entry — add one to start tracking setups, clues, promises,
          and payoffs across the manuscript.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(200px, 1fr))', gap: 16, alignItems: 'start' }}>
          {COLUMNS.map((column) => {
            const columnEntries = entries.filter((e) => threadType(e) === column.key)
            return (
              <div key={column.key}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', marginBottom: 10 }}>
                  {column.label} ({columnEntries.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {columnEntries.map((entry) => {
                    const links = sceneLinks.get(entry.id)
                    const status = threadStatus(entry)
                    return (
                      <div key={entry.id} style={threadCardStyle}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <div style={{ fontFamily: 'Source Serif 4, serif', fontWeight: 600, fontSize: 13.5 }}>{entry.name}</div>
                          <button onClick={() => void toggleStatus(entry)} style={statusPillStyle(status)}>
                            {status}
                          </button>
                        </div>
                        <LinkedScenes label="Setup" sceneIds={links?.setupSceneIds} sceneTitleById={sceneTitleById} />
                        <LinkedScenes label="Payoff" sceneIds={links?.payoffSceneIds} sceneTitleById={sceneTitleById} />
                        <button onClick={() => setFormEntry(entry)} style={editThreadButtonStyle}>
                          Edit
                        </button>
                      </div>
                    )
                  })}
                  {columnEntries.length === 0 && <div style={{ fontSize: 11.5, color: 'var(--c-ink-faint)' }}>—</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {formEntry !== null && (
        <CodexEntryForm
          entry={formEntry === 'new' ? null : formEntry}
          allEntries={entries}
          defaultType="plot-thread"
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

function LinkedScenes({
  label,
  sceneIds,
  sceneTitleById
}: {
  label: string
  sceneIds: string[] | undefined
  sceneTitleById: Map<string, string>
}): JSX.Element | null {
  if (!sceneIds || sceneIds.length === 0) return null
  return (
    <div style={{ fontSize: 11.5, color: 'var(--c-ink-soft)', marginTop: 6, lineHeight: 1.5 }}>
      <span style={{ color: 'var(--c-ink-faint)' }}>{label}: </span>
      {sceneIds.map((id) => sceneTitleById.get(id) ?? id).join(', ')}
    </div>
  )
}

const threadCardStyle: CSSProperties = {
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid var(--c-border)',
  background: 'var(--c-surface-raised)'
}

const newThreadButtonStyle: CSSProperties = {
  padding: '7px 16px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--c-accent)',
  color: '#fff',
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer'
}

const editThreadButtonStyle: CSSProperties = {
  marginTop: 8,
  padding: '4px 10px',
  borderRadius: 7,
  border: '1px solid var(--c-border)',
  background: 'transparent',
  color: 'var(--c-ink-soft)',
  fontSize: 11.5,
  cursor: 'pointer'
}

function statusPillStyle(status: ThreadStatus): CSSProperties {
  return {
    flexShrink: 0,
    padding: '2px 9px',
    borderRadius: 10,
    border: 'none',
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: 'capitalize',
    cursor: 'pointer',
    background: status === 'open' ? 'var(--c-amber-soft)' : 'var(--c-surface)',
    color: status === 'open' ? 'var(--c-amber)' : 'var(--c-ink-faint)'
  }
}
