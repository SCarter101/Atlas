import { useState, type CSSProperties, type ReactNode } from 'react'
import type {
  CharacterContinuityProfile,
  CharacterVoiceProfile,
  CodexEntry,
  CodexEntryType,
  CodexRelationship,
  FactStatus,
  ManuscriptLink
} from '@shared/schema/codex'
import type { ManuscriptTree } from '@shared/schema/manuscript'
import { TYPE_LABEL } from '../lib/codexLabels'
import { useAtlasStore } from '../state/store'

const ALL_TYPES = Object.keys(TYPE_LABEL) as CodexEntryType[]
const STATUS_OPTIONS: FactStatus[] = ['canon', 'tentative', 'deprecated', 'contradicted']
const SPEECH_DIRECTNESS_OPTIONS: NonNullable<CharacterVoiceProfile['speechDirectness']>[] = [
  'indirect',
  'balanced',
  'direct'
]
const FORMALITY_OPTIONS: NonNullable<CharacterVoiceProfile['formalityLevel']>[] = ['casual', 'neutral', 'formal']

function listToText(values: string[] | undefined): string {
  return (values ?? []).join(', ')
}

function textToList(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
}

interface SceneOption {
  id: string
  label: string
}

function flattenSceneOptions(tree: ManuscriptTree | null): SceneOption[] {
  const options: SceneOption[] = []
  for (const book of tree?.books ?? []) {
    for (const part of book.parts) {
      for (const chapter of part.chapters) {
        for (const scene of chapter.scenes) {
          options.push({ id: scene.id, label: scene.title })
        }
      }
    }
  }
  return options
}

interface BodyRow {
  key: string
  value: string
}

function bodyToRows(body: Record<string, unknown>): BodyRow[] {
  return Object.entries(body).map(([key, value]) => ({
    key,
    value: typeof value === 'string' ? value : String(value ?? '')
  }))
}

function rowsToBody(rows: BodyRow[]): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  for (const row of rows) {
    if (!row.key.trim()) continue
    body[row.key.trim()] = row.value
  }
  return body
}

export function CodexEntryForm({
  entry,
  allEntries,
  onClose,
  onSaved,
  defaultType
}: {
  entry: CodexEntry | null
  allEntries: CodexEntry[]
  onClose: () => void
  onSaved: () => void
  // Lets a caller like the Plot Thread board pre-select its own type when
  // opening this same generic form for a brand-new entry, instead of every
  // "new" entry defaulting to 'character' regardless of context.
  defaultType?: CodexEntryType
}): JSX.Element {
  const manuscriptTree = useAtlasStore((s) => s.manuscriptTree)
  const sceneOptions = flattenSceneOptions(manuscriptTree)

  const [name, setName] = useState(entry?.name ?? '')
  const [type, setType] = useState<CodexEntryType>(entry?.type ?? defaultType ?? 'character')
  const [status, setStatus] = useState<FactStatus>(entry?.status ?? 'tentative')
  const [isPrivate, setIsPrivate] = useState(entry?.isPrivate ?? false)
  const [localModelOnly, setLocalModelOnly] = useState(entry?.localModelOnly ?? false)
  const [locked, setLocked] = useState(entry?.locked ?? false)
  const [bodyRows, setBodyRows] = useState<BodyRow[]>(entry ? bodyToRows(entry.body) : [])
  const [relationships, setRelationships] = useState<CodexRelationship[]>(entry?.relationships ?? [])
  const [manuscriptLinks, setManuscriptLinks] = useState<ManuscriptLink[]>(entry?.manuscriptLinks ?? [])
  const [spoilerRevealSceneId, setSpoilerRevealSceneId] = useState<string | undefined>(entry?.spoilerRevealSceneId)
  const [saving, setSaving] = useState(false)

  // Spec §7.4 "Dialogue Editor should use character voice profiles from the
  // Codex" — only relevant/shown when type === 'character' (see the
  // conditional section below), but kept in state unconditionally so
  // switching the type dropdown back and forth doesn't lose what's typed.
  const [voiceProfile, setVoiceProfile] = useState<CharacterVoiceProfile>(entry?.voiceProfile ?? {})

  function updateVoiceProfile(patch: Partial<CharacterVoiceProfile>): void {
    setVoiceProfile((v) => ({ ...v, ...patch }))
  }

  // Phase 9 continuity validators (shared/continuityChecks.ts) — only
  // relevant/shown for type === 'character' (birth date + injuries) and
  // type === 'location' (travel links), same "kept in state unconditionally
  // so switching the type dropdown doesn't lose what's typed" treatment as
  // voiceProfile above.
  const [continuityProfile, setContinuityProfile] = useState<CharacterContinuityProfile>(
    entry?.continuityProfile ?? {}
  )
  const [travelLinks, setTravelLinks] = useState<NonNullable<CodexEntry['travelLinks']>>(entry?.travelLinks ?? [])

  const injuries = continuityProfile.injuries ?? []

  function addInjury(): void {
    setContinuityProfile((p) => ({
      ...p,
      injuries: [...(p.injuries ?? []), { id: crypto.randomUUID(), description: '' }]
    }))
  }

  function updateInjury(id: string, patch: Partial<NonNullable<CharacterContinuityProfile['injuries']>[number]>): void {
    setContinuityProfile((p) => ({
      ...p,
      injuries: (p.injuries ?? []).map((inj) => (inj.id === id ? { ...inj, ...patch } : inj))
    }))
  }

  function removeInjury(id: string): void {
    setContinuityProfile((p) => ({ ...p, injuries: (p.injuries ?? []).filter((inj) => inj.id !== id) }))
  }

  const locationTargets = allEntries.filter((e) => e.type === 'location' && e.id !== entry?.id)

  function addTravelLink(): void {
    if (locationTargets.length === 0) return
    if (travelLinks.some((l) => l.locationId === locationTargets[0].id)) return
    setTravelLinks((links) => [...links, { locationId: locationTargets[0].id, days: 1 }])
  }

  function updateTravelLink(locationId: string, patch: Partial<{ locationId: string; days: number }>): void {
    setTravelLinks((links) => links.map((l) => (l.locationId === locationId ? { ...l, ...patch } : l)))
  }

  function removeTravelLink(locationId: string): void {
    setTravelLinks((links) => links.filter((l) => l.locationId !== locationId))
  }

  const relationshipTargets = allEntries.filter((e) => e.id !== entry?.id)

  function updateRelationship(id: string, patch: Partial<CodexRelationship>): void {
    setRelationships((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  function addRelationship(): void {
    if (relationshipTargets.length === 0) return
    setRelationships((rows) => [
      ...rows,
      { id: crypto.randomUUID(), targetEntryId: relationshipTargets[0].id, kind: '' }
    ])
  }

  function addManuscriptLink(sceneId: string): void {
    if (!sceneId || manuscriptLinks.some((l) => l.sceneId === sceneId)) return
    setManuscriptLinks((links) => [...links, { sceneId }])
  }

  async function handleSubmit(): Promise<void> {
    if (!name.trim() || saving) return
    setSaving(true)
    const now = new Date().toISOString()
    const nextEntry: CodexEntry = {
      schemaVersion: 1,
      id: entry?.id ?? crypto.randomUUID(),
      type,
      name: name.trim(),
      status,
      body: rowsToBody(bodyRows),
      isPrivate,
      localModelOnly,
      locked,
      source: entry?.source ?? 'author',
      approvedAt: entry?.approvedAt,
      relationships,
      manuscriptLinks,
      spoilerRevealSceneId,
      voiceProfile: type === 'character' && Object.keys(voiceProfile).length > 0 ? voiceProfile : undefined,
      continuityProfile:
        type === 'character' && (continuityProfile.birthDate || (continuityProfile.injuries ?? []).length > 0)
          ? continuityProfile
          : undefined,
      travelLinks: type === 'location' && travelLinks.length > 0 ? travelLinks : undefined,
      createdAt: entry?.createdAt ?? now,
      updatedAt: now,
      history: entry?.history ?? []
    }
    await window.atlas.codex.upsert(nextEntry)
    setSaving(false)
    onSaved()
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100
      }}
    >
      <div
        style={{
          width: 560,
          maxHeight: '85vh',
          overflowY: 'auto',
          padding: 24,
          borderRadius: 14,
          background: 'var(--c-surface-raised)',
          border: '1px solid var(--c-border)'
        }}
      >
        <div style={{ fontFamily: 'Source Serif 4, serif', fontWeight: 600, fontSize: 18, marginBottom: 18 }}>
          {entry ? 'Edit Codex Entry' : 'New Codex Entry'}
        </div>

        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="Entry name" />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Type">
            <select value={type} onChange={(e) => setType(e.target.value as CodexEntryType)} style={inputStyle}>
              {ALL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value as FactStatus)} style={inputStyle}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '16px 0' }}>
          <ToggleRow label="Private" checked={isPrivate} onChange={() => setIsPrivate((v) => !v)} />
          <ToggleRow label="Local model only" checked={localModelOnly} onChange={() => setLocalModelOnly((v) => !v)} />
          <ToggleRow label="Locked" checked={locked} onChange={() => setLocked((v) => !v)} />
        </div>

        <SectionLabel>Body</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
          {bodyRows.map((row, i) => (
            <div key={i} style={{ display: 'flex', gap: 8 }}>
              <input
                value={row.key}
                onChange={(e) =>
                  setBodyRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, key: e.target.value } : r)))
                }
                placeholder="Field"
                style={{ ...inputStyle, flex: 1 }}
              />
              <input
                value={row.value}
                onChange={(e) =>
                  setBodyRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, value: e.target.value } : r)))
                }
                placeholder="Value"
                style={{ ...inputStyle, flex: 2 }}
              />
              <RemoveButton onClick={() => setBodyRows((rows) => rows.filter((_, idx) => idx !== i))} />
            </div>
          ))}
          <AddButton onClick={() => setBodyRows((rows) => [...rows, { key: '', value: '' }])}>Add field</AddButton>
        </div>

        {type === 'character' && (
          <>
            <SectionLabel>Voice profile</SectionLabel>
            <div style={{ fontSize: 11.5, color: 'var(--c-ink-faint)', marginBottom: 10, lineHeight: 1.5 }}>
              Used by the Dialogue Editor to compare this character's lines against their established voice and to
              generate tension-varied alternatives (spec §7.4).
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 10 }}>
              <Field label="Vocabulary">
                <input
                  value={voiceProfile.vocabulary ?? ''}
                  onChange={(e) => updateVoiceProfile({ vocabulary: e.target.value || undefined })}
                  style={inputStyle}
                  placeholder="e.g. plain, working-class"
                />
              </Field>
              <Field label="Rhythm">
                <input
                  value={voiceProfile.rhythm ?? ''}
                  onChange={(e) => updateVoiceProfile({ rhythm: e.target.value || undefined })}
                  style={inputStyle}
                  placeholder="e.g. short, clipped sentences"
                />
              </Field>
              <Field label="Education level">
                <input
                  value={voiceProfile.educationLevel ?? ''}
                  onChange={(e) => updateVoiceProfile({ educationLevel: e.target.value || undefined })}
                  style={inputStyle}
                />
              </Field>
              <Field label="Humor style">
                <input
                  value={voiceProfile.humorStyle ?? ''}
                  onChange={(e) => updateVoiceProfile({ humorStyle: e.target.value || undefined })}
                  style={inputStyle}
                />
              </Field>
              <Field label="Emotional guardedness">
                <input
                  value={voiceProfile.emotionalGuardedness ?? ''}
                  onChange={(e) => updateVoiceProfile({ emotionalGuardedness: e.target.value || undefined })}
                  style={inputStyle}
                />
              </Field>
              <Field label="Accent or dialect notes">
                <input
                  value={voiceProfile.accentOrDialect ?? ''}
                  onChange={(e) => updateVoiceProfile({ accentOrDialect: e.target.value || undefined })}
                  style={inputStyle}
                />
              </Field>
              <Field label="Speech directness">
                <select
                  value={voiceProfile.speechDirectness ?? ''}
                  onChange={(e) =>
                    updateVoiceProfile({
                      speechDirectness: (e.target.value || undefined) as CharacterVoiceProfile['speechDirectness']
                    })
                  }
                  style={inputStyle}
                >
                  <option value="">Unspecified</option>
                  {SPEECH_DIRECTNESS_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Formality level">
                <select
                  value={voiceProfile.formalityLevel ?? ''}
                  onChange={(e) =>
                    updateVoiceProfile({
                      formalityLevel: (e.target.value || undefined) as CharacterVoiceProfile['formalityLevel']
                    })
                  }
                  style={inputStyle}
                >
                  <option value="">Unspecified</option>
                  {FORMALITY_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Power dynamics">
                <input
                  value={voiceProfile.powerDynamics ?? ''}
                  onChange={(e) => updateVoiceProfile({ powerDynamics: e.target.value || undefined })}
                  style={inputStyle}
                  placeholder="e.g. defers to authority, needles peers"
                />
              </Field>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              <Field label="Verbal tics (comma-separated)">
                <input
                  value={listToText(voiceProfile.verbalTics)}
                  onChange={(e) => updateVoiceProfile({ verbalTics: textToList(e.target.value) })}
                  style={inputStyle}
                  placeholder="e.g. you know, listen, anyway"
                />
              </Field>
              <Field label="Taboo topics (comma-separated)">
                <input
                  value={listToText(voiceProfile.tabooTopics)}
                  onChange={(e) => updateVoiceProfile({ tabooTopics: textToList(e.target.value) })}
                  style={inputStyle}
                />
              </Field>
              <Field label="Favorite phrases (comma-separated)">
                <input
                  value={listToText(voiceProfile.favoritePhrases)}
                  onChange={(e) => updateVoiceProfile({ favoritePhrases: textToList(e.target.value) })}
                  style={inputStyle}
                />
              </Field>
              <Field label="Avoided phrases (comma-separated)">
                <input
                  value={listToText(voiceProfile.avoidedPhrases)}
                  onChange={(e) => updateVoiceProfile({ avoidedPhrases: textToList(e.target.value) })}
                  style={inputStyle}
                />
              </Field>
            </div>

            <SectionLabel>Continuity</SectionLabel>
            <div style={{ fontSize: 11.5, color: 'var(--c-ink-faint)', marginBottom: 10, lineHeight: 1.5 }}>
              Feeds the Timeline's continuity checks (age and injury/healing consistency) — see Timeline → Continuity
              Checks.
            </div>
            <Field label="Birth date">
              <input
                type="date"
                value={continuityProfile.birthDate ?? ''}
                onChange={(e) =>
                  setContinuityProfile((p) => ({ ...p, birthDate: e.target.value || undefined }))
                }
                style={inputStyle}
              />
            </Field>
            <div style={{ fontSize: 11.5, color: 'var(--c-ink-faint)', marginBottom: 6 }}>Injuries</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {injuries.map((injury) => (
                <div
                  key={injury.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    padding: 10,
                    borderRadius: 8,
                    border: '1px solid var(--c-border)'
                  }}
                >
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      value={injury.description}
                      onChange={(e) => updateInjury(injury.id, { description: e.target.value })}
                      placeholder="Injury description"
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    <RemoveButton onClick={() => removeInjury(injury.id)} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <select
                      value={injury.occurredSceneId ?? ''}
                      onChange={(e) => updateInjury(injury.id, { occurredSceneId: e.target.value || undefined })}
                      style={inputStyle}
                    >
                      <option value="">Occurred in scene…</option>
                      {sceneOptions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="date"
                      value={injury.occurredDate ?? ''}
                      onChange={(e) => updateInjury(injury.id, { occurredDate: e.target.value || undefined })}
                      style={inputStyle}
                      placeholder="Occurred date"
                    />
                    <select
                      value={injury.healedSceneId ?? ''}
                      onChange={(e) => updateInjury(injury.id, { healedSceneId: e.target.value || undefined })}
                      style={inputStyle}
                    >
                      <option value="">Healed in scene…</option>
                      {sceneOptions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="date"
                      value={injury.healedDate ?? ''}
                      onChange={(e) => updateInjury(injury.id, { healedDate: e.target.value || undefined })}
                      style={inputStyle}
                      placeholder="Healed date"
                    />
                  </div>
                </div>
              ))}
              <AddButton onClick={addInjury}>Add injury</AddButton>
            </div>
          </>
        )}

        {type === 'location' && (
          <>
            <SectionLabel>Travel links</SectionLabel>
            <div style={{ fontSize: 11.5, color: 'var(--c-ink-faint)', marginBottom: 10, lineHeight: 1.5 }}>
              Known one-way travel times to other locations — feeds the Timeline's travel-time continuity check.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {travelLinks.map((link) => (
                <div key={link.locationId} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    value={link.locationId}
                    onChange={(e) => {
                      const nextId = e.target.value
                      // Codex adversarial-review fix (Round 11): retargeting
                      // a row to a location another row already links to
                      // would leave two rows keyed by the same locationId —
                      // a React key collision, and updateTravelLink/
                      // removeTravelLink (both keyed by locationId) would
                      // then apply to both rows at once. Same duplicate-
                      // prevention addTravelLink already applies when adding
                      // a new row.
                      if (travelLinks.some((l) => l.locationId !== link.locationId && l.locationId === nextId)) return
                      setTravelLinks((links) =>
                        links.map((l) => (l.locationId === link.locationId ? { ...l, locationId: nextId } : l))
                      )
                    }}
                    style={{ ...inputStyle, flex: 2 }}
                  >
                    {locationTargets.map((target) => (
                      <option key={target.id} value={target.id}>
                        {target.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    value={link.days}
                    onChange={(e) => updateTravelLink(link.locationId, { days: Number(e.target.value) || 0 })}
                    style={{ ...inputStyle, flex: 1 }}
                    placeholder="Days"
                  />
                  <span style={{ fontSize: 11.5, color: 'var(--c-ink-faint)', flexShrink: 0 }}>days</span>
                  <RemoveButton onClick={() => removeTravelLink(link.locationId)} />
                </div>
              ))}
              <AddButton onClick={addTravelLink} disabled={locationTargets.length === 0}>
                Add travel link
              </AddButton>
            </div>
          </>
        )}

        <SectionLabel>Relationships</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
          {relationships.map((rel) => (
            <div key={rel.id} style={{ display: 'flex', gap: 8 }}>
              <select
                value={rel.targetEntryId}
                onChange={(e) => updateRelationship(rel.id, { targetEntryId: e.target.value })}
                style={{ ...inputStyle, flex: 2 }}
              >
                {relationshipTargets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.name}
                  </option>
                ))}
              </select>
              <input
                value={rel.kind}
                onChange={(e) => updateRelationship(rel.id, { kind: e.target.value })}
                placeholder="kind"
                style={{ ...inputStyle, flex: 1 }}
              />
              <input
                value={rel.notes ?? ''}
                onChange={(e) => updateRelationship(rel.id, { notes: e.target.value })}
                placeholder="notes (optional)"
                style={{ ...inputStyle, flex: 1 }}
              />
              <RemoveButton onClick={() => setRelationships((rows) => rows.filter((r) => r.id !== rel.id))} />
            </div>
          ))}
          <AddButton onClick={addRelationship} disabled={relationshipTargets.length === 0}>
            Add relationship
          </AddButton>
        </div>

        <SectionLabel>Manuscript links</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {manuscriptLinks.map((link) => (
            <div
              key={link.sceneId}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5 }}
            >
              <span>{sceneOptions.find((s) => s.id === link.sceneId)?.label ?? link.sceneId}</span>
              <RemoveButton
                onClick={() => setManuscriptLinks((links) => links.filter((l) => l.sceneId !== link.sceneId))}
              />
            </div>
          ))}
          <select
            value=""
            onChange={(e) => addManuscriptLink(e.target.value)}
            style={inputStyle}
          >
            <option value="">Link to scene…</option>
            {sceneOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <SectionLabel>Spoiler reveal scene</SectionLabel>
        <select
          value={spoilerRevealSceneId ?? ''}
          onChange={(e) => setSpoilerRevealSceneId(e.target.value || undefined)}
          style={{ ...inputStyle, marginBottom: 20 }}
        >
          <option value="">No reveal restriction</option>
          {sceneOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={buttonStyle(false)}>
            Cancel
          </button>
          <button onClick={() => void handleSubmit()} disabled={saving || !name.trim()} style={buttonStyle(true)}>
            {entry ? 'Save changes' : 'Create entry'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11.5, color: 'var(--c-ink-faint)', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: 'var(--c-ink-faint)',
        marginBottom: 8
      }}
    >
      {children}
    </div>
  )
}

function AddButton({
  children,
  onClick,
  disabled
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        alignSelf: 'flex-start',
        padding: '5px 12px',
        borderRadius: 7,
        border: '1px dashed var(--c-border-strong)',
        background: 'transparent',
        color: 'var(--c-ink-soft)',
        fontSize: 12,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1
      }}
    >
      {children}
    </button>
  )
}

function RemoveButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        border: 'none',
        background: 'transparent',
        color: 'var(--c-red)',
        fontSize: 12,
        cursor: 'pointer',
        flexShrink: 0
      }}
    >
      Remove
    </button>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }): JSX.Element {
  return (
    <button
      onClick={onChange}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        padding: 0,
        width: '100%',
        textAlign: 'left'
      }}
    >
      <Switch checked={checked} />
      <span style={{ fontSize: 13, color: 'var(--c-ink)' }}>{label}</span>
    </button>
  )
}

function Switch({ checked }: { checked: boolean }): JSX.Element {
  return (
    <span
      role="switch"
      aria-checked={checked}
      style={{
        width: 36,
        height: 20,
        borderRadius: 999,
        background: checked ? 'var(--c-accent)' : 'var(--c-border)',
        position: 'relative',
        flexShrink: 0,
        transition: 'background 150ms ease-out'
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 150ms ease-out'
        }}
      />
    </span>
  )
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  borderRadius: 7,
  border: '1px solid var(--c-border)',
  background: 'var(--c-surface)',
  color: 'var(--c-ink)',
  fontSize: 12.5
}

function buttonStyle(primary: boolean): CSSProperties {
  return {
    padding: '8px 16px',
    borderRadius: 8,
    fontSize: 12.5,
    fontWeight: primary ? 600 : 400,
    cursor: 'pointer',
    border: primary ? 'none' : '1px solid var(--c-border)',
    background: primary ? 'var(--c-accent)' : 'var(--c-surface)',
    color: primary ? '#fff' : 'var(--c-ink)'
  }
}
