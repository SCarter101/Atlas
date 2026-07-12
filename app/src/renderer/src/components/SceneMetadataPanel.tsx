import { useState, type CSSProperties, type ReactNode } from 'react'
import type { SceneMeta } from '@shared/schema/manuscript'

// Tier 1 is always-visible pills; Tier 2 (Story Craft) and Tier 3
// (Continuity & Threads) are progressive disclosure per spec §5 — hidden
// behind a toggle until the writer needs them, ported from the Phase 1
// prototype's metaOpen/continuityOpen sections.
export function SceneMetadataPanel({ scene }: { scene: SceneMeta }): JSX.Element {
  const [craftOpen, setCraftOpen] = useState(false)
  const [continuityOpen, setContinuityOpen] = useState(false)

  const craftFields = fieldsFor(scene.craft, {
    characterDesire: 'Desire',
    externalGoal: 'External goal',
    internalConflict: 'Internal conflict',
    opposition: 'Opposition',
    stakes: 'Stakes',
    turningPoint: 'Turning point',
    outcome: 'Outcome',
    emotionalShift: 'Emotional shift',
    revealedInformation: 'Revealed information'
  })

  const continuity = scene.continuity
  const continuityFields: { label: string; value: string; fullWidth?: boolean }[] = []
  if (continuity?.timelinePlacement) continuityFields.push({ label: 'Timeline placement', value: continuity.timelinePlacement })
  if (continuity?.setupIds?.length || continuity?.payoffIds?.length) {
    continuityFields.push({ label: 'Setup / payoff', value: [...(continuity.setupIds ?? []), ...(continuity.payoffIds ?? [])].join(', ') })
  }
  if (continuity?.foreshadowingNotes) continuityFields.push({ label: 'Foreshadowing', value: continuity.foreshadowingNotes })
  if (continuity?.themeIds?.length || continuity?.motifIds?.length) {
    continuityFields.push({ label: 'Theme / motif', value: [...(continuity.themeIds ?? []), ...(continuity.motifIds ?? [])].join(', ') })
  }
  if (continuity?.relatedCodexIds?.length) {
    continuityFields.push({ label: 'Relevant Codex', value: continuity.relatedCodexIds.join(', '), fullWidth: true })
  }

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: craftOpen ? 0 : undefined }}>
        {scene.povCharacterId && <Pill>POV: {scene.povCharacterId}</Pill>}
        {scene.locationId && <Pill>{scene.locationId}</Pill>}
        {scene.timeOrDate && <Pill>{scene.timeOrDate}</Pill>}
        {scene.purpose && <Pill>Purpose: {scene.purpose}</Pill>}
        {craftFields.length > 0 && (
          <ToggleChip onClick={() => setCraftOpen((v) => !v)}>{craftOpen ? 'Hide story craft ▾' : 'Story craft ▸'}</ToggleChip>
        )}
      </div>

      {craftOpen && craftFields.length > 0 && (
        <FieldGrid fields={craftFields} style={{ marginTop: 10 }} />
      )}

      {continuityFields.length > 0 && (
        <ToggleChip onClick={() => setContinuityOpen((v) => !v)} style={{ marginTop: 10, marginBottom: continuityOpen ? 0 : undefined }}>
          {continuityOpen ? 'Hide continuity & threads ▾' : 'Continuity & Threads ▸'}
        </ToggleChip>
      )}

      {continuityOpen && continuityFields.length > 0 && <FieldGrid fields={continuityFields} style={{ marginTop: 10 }} />}
    </div>
  )
}

function fieldsFor<T extends object>(values: T | undefined, labels: Partial<Record<keyof T, string>>): { label: string; value: string }[] {
  if (!values) return []
  return (Object.entries(labels) as [keyof T, string][])
    .filter(([key]) => values[key])
    .map(([key, label]) => ({ label, value: String(values[key]) }))
}

function FieldGrid({ fields, style }: { fields: { label: string; value: string; fullWidth?: boolean }[]; style?: CSSProperties }): JSX.Element {
  return (
    <div
      style={{
        border: '1px solid var(--c-border)',
        borderRadius: 10,
        padding: '16px 18px',
        background: 'var(--c-surface)',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '10px 24px',
        fontSize: 12.5,
        ...style
      }}
    >
      {fields.map((f) => (
        <div key={f.label} style={f.fullWidth ? { gridColumn: '1 / -1' } : undefined}>
          <span style={{ color: 'var(--c-ink-faint)' }}>{f.label}:</span> {f.value}
        </div>
      ))}
    </div>
  )
}

function Pill({ children }: { children: ReactNode }): JSX.Element {
  return (
    <span
      style={{
        fontSize: 11.5,
        padding: '4px 10px',
        borderRadius: 14,
        background: 'var(--c-surface)',
        border: '1px solid var(--c-border)',
        color: 'var(--c-ink-soft)'
      }}
    >
      {children}
    </span>
  )
}

function ToggleChip({ children, onClick, style }: { children: ReactNode; onClick: () => void; style?: CSSProperties }): JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 11.5,
        padding: '4px 10px',
        borderRadius: 14,
        background: 'transparent',
        border: '1px dashed var(--c-border-strong)',
        color: 'var(--c-ink-faint)',
        cursor: 'pointer',
        ...style
      }}
    >
      {children}
    </button>
  )
}
