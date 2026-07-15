import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { CodexEntry } from '@shared/schema/codex'
import type { SceneContinuityMeta, SceneMeta } from '@shared/schema/manuscript'
import { useAtlasStore } from '../state/store'

const CONFLICT_LEVELS = [1, 2, 3, 4, 5]
const SEASON_OPTIONS: NonNullable<SceneContinuityMeta['season']>[] = ['spring', 'summer', 'autumn', 'winter']

// Tier 1 is always-visible pills; Tier 2 (Story Craft) and Tier 3
// (Continuity & Threads) are progressive disclosure per spec §5 — hidden
// behind a toggle until the writer needs them, ported from the Phase 1
// prototype's metaOpen/continuityOpen sections.
export function SceneMetadataPanel({ scene }: { scene: SceneMeta }): JSX.Element {
  const [craftOpen, setCraftOpen] = useState(false)
  const [continuityOpen, setContinuityOpen] = useState(false)
  const [presenceEditorOpen, setPresenceEditorOpen] = useState(false)
  const [characters, setCharacters] = useState<CodexEntry[]>([])
  const updateSceneMeta = useAtlasStore((s) => s.updateSceneMeta)

  useEffect(() => {
    void window.atlas.codex.list({ type: 'character' }).then(setCharacters)
  }, [])

  const presentIds = scene.presentCharacterIds ?? []
  const presentCharacters = characters.filter((c) => presentIds.includes(c.id))

  function togglePresent(characterId: string): void {
    const next = presentIds.includes(characterId)
      ? presentIds.filter((id) => id !== characterId)
      : [...presentIds, characterId]
    void updateSceneMeta(scene.id, { presentCharacterIds: next })
  }

  function setConflictLevel(level: number | undefined): void {
    void updateSceneMeta(scene.id, { craft: { ...scene.craft, conflictLevel: level } })
  }

  function toggleLocalModelOnly(): void {
    void updateSceneMeta(scene.id, { localModelOnly: !scene.localModelOnly })
  }

  // Phase 9 continuity validators (shared/continuityChecks.ts) — storyDate/
  // season/isFlashback feed the Timeline's "Continuity Checks" tab.
  //
  // Codex adversarial-review fix (Round 11): updateSceneMeta is async and
  // this panel doesn't re-render with a fresh `scene` prop until it resolves
  // (via refreshManuscriptTree()), so closing over `scene.continuity`
  // directly would let two quick edits (e.g. storyDate then season) race —
  // the second call's spread would merge against the first call's *stale*
  // pre-edit continuity object and silently drop it. continuityRef tracks
  // the latest intended value synchronously across calls, independent of
  // when the prop actually catches up; the effect below resyncs it whenever
  // the authoritative prop changes (e.g. a fresh scene, or another writer
  // surface editing the same scene's continuity fields).
  const continuityRef = useRef(scene.continuity)
  useEffect(() => {
    continuityRef.current = scene.continuity
  }, [scene.continuity])

  function updateContinuityField(patch: Partial<SceneContinuityMeta>): void {
    const next = { ...continuityRef.current, ...patch }
    continuityRef.current = next
    void updateSceneMeta(scene.id, { continuity: next })
  }

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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: craftOpen || presenceEditorOpen ? 0 : undefined }}>
        {scene.povCharacterId && <Pill>POV: {scene.povCharacterId}</Pill>}
        {scene.locationId && <Pill>{scene.locationId}</Pill>}
        {scene.timeOrDate && <Pill>{scene.timeOrDate}</Pill>}
        {scene.purpose && <Pill>Purpose: {scene.purpose}</Pill>}
        {presentCharacters.map((c) => (
          <Pill key={c.id}>{c.name}</Pill>
        ))}
        <ToggleChip onClick={toggleLocalModelOnly} selected={scene.localModelOnly === true}>
          Local model only
        </ToggleChip>
        <ToggleChip onClick={() => setPresenceEditorOpen((v) => !v)}>
          {presenceEditorOpen ? 'Hide characters ▾' : presentCharacters.length > 0 ? 'Edit characters ▸' : 'Characters present ▸'}
        </ToggleChip>
        <ToggleChip onClick={() => setCraftOpen((v) => !v)}>{craftOpen ? 'Hide story craft ▾' : 'Story craft ▸'}</ToggleChip>
      </div>

      {presenceEditorOpen && (
        <div
          style={{
            marginTop: 10,
            padding: '12px 14px',
            border: '1px solid var(--c-border)',
            borderRadius: 10,
            background: 'var(--c-surface)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6
          }}
        >
          {characters.length === 0 ? (
            <span style={{ fontSize: 12, color: 'var(--c-ink-faint)' }}>No characters in the Codex yet.</span>
          ) : (
            characters.map((c) => (
              <button key={c.id} onClick={() => togglePresent(c.id)} style={presenceOptionStyle(presentIds.includes(c.id))}>
                {c.name}
              </button>
            ))
          )}
        </div>
      )}

      {craftOpen && (
        <div style={{ marginTop: 10 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 14px',
              border: '1px solid var(--c-border)',
              borderRadius: 10,
              background: 'var(--c-surface)',
              marginBottom: craftFields.length > 0 ? 10 : 0
            }}
          >
            <span style={{ fontSize: 11.5, color: 'var(--c-ink-faint)' }}>Conflict level (tension this scene):</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {CONFLICT_LEVELS.map((level) => (
                <button
                  key={level}
                  onClick={() => setConflictLevel(scene.craft?.conflictLevel === level ? undefined : level)}
                  style={conflictLevelOptionStyle(scene.craft?.conflictLevel === level)}
                  title={`Set conflict level to ${level}`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
          {craftFields.length > 0 && <FieldGrid fields={craftFields} />}
        </div>
      )}

      <ToggleChip onClick={() => setContinuityOpen((v) => !v)} style={{ marginTop: 10, marginBottom: continuityOpen ? 0 : undefined }}>
        {continuityOpen ? 'Hide continuity & threads ▾' : 'Continuity & Threads ▸'}
      </ToggleChip>

      {continuityOpen && (
        <div style={{ marginTop: 10 }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 14,
              padding: '10px 14px',
              border: '1px solid var(--c-border)',
              borderRadius: 10,
              background: 'var(--c-surface)',
              marginBottom: continuityFields.length > 0 ? 10 : 0
            }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--c-ink-faint)' }}>
              Story date:
              <input
                type="date"
                value={continuity?.storyDate ?? ''}
                onChange={(e) => updateContinuityField({ storyDate: e.target.value || undefined })}
                style={dateInputStyle}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--c-ink-faint)' }}>
              Season:
              <select
                value={continuity?.season ?? ''}
                onChange={(e) =>
                  updateContinuityField({ season: (e.target.value || undefined) as SceneContinuityMeta['season'] })
                }
                style={dateInputStyle}
              >
                <option value="">Unset</option>
                {SEASON_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <ToggleChip
              onClick={() => updateContinuityField({ isFlashback: !continuity?.isFlashback })}
              selected={continuity?.isFlashback === true}
            >
              Flashback
            </ToggleChip>
          </div>
          {continuityFields.length > 0 && <FieldGrid fields={continuityFields} />}
        </div>
      )}
    </div>
  )
}

const dateInputStyle: CSSProperties = {
  padding: '4px 8px',
  borderRadius: 6,
  border: '1px solid var(--c-border)',
  background: 'var(--c-surface-raised)',
  color: 'var(--c-ink)',
  fontSize: 11.5
}

function presenceOptionStyle(selected: boolean): CSSProperties {
  return {
    fontSize: 12,
    padding: '5px 11px',
    borderRadius: 14,
    border: `1px solid ${selected ? 'var(--c-accent)' : 'var(--c-border)'}`,
    background: selected ? 'var(--c-accent-soft)' : 'var(--c-surface-raised)',
    color: selected ? 'var(--c-accent-text)' : 'var(--c-ink-soft)',
    cursor: 'pointer',
    fontWeight: selected ? 600 : 400
  }
}

function conflictLevelOptionStyle(selected: boolean): CSSProperties {
  return {
    width: 24,
    height: 24,
    borderRadius: '50%',
    border: `1px solid ${selected ? 'var(--c-accent)' : 'var(--c-border)'}`,
    background: selected ? 'var(--c-accent)' : 'var(--c-surface-raised)',
    color: selected ? '#fff' : 'var(--c-ink-soft)',
    fontSize: 11.5,
    fontWeight: 600,
    cursor: 'pointer',
    padding: 0
  }
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

function ToggleChip({
  children,
  onClick,
  selected,
  style
}: {
  children: ReactNode
  onClick: () => void
  selected?: boolean
  style?: CSSProperties
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={selected ? 'Local model only - never send this scene to a cloud model' : undefined}
      style={{
        fontSize: 11.5,
        padding: '4px 10px',
        borderRadius: 14,
        background: selected ? 'var(--c-amber-soft)' : 'transparent',
        border: selected ? '1px solid var(--c-amber)' : '1px dashed var(--c-border-strong)',
        color: selected ? 'var(--c-amber)' : 'var(--c-ink-faint)',
        fontWeight: selected ? 600 : 400,
        cursor: 'pointer',
        ...style
      }}
    >
      {children}
    </button>
  )
}
