import { useEffect, useState, type ReactNode } from 'react'
import type { CapabilityManifest, CapabilityScope, CapabilityType, JsonSchema } from '@shared/schema/capability'

type ScopeFilter = 'All' | 'Global' | 'Project'
type TypeFilter = 'All' | 'Tool' | 'Skill'

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
  const [manifests, setManifests] = useState<CapabilityManifest[]>([])
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('All')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('All')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    void window.atlas.capabilities.list().then((list) => {
      setManifests(list)
      if (list.length > 0) setSelectedId(list[0].id)
    })
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
        Read-only sample of the shared capability library agents can search when a task needs more than a direct model response.
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <SegmentedControl options={['All', 'Global', 'Project']} value={scopeFilter} onChange={(v) => setScopeFilter(v as ScopeFilter)} />
        <SegmentedControl options={['All', 'Tool', 'Skill']} value={typeFilter} onChange={(v) => setTypeFilter(v as TypeFilter)} />
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
          </div>
        )}
      </div>
    </div>
  )
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
