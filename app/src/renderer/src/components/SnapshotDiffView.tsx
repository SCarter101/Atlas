import { useEffect, useState } from 'react'
import type { SnapshotDiffRun } from '@shared/schema/revision'

interface SnapshotOption {
  snapshotId: string
  label?: string
  createdAt: string
}

const CURRENT_OPTION: SnapshotOption = { snapshotId: 'current', label: 'Current draft', createdAt: '' }

function optionLabel(option: SnapshotOption): string {
  if (option.snapshotId === 'current') return 'Current draft'
  const when = new Date(option.createdAt).toLocaleString()
  return option.label ? `${option.label} — ${when}` : when
}

// Standalone snapshot history + diff viewer for a scene. Not yet linked
// from a route/nav entry point — see this wave's report for why — but
// fully functional on its own given a sceneId.
export function SnapshotDiffView({ sceneId }: { sceneId: string }): JSX.Element {
  const [snapshots, setSnapshots] = useState<SnapshotOption[]>([])
  const [idA, setIdA] = useState<string>('')
  const [idB, setIdB] = useState<string>('current')
  const [diff, setDiff] = useState<SnapshotDiffRun[] | null>(null)
  const [saving, setSaving] = useState(false)

  async function refreshSnapshots(): Promise<void> {
    const list = await window.atlas.snapshots.list(sceneId)
    setSnapshots(list)
    if (!idA && list.length > 0) setIdA(list[0].snapshotId)
  }

  useEffect(() => {
    void refreshSnapshots()
    setDiff(null)
  }, [sceneId])

  async function handleSaveSnapshot(): Promise<void> {
    setSaving(true)
    try {
      const { prose } = await window.atlas.scenes.read(sceneId)
      const label = window.prompt('Label this snapshot (optional):') ?? undefined
      await window.atlas.snapshots.create(sceneId, prose, label || undefined)
      await refreshSnapshots()
    } finally {
      setSaving(false)
    }
  }

  async function handleCompare(): Promise<void> {
    if (!idA || !idB) return
    const runs = await window.atlas.snapshots.diff(sceneId, idA, idB)
    setDiff(runs)
  }

  const options: SnapshotOption[] = [...snapshots, CURRENT_OPTION]

  return (
    <div style={{ border: '1px solid var(--c-border)', borderRadius: 10, padding: 14, background: 'var(--c-surface-raised)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)' }}>
          Revision history
        </div>
        <button onClick={() => void handleSaveSnapshot()} disabled={saving} style={buttonStyle()}>
          {saving ? 'Saving…' : 'Save snapshot'}
        </button>
      </div>

      {snapshots.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--c-ink-faint)' }}>No snapshots yet for this scene.</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <select value={idA} onChange={(e) => setIdA(e.target.value)} style={selectStyle()}>
              <option value="" disabled>
                Select a snapshot…
              </option>
              {options.map((opt) => (
                <option key={opt.snapshotId} value={opt.snapshotId}>
                  {optionLabel(opt)}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 12, color: 'var(--c-ink-faint)', alignSelf: 'center' }}>vs</span>
            <select value={idB} onChange={(e) => setIdB(e.target.value)} style={selectStyle()}>
              <option value="" disabled>
                Select a snapshot…
              </option>
              {options.map((opt) => (
                <option key={opt.snapshotId} value={opt.snapshotId}>
                  {optionLabel(opt)}
                </option>
              ))}
            </select>
            <button onClick={() => void handleCompare()} style={buttonStyle(true)}>
              Compare
            </button>
          </div>

          {diff && (
            <div style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {diff.map((run, i) => (
                <span key={i} style={diffRunStyle(run.type)}>
                  {run.text}{' '}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function diffRunStyle(type: SnapshotDiffRun['type']) {
  if (type === 'add') {
    return { background: 'var(--c-green-soft)', color: 'var(--c-green)', textDecoration: 'underline' }
  }
  if (type === 'remove') {
    return { background: 'var(--c-red-soft)', color: 'var(--c-red)', textDecoration: 'line-through' }
  }
  return {}
}

function selectStyle() {
  return {
    fontSize: 12,
    padding: '6px 8px',
    borderRadius: 6,
    border: '1px solid var(--c-border)',
    background: 'var(--c-bg)',
    color: 'var(--c-ink)'
  } as const
}

function buttonStyle(filled = false) {
  return {
    padding: '6px 12px',
    borderRadius: 6,
    border: filled ? 'none' : '1px solid var(--c-border)',
    background: filled ? 'var(--c-accent)' : 'transparent',
    color: filled ? '#fff' : 'var(--c-ink-soft)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  } as const
}
