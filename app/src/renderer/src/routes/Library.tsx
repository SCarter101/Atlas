import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { AgentRole } from '@shared/schema/agent'
import type {
  CapabilityManifest,
  CapabilitySideEffects,
  CapabilityScope,
  CapabilityType,
  JsonSchema,
  LifecycleState
} from '@shared/schema/capability'
import { useAtlasStore } from '../state/store'

type ScopeFilter = 'All' | 'Global' | 'Project'
type TypeFilter = 'All' | 'Tool' | 'Skill'

const ALL_ROLES: AgentRole[] = ['Generator', 'Dev-Editor', 'Line-Editor', 'Dialoguer', 'World-Builder']
const SIDE_EFFECTS_OPTIONS: CapabilitySideEffects[] = ['none', 'reads-project', 'writes-project', 'network', 'filesystem-external']

function blankManifest(): CapabilityManifest {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    name: '',
    description: '',
    type: 'tool',
    scope: 'project',
    owner: 'Author',
    version: '1.0.0',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    requiredContext: [],
    dependsOn: [],
    compatibleAgentRoles: [],
    compatibleModelCapabilities: [],
    sideEffects: 'none',
    permissionCategory: 'none',
    localOnly: false,
    costCharacteristics: {},
    validationStatus: 'untested',
    lifecycleState: 'draft',
    createdBy: 'author',
    history: [{ versionId: 'v1', changedAt: now, note: 'Initial creation.' }]
  }
}

function schemaSignature(schema: JsonSchema): string {
  if (!schema.properties) return '—'
  return Object.entries(schema.properties)
    .map(([key, value]) => {
      const type = value.type === 'array' ? `${value.items?.type ?? 'object'}[]` : (value.type ?? 'unknown')
      return `${key}: ${type}`
    })
    .join(', ')
}

function costSummary(cost: CapabilityManifest['costCharacteristics']): string {
  if (cost.estCostUsd !== undefined) return `~$${cost.estCostUsd.toFixed(2)} per call`
  if (cost.estTokens !== undefined) return `~${cost.estTokens} tokens`
  if (cost.estTimeMs !== undefined) return `~${(cost.estTimeMs / 1000).toFixed(1)}s`
  return '—'
}

export function Library(): JSX.Element {
  const advancedMode = useAtlasStore((s) => s.advancedMode)
  const [manifests, setManifests] = useState<CapabilityManifest[]>([])
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('All')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('All')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [formMode, setFormMode] = useState<'closed' | 'create' | 'edit'>('closed')

  function refresh(preferId?: string): void {
    void window.atlas.capabilities.list().then((list) => {
      setManifests(list)
      setSelectedId((current) => {
        if (preferId && list.some((m) => m.id === preferId)) return preferId
        if (current && list.some((m) => m.id === current)) return current
        return list.length > 0 ? list[0].id : null
      })
    })
  }

  useEffect(() => {
    refresh()
  }, [])

  const filtered = manifests.filter((m) => {
    const scopeMatch = scopeFilter === 'All' || m.scope === (scopeFilter.toLowerCase() as CapabilityScope)
    const typeMatch = typeFilter === 'All' || m.type === (typeFilter.toLowerCase() as CapabilityType)
    return scopeMatch && typeMatch
  })
  const selected = manifests.find((m) => m.id === selectedId)

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '36px 40px 80px' }}>
      <div style={{ fontFamily: 'Source Serif 4, serif', fontSize: 24, fontWeight: 600, marginBottom: 4 }}>Tool &amp; Skill Library</div>
      <div style={{ fontSize: 13.5, color: 'var(--c-ink-faint)', marginBottom: 24 }}>
        {advancedMode
          ? 'The shared capability library agents search when a task needs more than a direct model response — create, edit, and manage lifecycle state here.'
          : 'Read-only sample of the shared capability library agents can search when a task needs more than a direct model response.'}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <SegmentedControl options={['All', 'Global', 'Project']} value={scopeFilter} onChange={(v) => setScopeFilter(v as ScopeFilter)} />
          <SegmentedControl options={['All', 'Tool', 'Skill']} value={typeFilter} onChange={(v) => setTypeFilter(v as TypeFilter)} />
        </div>
        {advancedMode && (
          <button
            onClick={() => setFormMode('create')}
            style={{ padding: '7px 14px', borderRadius: 7, border: 'none', background: 'var(--c-accent)', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
          >
            New Capability
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 20 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map((m) => (
            <button
              key={m.id}
              onClick={() => setSelectedId(m.id)}
              style={{
                textAlign: 'left',
                padding: 16,
                borderRadius: 12,
                border: `1px solid ${selectedId === m.id ? 'var(--c-accent)' : 'var(--c-border)'}`,
                background: selectedId === m.id ? 'var(--c-accent-soft)' : 'var(--c-surface-raised)',
                cursor: 'pointer'
              }}
            >
              <div style={{ fontFamily: 'Source Serif 4, serif', fontWeight: 600, fontSize: 15, marginBottom: 6 }}>{m.name}</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <Badge>{m.type === 'tool' ? 'Tool' : 'Skill'}</Badge>
                <Badge>{m.scope === 'global' ? 'Global' : 'Project'}</Badge>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--c-ink-soft)' }}>{m.description}</div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div>
              <div style={{ color: 'var(--c-ink-soft)', fontSize: 13.5, marginBottom: 10 }}>
                Nothing matches {scopeFilter !== 'All' ? scopeFilter : ''} {typeFilter !== 'All' ? typeFilter : ''} — try a
                broader filter.
              </div>
              <button
                onClick={() => {
                  setScopeFilter('All')
                  setTypeFilter('All')
                }}
                style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-ink)', fontSize: 12.5, cursor: 'pointer' }}
              >
                Clear filters
              </button>
            </div>
          )}
        </div>

        {selected && (
          <div style={{ width: 340, flexShrink: 0, border: '1px solid var(--c-border)', borderRadius: 12, background: 'var(--c-surface-raised)', padding: 20, alignSelf: 'flex-start' }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              <Badge>{selected.type === 'tool' ? 'Tool' : 'Skill'}</Badge>
              <Badge>{selected.scope === 'global' ? 'Global' : 'Project'}</Badge>
              <Badge color="var(--c-green)">{selected.lifecycleState === 'enabled' ? 'Enabled' : selected.lifecycleState}</Badge>
            </div>
            <div style={{ fontFamily: 'Source Serif 4, serif', fontWeight: 600, fontSize: 17, marginBottom: 4 }}>
              {selected.name} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--c-ink-faint)' }}>v{selected.version}</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--c-ink-soft)', marginBottom: 16 }}>{selected.description}</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16, fontSize: 12.5 }}>
              <Field label="Owner" value={selected.owner} />
              <Field label="Permission" value={selected.permissionCategory.replace(/-/g, ' ')} />
              <Field label="Est. cost" value={costSummary(selected.costCharacteristics)} />
              <Field label="Validation" value={selected.validationStatus === 'passed' ? 'Passed' : selected.validationStatus} />
            </div>

            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', marginBottom: 8 }}>
              Compatible roles
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
              {selected.compatibleAgentRoles.map((role) => (
                <Badge key={role}>{role}</Badge>
              ))}
            </div>

            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', marginBottom: 8 }}>
              Input → Output
            </div>
            <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--c-surface)', fontSize: 12, fontFamily: 'ui-monospace, monospace', color: 'var(--c-ink-soft)' }}>
              {schemaSignature(selected.inputSchema)} → {schemaSignature(selected.outputSchema)}
            </div>

            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', marginTop: 16, marginBottom: 8 }}>
              Dependencies
            </div>
            {selected.dependsOn.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {selected.dependsOn.map((depId) => {
                  const dep = manifests.find((m) => m.id === depId.split('@')[0])
                  return <Badge key={depId}>{dep ? dep.name : depId}</Badge>
                })}
              </div>
            ) : (
              <div style={{ fontSize: 12.5, color: 'var(--c-ink-faint)' }}>No dependencies</div>
            )}

            {advancedMode && (
              <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
                <button onClick={() => setFormMode('edit')} style={{ flex: 1, padding: '7px 0', borderRadius: 7, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-ink)', fontSize: 12.5, cursor: 'pointer' }}>
                  Edit
                </button>
                {selected.lifecycleState !== 'enabled' && (
                  <LifecycleButton label="Enable" onClick={() => void setLifecycle(selected, 'enabled')} />
                )}
                {selected.lifecycleState !== 'disabled' && (
                  <LifecycleButton label="Disable" onClick={() => void setLifecycle(selected, 'disabled')} />
                )}
                {selected.lifecycleState !== 'deprecated' && (
                  <LifecycleButton label="Deprecate" onClick={() => void setLifecycle(selected, 'deprecated')} />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {formMode !== 'closed' && (
        <CapabilityForm
          manifest={formMode === 'edit' ? (selected ?? null) : null}
          onClose={() => setFormMode('closed')}
          onSaved={(id) => {
            setFormMode('closed')
            refresh(id)
          }}
        />
      )}
    </div>
  )

  async function setLifecycle(manifest: CapabilityManifest, state: LifecycleState): Promise<void> {
    await window.atlas.capabilities.setLifecycleState(manifest.id, state)
    refresh(manifest.id)
  }
}

function LifecycleButton({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
  return (
    <button onClick={onClick} style={{ flex: 1, padding: '7px 0', borderRadius: 7, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-ink-soft)', fontSize: 12.5, cursor: 'pointer' }}>
      {label}
    </button>
  )
}

function CapabilityForm({
  manifest,
  onClose,
  onSaved
}: {
  manifest: CapabilityManifest | null
  onClose: () => void
  onSaved: (id: string) => void
}): JSX.Element {
  const base = manifest ?? blankManifest()
  const [name, setName] = useState(base.name)
  const [description, setDescription] = useState(base.description)
  const [type, setType] = useState<CapabilityType>(base.type)
  const [scope, setScope] = useState<CapabilityScope>(base.scope)
  const [permissionCategory, setPermissionCategory] = useState(base.permissionCategory)
  const [sideEffects, setSideEffects] = useState<CapabilitySideEffects>(base.sideEffects)
  const [compatibleAgentRoles, setCompatibleAgentRoles] = useState<AgentRole[]>(base.compatibleAgentRoles)
  const [saving, setSaving] = useState(false)

  function toggleRole(role: AgentRole): void {
    setCompatibleAgentRoles((roles) => (roles.includes(role) ? roles.filter((r) => r !== role) : [...roles, role]))
  }

  async function handleSubmit(): Promise<void> {
    if (!name.trim() || saving) return
    setSaving(true)
    const nextManifest: CapabilityManifest = {
      ...base,
      name: name.trim(),
      description: description.trim(),
      type,
      scope,
      permissionCategory: permissionCategory.trim() || 'none',
      sideEffects,
      compatibleAgentRoles
    }
    if (manifest) {
      await window.atlas.capabilities.update(nextManifest)
    } else {
      await window.atlas.capabilities.create(nextManifest)
    }
    setSaving(false)
    onSaved(nextManifest.id)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div style={{ width: 480, maxHeight: '85vh', overflowY: 'auto', padding: 24, borderRadius: 14, background: 'var(--c-surface-raised)', border: '1px solid var(--c-border)' }}>
        <div style={{ fontFamily: 'Source Serif 4, serif', fontWeight: 600, fontSize: 18, marginBottom: 18 }}>
          {manifest ? 'Edit Capability' : 'New Capability'}
        </div>

        <FormField label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} style={formInputStyle} placeholder="Capability name" />
        </FormField>

        <FormField label="Description">
          <input value={description} onChange={(e) => setDescription(e.target.value)} style={formInputStyle} placeholder="What does it do?" />
        </FormField>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormField label="Type">
            <select value={type} onChange={(e) => setType(e.target.value as CapabilityType)} style={formInputStyle}>
              <option value="tool">Tool</option>
              <option value="skill">Skill</option>
            </select>
          </FormField>
          <FormField label="Scope">
            <select value={scope} onChange={(e) => setScope(e.target.value as CapabilityScope)} style={formInputStyle}>
              <option value="project">Project</option>
              <option value="global">Global</option>
            </select>
          </FormField>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormField label="Permission category">
            <input
              value={permissionCategory}
              onChange={(e) => setPermissionCategory(e.target.value)}
              style={formInputStyle}
              placeholder="e.g. read-manuscript"
            />
          </FormField>
          <FormField label="Side effects">
            <select value={sideEffects} onChange={(e) => setSideEffects(e.target.value as CapabilitySideEffects)} style={formInputStyle}>
              {SIDE_EFFECTS_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', margin: '14px 0 8px' }}>
          Compatible roles
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          {ALL_ROLES.map((role) => (
            <button
              key={role}
              onClick={() => toggleRole(role)}
              style={{
                padding: '5px 10px',
                borderRadius: 999,
                border: `1px solid ${compatibleAgentRoles.includes(role) ? 'var(--c-accent)' : 'var(--c-border)'}`,
                background: compatibleAgentRoles.includes(role) ? 'var(--c-accent-soft)' : 'transparent',
                color: compatibleAgentRoles.includes(role) ? 'var(--c-accent-text)' : 'var(--c-ink-soft)',
                fontSize: 12,
                cursor: 'pointer'
              }}
            >
              {role}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, fontSize: 12.5, cursor: 'pointer', border: '1px solid var(--c-border)', background: 'var(--c-surface)', color: 'var(--c-ink)' }}>
            Cancel
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={saving || !name.trim()}
            style={{ padding: '8px 16px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: 'none', background: 'var(--c-accent)', color: '#fff' }}
          >
            {manifest ? 'Save changes' : 'Create capability'}
          </button>
        </div>
      </div>
    </div>
  )
}

function FormField({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11.5, color: 'var(--c-ink-faint)', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  )
}

const formInputStyle: CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  borderRadius: 7,
  border: '1px solid var(--c-border)',
  background: 'var(--c-surface)',
  color: 'var(--c-ink)',
  fontSize: 12.5
}

function SegmentedControl<T extends string>({ options, value, onChange }: { options: T[]; value: T; onChange: (v: T) => void }): JSX.Element {
  return (
    <div style={{ display: 'flex', border: '1px solid var(--c-border)', borderRadius: 8, overflow: 'hidden' }}>
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          style={{
            padding: '6px 14px',
            fontSize: 12.5,
            border: 'none',
            cursor: 'pointer',
            background: value === opt ? 'var(--c-accent)' : 'transparent',
            color: value === opt ? '#fff' : 'var(--c-ink-soft)',
            fontWeight: value === opt ? 600 : 400
          }}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

function Badge({ children, color }: { children: ReactNode; color?: string }): JSX.Element {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 10,
        background: color ? `color-mix(in srgb, ${color} 15%, transparent)` : 'var(--c-surface)',
        color: color ?? 'var(--c-ink-soft)',
        border: color ? 'none' : '1px solid var(--c-border)'
      }}
    >
      {children}
    </span>
  )
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: 'var(--c-ink-faint)', marginBottom: 2 }}>{label}</div>
      <div style={{ color: 'var(--c-ink)', textTransform: 'capitalize' }}>{value}</div>
    </div>
  )
}
