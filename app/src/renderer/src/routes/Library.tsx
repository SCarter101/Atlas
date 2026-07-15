import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { AgentRole } from '@shared/schema/agent'
import type {
  CapabilityManifest,
  CapabilitySideEffects,
  CapabilityScope,
  CapabilityTestResult,
  CapabilityType,
  CapabilityUsageMetric,
  JsonSchema,
  LifecycleState
} from '@shared/schema/capability'
import { compareCapabilityVersions, type CapabilityFieldDiff } from '@shared/capabilityDiff'
import { normalizeError } from '@shared/errors'
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
  const pushToast = useAtlasStore((s) => s.pushToast)
  const [manifests, setManifests] = useState<CapabilityManifest[]>([])
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('All')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('All')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [formMode, setFormMode] = useState<'closed' | 'create' | 'edit'>('closed')
  const [compareState, setCompareState] = useState<{ manifest: CapabilityManifest; versionId: string } | null>(null)
  const [testManifest, setTestManifest] = useState<CapabilityManifest | null>(null)
  const [forkManifest, setForkManifest] = useState<CapabilityManifest | null>(null)
  const [usageMetrics, setUsageMetrics] = useState<CapabilityUsageMetric[]>([])

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

  function refreshUsageMetrics(): void {
    void window.atlas.capabilities.usageMetrics().then(setUsageMetrics)
  }

  useEffect(() => {
    refresh()
    refreshUsageMetrics()
  }, [])

  async function handleRollback(manifest: CapabilityManifest, versionId: string): Promise<void> {
    try {
      await window.atlas.capabilities.rollback(manifest.id, versionId)
      pushToast('info', `Rolled back "${manifest.name}" to an earlier version.`)
      refresh(manifest.id)
    } catch (err) {
      pushToast('error', normalizeError(err).message)
    }
  }

  async function handlePromote(manifest: CapabilityManifest): Promise<void> {
    try {
      await window.atlas.capabilities.promote(manifest.id, 'global')
      pushToast('info', `Promoted "${manifest.name}" to global scope.`)
      refresh(manifest.id)
    } catch (err) {
      pushToast('error', normalizeError(err).message)
    }
  }

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

            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', marginTop: 16, marginBottom: 8 }}>
              Version History
            </div>
            {selected.history.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 240, overflowY: 'auto' }}>
                {[...selected.history].reverse().map((entry) => (
                  <div key={entry.versionId} style={{ padding: 10, borderRadius: 8, border: '1px solid var(--c-border)', background: 'var(--c-surface)' }}>
                    <div style={{ fontSize: 10.5, color: 'var(--c-ink-faint)', marginBottom: 4 }}>{new Date(entry.changedAt).toLocaleString()}</div>
                    <div style={{ fontSize: 12, color: 'var(--c-ink-soft)', marginBottom: 8 }}>{entry.note}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        onClick={() => setCompareState({ manifest: selected, versionId: entry.versionId })}
                        disabled={!entry.snapshot}
                        title={!entry.snapshot ? 'This version predates snapshot support and cannot be compared.' : undefined}
                        style={{ ...smallActionButtonStyle, opacity: entry.snapshot ? 1 : 0.5, cursor: entry.snapshot ? 'pointer' : 'not-allowed' }}
                      >
                        Compare vs. current
                      </button>
                      {advancedMode && (
                        <button
                          onClick={() => void handleRollback(selected, entry.versionId)}
                          disabled={!entry.snapshot}
                          title={!entry.snapshot ? 'This version predates snapshot support and cannot be restored.' : undefined}
                          style={{ ...smallActionButtonStyle, opacity: entry.snapshot ? 1 : 0.5, cursor: entry.snapshot ? 'pointer' : 'not-allowed' }}
                        >
                          Rollback to this version
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12.5, color: 'var(--c-ink-faint)' }}>No history recorded.</div>
            )}

            {advancedMode && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 20 }}>
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
                <LifecycleButton label="Test with sample input" onClick={() => setTestManifest(selected)} />
                {selected.scope === 'project' && (
                  <LifecycleButton label="Promote to Global" onClick={() => void handlePromote(selected)} />
                )}
                {selected.scope === 'global' && (
                  <LifecycleButton label="Fork to Project" onClick={() => setForkManifest(selected)} />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ marginTop: 32 }}>
        <div style={{ fontFamily: 'Source Serif 4, serif', fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Usage &amp; Efficiency</div>
        <div style={{ fontSize: 12, color: 'var(--c-ink-faint)', marginBottom: 12 }}>
          Estimate only — invocation counts from recent agent runs multiplied by each capability&rsquo;s own self-declared
          cost characteristics. Not a measured comparison against not having the tool.
        </div>
        {usageMetrics.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--c-ink-faint)' }}>No recorded tool invocations yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--c-ink-faint)' }}>
                  <th style={thStyle}>Capability</th>
                  <th style={thStyle}>Invocations</th>
                  <th style={thStyle}>Succeeded</th>
                  <th style={thStyle}>Failed</th>
                  <th style={thStyle}>Est. tokens saved</th>
                  <th style={thStyle}>Est. cost saved</th>
                </tr>
              </thead>
              <tbody>
                {usageMetrics.map((metric) => {
                  const capability = manifests.find((m) => m.id === metric.toolId.split('@')[0])
                  return (
                    <tr key={metric.toolId} style={{ borderTop: '1px solid var(--c-border)' }}>
                      <td style={tdStyle}>{capability ? capability.name : metric.toolId}</td>
                      <td style={tdStyle}>{metric.invocations}</td>
                      <td style={tdStyle}>{metric.successCount}</td>
                      <td style={tdStyle}>{metric.failureCount}</td>
                      <td style={tdStyle}>{metric.estimatedTokensSaved.toLocaleString()}</td>
                      <td style={tdStyle}>${metric.estimatedCostSavedUsd.toFixed(2)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
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

      {compareState && (
        <CompareModal manifest={compareState.manifest} versionId={compareState.versionId} onClose={() => setCompareState(null)} />
      )}

      {testManifest && (
        <TestModal
          manifest={testManifest}
          onClose={() => setTestManifest(null)}
          onTested={() => refresh(testManifest.id)}
        />
      )}

      {forkManifest && (
        <ForkModal
          manifest={forkManifest}
          onClose={() => setForkManifest(null)}
          onForked={(newId) => {
            const forkedFrom = forkManifest.name
            setForkManifest(null)
            pushToast('info', `Forked "${forkedFrom}" into a new project capability.`)
            refresh(newId)
            refreshUsageMetrics()
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

function stringifyDiffValue(value: unknown): string {
  if (value === undefined) return '—'
  if (typeof value === 'string') return value || '—'
  return JSON.stringify(value)
}

function CompareModal({
  manifest,
  versionId,
  onClose
}: {
  manifest: CapabilityManifest
  versionId: string
  onClose: () => void
}): JSX.Element {
  let diffs: CapabilityFieldDiff[] = []
  let errorMessage: string | undefined
  try {
    diffs = compareCapabilityVersions(manifest, versionId)
  } catch (err) {
    errorMessage = normalizeError(err).message
  }

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={modalTitleStyle}>Compare versions</div>
        {errorMessage ? (
          <div style={{ fontSize: 12.5, color: 'var(--c-ink-soft)', marginBottom: 16 }}>{errorMessage}</div>
        ) : diffs.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--c-ink-soft)', marginBottom: 16 }}>
            No differences in the compared fields between this version and the current one.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            {diffs.map((d) => (
              <div key={d.field} style={{ padding: 10, borderRadius: 8, border: '1px solid var(--c-border)', fontSize: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 4, textTransform: 'capitalize' }}>{d.field}</div>
                <div style={{ color: 'var(--c-ink-faint)' }}>
                  Before: <span style={{ color: 'var(--c-ink)' }}>{stringifyDiffValue(d.before)}</span>
                </div>
                <div style={{ color: 'var(--c-ink-faint)' }}>
                  After: <span style={{ color: 'var(--c-ink)' }}>{stringifyDiffValue(d.after)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={cancelButtonStyle}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function TestModal({
  manifest,
  onClose,
  onTested
}: {
  manifest: CapabilityManifest
  onClose: () => void
  onTested: () => void
}): JSX.Element {
  const [inputText, setInputText] = useState('{}')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<CapabilityTestResult | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)

  async function runTest(): Promise<void> {
    let parsed: unknown
    try {
      parsed = JSON.parse(inputText)
    } catch {
      setParseError('Sample input is not valid JSON.')
      return
    }
    setParseError(null)
    setRunning(true)
    try {
      const testResult = await window.atlas.capabilities.test(manifest, parsed)
      setResult(testResult)
      onTested()
    } finally {
      setRunning(false)
    }
  }

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={modalTitleStyle}>Test &ldquo;{manifest.name}&rdquo;</div>
        <FormField label="Sample input (JSON)">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            rows={6}
            style={{ ...formInputStyle, fontFamily: 'ui-monospace, monospace', resize: 'vertical' }}
          />
        </FormField>
        {parseError && <div style={{ fontSize: 12, color: '#c0392b', marginBottom: 10 }}>{parseError}</div>}
        {result && (
          <div style={{ marginTop: 4, marginBottom: 16, padding: 10, borderRadius: 8, border: '1px solid var(--c-border)', fontSize: 12 }}>
            <div style={{ marginBottom: 6 }}>
              Mode: <strong>{result.mode === 'sandboxed' ? 'Sandboxed execution (real)' : 'Structural check (no real execution)'}</strong>
            </div>
            <div style={{ marginBottom: 6, color: result.ok ? 'var(--c-green)' : '#c0392b', fontWeight: 600 }}>
              {result.ok ? 'Passed' : `Failed${result.error ? `: ${result.error}` : ''}`}
            </div>
            {result.output !== undefined && (
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace', color: 'var(--c-ink-soft)' }}>
                {JSON.stringify(result.output, null, 2)}
              </pre>
            )}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={cancelButtonStyle}>
            Close
          </button>
          <button onClick={() => void runTest()} disabled={running} style={primaryButtonStyle}>
            {running ? 'Running…' : 'Run test'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ForkModal({
  manifest,
  onClose,
  onForked
}: {
  manifest: CapabilityManifest
  onClose: () => void
  onForked: (newId: string) => void
}): JSX.Element {
  const [newId, setNewId] = useState(`${manifest.id}.fork`)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFork(): Promise<void> {
    if (!newId.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      await window.atlas.capabilities.fork(manifest.id, newId.trim(), 'project')
      onForked(newId.trim())
    } catch (err) {
      setError(normalizeError(err).message)
      setSaving(false)
    }
  }

  return (
    <div style={overlayStyle}>
      <div style={{ ...modalStyle, width: 380 }}>
        <div style={modalTitleStyle}>Fork &ldquo;{manifest.name}&rdquo; to Project</div>
        <FormField label="New capability id">
          <input value={newId} onChange={(e) => setNewId(e.target.value)} style={formInputStyle} />
        </FormField>
        {error && <div style={{ fontSize: 12, color: '#c0392b', marginBottom: 10 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={cancelButtonStyle}>
            Cancel
          </button>
          <button onClick={() => void handleFork()} disabled={saving || !newId.trim()} style={primaryButtonStyle}>
            {saving ? 'Forking…' : 'Fork'}
          </button>
        </div>
      </div>
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

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.35)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100
}

const modalStyle: CSSProperties = {
  width: 460,
  maxHeight: '85vh',
  overflowY: 'auto',
  padding: 24,
  borderRadius: 14,
  background: 'var(--c-surface-raised)',
  border: '1px solid var(--c-border)'
}

const modalTitleStyle: CSSProperties = {
  fontFamily: 'Source Serif 4, serif',
  fontWeight: 600,
  fontSize: 18,
  marginBottom: 18
}

const cancelButtonStyle: CSSProperties = {
  padding: '8px 16px',
  borderRadius: 8,
  fontSize: 12.5,
  cursor: 'pointer',
  border: '1px solid var(--c-border)',
  background: 'var(--c-surface)',
  color: 'var(--c-ink)'
}

const primaryButtonStyle: CSSProperties = {
  padding: '8px 16px',
  borderRadius: 8,
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
  border: 'none',
  background: 'var(--c-accent)',
  color: '#fff'
}

const smallActionButtonStyle: CSSProperties = {
  padding: '4px 8px',
  borderRadius: 6,
  border: '1px solid var(--c-border)',
  background: 'transparent',
  color: 'var(--c-ink-soft)',
  fontSize: 11,
  cursor: 'pointer'
}

const thStyle: CSSProperties = { padding: '6px 8px', fontWeight: 600 }
const tdStyle: CSSProperties = { padding: '6px 8px' }

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
