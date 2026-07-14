import { useEffect, useState, type ReactNode } from 'react'
import type { AgentRole, ModelRef } from '@shared/schema/agent'
import type { BackupMeta } from '@shared/schema/backup'
import type { EmbeddingProvider, EmbeddingsStatus } from '@shared/schema/embeddings'
import type { OpenRouterCatalogEntry } from '@shared/schema/models'
import type { UsageSummary } from '@shared/schema/usage'
import { configuredMcpServers } from '@shared/mcp'
import { useAtlasStore } from '../state/store'

const AGENT_ORDER: { role: AgentRole; name: string }[] = [
  { role: 'Generator', name: 'Generator' },
  { role: 'Dev-Editor', name: 'Story Editor' },
  { role: 'Line-Editor', name: 'Line Editor' },
  { role: 'Dialoguer', name: 'Dialogue Editor' },
  { role: 'World-Builder', name: 'World Builder' }
]

// Phase 6: agentModels now holds real ModelRefs (see store.ts) instead of
// bare display strings. <select> needs string option values, so ModelRefs
// are serialized to/from `${provider}:${modelId}` — safe because these two
// fields together are unique across every option this screen offers.
const SIMULATOR_REF: ModelRef = { provider: 'simulator', modelId: 'simulator', viaOpenRouter: false }
const LM_STUDIO_REF: ModelRef = { provider: 'lm-studio', modelId: 'local-model', viaOpenRouter: false }

function modelRefKey(ref: ModelRef): string {
  return `${ref.provider}:${ref.modelId}`
}

function modelDisplayLabel(ref: ModelRef, catalog: OpenRouterCatalogEntry[]): string {
  if (ref.provider === 'simulator') return 'Simulated (no API calls)'
  if (ref.provider === 'lm-studio') return 'Local (LM Studio)'
  if (ref.provider === 'openrouter') {
    const catalogEntry = catalog.find((entry) => entry.id === ref.modelId)
    if (catalogEntry) return catalogEntry.name
  }
  return ref.modelId
}

function formatBackupSize(sizeBytes: number): string {
  if (sizeBytes < 1024 * 1024) return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

export function Settings(): JSX.Element {
  const agentModels = useAtlasStore((s) => s.agentModels)
  const setAgentModel = useAtlasStore((s) => s.setAgentModel)
  const modelCatalog = useAtlasStore((s) => s.modelCatalog)
  const loadModelCatalog = useAtlasStore((s) => s.loadModelCatalog)
  const lmStudioFallback = useAtlasStore((s) => s.lmStudioFallback)
  const toggleLmStudioFallback = useAtlasStore((s) => s.toggleLmStudioFallback)
  const advancedMode = useAtlasStore((s) => s.advancedMode)
  const toggleAdvancedMode = useAtlasStore((s) => s.toggleAdvancedMode)
  const privacySettings = useAtlasStore((s) => s.privacySettings)
  const toggleRequireCloudAuth = useAtlasStore((s) => s.toggleRequireCloudAuth)
  const toggleWarnCloudUnpublished = useAtlasStore((s) => s.toggleWarnCloudUnpublished)
  const sessionApprovals = useAtlasStore((s) => s.sessionApprovals)
  const revokeSessionApproval = useAtlasStore((s) => s.revokeSessionApproval)

  const [apiKey, setApiKey] = useState('')
  const [apiKeySaved, setApiKeySaved] = useState(false)
  const [apiKeyMessage, setApiKeyMessage] = useState<string | null>(null)
  const [backupLabel, setBackupLabel] = useState('')
  const [backups, setBackups] = useState<BackupMeta[]>([])
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupMessage, setBackupMessage] = useState<string | null>(null)

  async function refreshBackups(): Promise<void> {
    setBackups(await window.atlas.backups.list())
  }

  async function refreshOpenRouterKeyState(): Promise<void> {
    setApiKeySaved(await window.atlas.secrets.has('openrouter-api-key'))
  }

  async function handleSaveOpenRouterKey(): Promise<void> {
    const trimmed = apiKey.trim()
    if (!trimmed) {
      setApiKeyMessage('Enter a key before saving.')
      return
    }

    const result = await window.atlas.secrets.set('openrouter-api-key', trimmed)
    if (result.ok) {
      setApiKey('')
      setApiKeySaved(true)
      setApiKeyMessage('Key saved.')
    } else {
      setApiKeyMessage(result.error === 'encryption-unavailable' ? 'Encryption unavailable; key was not saved.' : `Save failed: ${result.error}`)
    }
  }

  async function handleClearOpenRouterKey(): Promise<void> {
    await window.atlas.secrets.clear('openrouter-api-key')
    setApiKey('')
    setApiKeySaved(false)
    setApiKeyMessage('Key cleared.')
  }

  async function handleCreateBackup(): Promise<void> {
    setBackupBusy(true)
    setBackupMessage(null)
    try {
      await window.atlas.backups.create(backupLabel.trim() || undefined)
      setBackupLabel('')
      await refreshBackups()
      setBackupMessage('Backup created.')
    } finally {
      setBackupBusy(false)
    }
  }

  async function handleRestoreBackup(backupId: string): Promise<void> {
    if (!window.confirm('Restore this backup to a new project folder? Your current project will not be overwritten.')) return
    setBackupBusy(true)
    setBackupMessage(null)
    try {
      const result = await window.atlas.backups.restore(backupId)
      setBackupMessage(`Restored non-destructively to ${result.restoredProjectRoot}`)
    } finally {
      setBackupBusy(false)
    }
  }

  useEffect(() => {
    void refreshBackups()
    void refreshOpenRouterKeyState()
    void loadModelCatalog()
    // loadModelCatalog is a stable store action reference (zustand), safe to
    // omit from deps — this should only run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleModelChange(role: AgentRole, key: string): void {
    if (key === modelRefKey(SIMULATOR_REF)) {
      setAgentModel(role, SIMULATOR_REF)
      return
    }
    if (key === modelRefKey(LM_STUDIO_REF)) {
      setAgentModel(role, LM_STUDIO_REF)
      return
    }
    const catalogEntry = modelCatalog.find((entry) => modelRefKey({ provider: 'openrouter', modelId: entry.id, viaOpenRouter: true }) === key)
    if (catalogEntry) {
      setAgentModel(role, { provider: 'openrouter', modelId: catalogEntry.id, viaOpenRouter: true })
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '36px 40px 80px' }}>
      <div style={{ fontFamily: 'Source Serif 4, serif', fontSize: 24, fontWeight: 600, marginBottom: 24 }}>Settings</div>

      {/* Advanced Mode — spec §10: exposes model routing, prompt editing,
          multiple drafts, and token diagnostics without ever changing
          manuscript content or project data, only which controls show. */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
          padding: 20,
          borderRadius: 12,
          border: '1px solid var(--c-border)',
          background: 'var(--c-surface-raised)',
          marginBottom: 28
        }}
      >
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 4 }}>Advanced Mode</div>
          <div style={{ fontSize: 12.5, color: 'var(--c-ink-faint)', lineHeight: 1.5 }}>
            Reveals model routing, prompt editing, multiple drafts, and token diagnostics. Never changes your manuscript.
          </div>
        </div>
        <Switch checked={advancedMode} onChange={toggleAdvancedMode} />
      </div>

      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', marginBottom: 12 }}>
        Agent models
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
        {AGENT_ORDER.map(({ role, name }) => (
          <div
            key={role}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '14px 18px',
              borderRadius: 10,
              border: '1px solid var(--c-border)',
              background: 'var(--c-surface-raised)'
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 600 }}>{name}</span>
            {advancedMode ? (
              <select
                value={modelRefKey(agentModels[role])}
                onChange={(e) => handleModelChange(role, e.target.value)}
                style={{
                  padding: '6px 10px',
                  borderRadius: 7,
                  border: '1px solid var(--c-border)',
                  background: 'var(--c-surface)',
                  color: 'var(--c-ink)',
                  fontSize: 12.5
                }}
              >
                <option value={modelRefKey(SIMULATOR_REF)}>Simulated (no API calls)</option>
                {modelCatalog.length > 0 && (
                  <optgroup label="OpenRouter">
                    {modelCatalog.map((entry) => (
                      <option key={entry.id} value={modelRefKey({ provider: 'openrouter', modelId: entry.id, viaOpenRouter: true })}>
                        {entry.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                <option value={modelRefKey(LM_STUDIO_REF)}>Local (LM Studio)</option>
              </select>
            ) : (
              <span style={{ fontSize: 13, color: 'var(--c-ink-faint)' }}>{modelDisplayLabel(agentModels[role], modelCatalog)}</span>
            )}
          </div>
        ))}
      </div>

      <Section title="Backups & snapshots">
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <input
            value={backupLabel}
            onChange={(e) => setBackupLabel(e.target.value)}
            placeholder="Optional label"
            style={{
              flex: 1,
              minWidth: 0,
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid var(--c-border)',
              background: 'var(--c-surface-raised)',
              color: 'var(--c-ink)',
              fontSize: 13
            }}
          />
          <button
            onClick={() => void handleCreateBackup()}
            disabled={backupBusy}
            style={{
              padding: '8px 14px',
              borderRadius: 7,
              border: 'none',
              background: 'var(--c-accent)',
              color: '#fff',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: backupBusy ? 'default' : 'pointer',
              opacity: backupBusy ? 0.7 : 1,
              flexShrink: 0
            }}
          >
            {backupBusy ? 'Working…' : 'Create backup'}
          </button>
        </div>
        {backupMessage && <div style={{ fontSize: 12.5, color: 'var(--c-ink-soft)', marginBottom: 12 }}>{backupMessage}</div>}
        {backups.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--c-ink-faint)' }}>No backups yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {backups.map((backup) => (
              <div
                key={backup.backupId}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 16px',
                  borderRadius: 10,
                  border: '1px solid var(--c-border)',
                  background: 'var(--c-surface-raised)'
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{backup.label ?? 'Untitled'}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--c-ink-soft)' }}>
                    {new Date(backup.createdAt).toLocaleString()} · {formatBackupSize(backup.sizeBytes)}
                  </div>
                </div>
                <button
                  onClick={() => void handleRestoreBackup(backup.backupId)}
                  disabled={backupBusy}
                  style={{
                    padding: '7px 14px',
                    borderRadius: 7,
                    border: '1px solid var(--c-border)',
                    background: 'transparent',
                    color: 'var(--c-ink-soft)',
                    fontSize: 12.5,
                    cursor: backupBusy ? 'default' : 'pointer',
                    flexShrink: 0,
                    opacity: backupBusy ? 0.7 : 1
                  }}
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Privacy">
        <div style={{ fontSize: 12.5, color: 'var(--c-ink-soft)', lineHeight: 1.5, marginBottom: 14 }}>
          Atlas gates cloud-classified model runs before they start. Model calls are simulated in this build, so these
          controls exercise authorization and local persistence without real network transmission.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <ToggleRow
            label="Require authorization before using a cloud-classified model"
            checked={privacySettings.requireCloudAuth}
            onChange={toggleRequireCloudAuth}
          />
          <ToggleRow
            label="Warn when unpublished manuscript content may be included"
            checked={privacySettings.warnCloudUnpublished}
            onChange={toggleWarnCloudUnpublished}
          />
        </div>
      </Section>

      {advancedMode && (
        <>
          <Section title="OpenRouter">
            <div style={{ fontSize: 12.5, color: 'var(--c-ink-soft)', marginBottom: 10 }}>
              Bring your own OpenRouter API key so cloud models can be routed per-agent above.
            </div>
            <div style={{ fontSize: 12.5, color: apiKeySaved ? 'var(--c-green)' : 'var(--c-ink-faint)', marginBottom: 8 }}>
              {apiKeySaved ? 'Key saved ✓' : 'Not set'}
            </div>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-or-…"
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid var(--c-border)',
                background: 'var(--c-surface-raised)',
                color: 'var(--c-ink)',
                fontSize: 13,
                marginBottom: 6
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button
                onClick={() => void handleSaveOpenRouterKey()}
                style={{ padding: '7px 14px', borderRadius: 7, border: 'none', background: 'var(--c-accent)', color: 'var(--c-on-accent)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
              >
                Save key
              </button>
              <button
                onClick={() => void handleClearOpenRouterKey()}
                style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-ink-soft)', fontSize: 12.5, cursor: 'pointer' }}
              >
                Clear
              </button>
            </div>
            {apiKeyMessage && <div style={{ fontSize: 12, color: 'var(--c-ink-soft)', marginBottom: 6 }}>{apiKeyMessage}</div>}
            <div style={{ fontSize: 11.5, color: 'var(--c-ink-faint)', lineHeight: 1.5 }}>
              Stored encrypted through the OS keychain via Electron safeStorage. Never transmitted in this simulated
              build.
            </div>
          </Section>

          <Section title="LM Studio fallback">
            <ToggleRow
              label="Fall back to local LM Studio models if a cloud call fails"
              checked={lmStudioFallback}
              onChange={toggleLmStudioFallback}
            />
            <div style={{ fontSize: 11.5, color: 'var(--c-ink-faint)', marginTop: 6 }}>Connection status: not connected</div>
          </Section>

          {/* Phase 7: main/retrieval/embeddings/ real embedding adapters
              (LM Studio primary, OpenRouter opt-in, hashing-trick final
              fallback — see main/retrieval/embeddings/select.ts). */}
          <EmbeddingsSection />

          {/* Spec §13/§10: session-scoped capability approvals must remain
              visible and revocable for the life of the session. */}
          <Section title="Session approvals">
            {sessionApprovals.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--c-ink-faint)' }}>
                No session approvals yet — they'll appear here after you choose "Approve for session" on a permission
                request.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {sessionApprovals.map((approval) => (
                  <div
                    key={approval.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px 16px',
                      borderRadius: 10,
                      border: '1px solid var(--c-border)',
                      background: 'var(--c-surface-raised)'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{approval.capabilityId}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--c-ink-soft)' }}>
                        {approval.actionType} · {approval.dataScope}
                        {approval.destination ? ` · ${approval.destination}` : ''}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--c-ink-faint)', marginTop: 2 }}>
                        Granted {new Date(approval.grantedAt).toLocaleString()}
                      </div>
                    </div>
                    <button
                      onClick={() => revokeSessionApproval(approval.id)}
                      style={{
                        padding: '7px 14px',
                        borderRadius: 7,
                        border: '1px solid var(--c-border)',
                        background: 'transparent',
                        color: 'var(--c-ink-soft)',
                        fontSize: 12.5,
                        cursor: 'pointer',
                        flexShrink: 0
                      }}
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Phase 6: real per-project usage/cost tracking (main/persistence/
              usageStore.ts). Nothing writes to the usage log yet in this
              wave — main/agent/simulator.ts is the intended future caller
              once real provider calls replace the simulator — so this will
              read as empty until that lands. */}
          <UsageSection />

          {/* Spec §8/§15 Phase 2: MCP-compatible adapter architecture exists
              so external tools can be discovered and invoked without the
              runtime depending on MCP directly — but production MCP
              connectivity is explicitly out of scope for this phase. */}
          <Section title="MCP Servers">
            {configuredMcpServers.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--c-ink-faint)' }}>
                No MCP servers configured — this build ships the adapter architecture (spec §8) without any
                servers wired up.
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {configuredMcpServers.map((server) => (
                    <div
                      key={server.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 12,
                        padding: '12px 16px',
                        borderRadius: 10,
                        border: '1px solid var(--c-border)',
                        background: 'var(--c-surface-raised)'
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{server.name}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--c-ink-soft)' }}>
                          {server.transport} · {server.transport === 'stdio' ? server.command : server.url}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--c-ink-faint)', marginTop: 10 }}>
                  These are configured adapters, not live connections — production MCP connectivity isn't
                  implemented in this build (spec §15, Phase 2).
                </div>
              </>
            )}
          </Section>

          <PromptEditorSection />
        </>
      )}

      {/* Phase 9 Track E: local-only crash reporting / opt-in local
          telemetry / feedback export — see main/telemetry/telemetryStore.ts.
          Deliberately NOT gated behind Advanced Mode: this is a basic,
          writer-facing "how do I report a problem" affordance, not a
          diagnostics-for-power-users feature. */}
      <TelemetrySection />
    </div>
  )
}

const EMBEDDING_PROVIDER_OPTIONS: { value: EmbeddingProvider; label: string; hint: string }[] = [
  { value: 'lm-studio', label: 'LM Studio (default)', hint: 'Real local embeddings — no data leaves this machine.' },
  { value: 'openrouter', label: 'OpenRouter (opt-in)', hint: 'Real cloud embeddings — sends indexed text to OpenRouter.' },
  { value: 'hashing', label: 'Hashing-only', hint: 'No network calls; keyword-overlap matching only, not real semantic search.' }
]

function EmbeddingsSection(): JSX.Element {
  const embeddingProvider = useAtlasStore((s) => s.embeddingProvider)
  const setEmbeddingProvider = useAtlasStore((s) => s.setEmbeddingProvider)
  const [status, setStatus] = useState<EmbeddingsStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.atlas.embeddings.status().then((result) => {
      if (!cancelled) setStatus(result)
    })
    return () => {
      cancelled = true
    }
    // Re-check status whenever the writer changes their provider choice —
    // setEmbeddingProvider already syncs the choice to the main process, but
    // this effect is what tells the writer whether that choice is actually
    // reachable right now (e.g. LM Studio not running).
  }, [embeddingProvider])

  return (
    <Section title="Embeddings provider">
      <div style={{ fontSize: 12.5, color: 'var(--c-ink-soft)', lineHeight: 1.5, marginBottom: 14 }}>
        Retrieval (Codex and scene search used by agent context-building) can run on real semantic embeddings
        instead of the built-in keyword-overlap fallback.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        {EMBEDDING_PROVIDER_OPTIONS.map((option) => (
          <button
            key={option.value}
            onClick={() => setEmbeddingProvider(option.value)}
            style={{
              textAlign: 'left',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              padding: '10px 14px',
              borderRadius: 9,
              border: `1px solid ${embeddingProvider === option.value ? 'var(--c-accent)' : 'var(--c-border)'}`,
              background: embeddingProvider === option.value ? 'var(--c-accent-soft)' : 'var(--c-surface-raised)',
              cursor: 'pointer'
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: embeddingProvider === option.value ? 'var(--c-accent-text)' : 'var(--c-ink)' }}>
              {option.label}
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--c-ink-faint)' }}>{option.hint}</span>
          </button>
        ))}
      </div>
      <div style={{ fontSize: 12, color: 'var(--c-ink-soft)' }}>
        {!status
          ? 'Checking status…'
          : status.available
            ? `Active: ${providerLabel(status.activeProvider)} ✓`
            : `Active: ${providerLabel(status.activeProvider)} — your selected provider isn't reachable right now, so this fell back.`}
      </div>
    </Section>
  )
}

function providerLabel(provider: EmbeddingProvider): string {
  return EMBEDDING_PROVIDER_OPTIONS.find((option) => option.value === provider)?.label ?? provider
}

function UsageSection(): JSX.Element {
  const [summary, setSummary] = useState<UsageSummary | null>(null)

  useEffect(() => {
    void window.atlas.usage.summary().then(setSummary)
  }, [])

  return (
    <Section title="Usage & cost">
      {!summary ? (
        <div style={{ fontSize: 12.5, color: 'var(--c-ink-faint)' }}>Loading…</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 28, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--c-ink-faint)', marginBottom: 2 }}>Total cost</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>${summary.totalCostUsd.toFixed(3)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--c-ink-faint)', marginBottom: 2 }}>Total tokens</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{summary.totalTokens.toLocaleString()}</div>
            </div>
          </div>
          {AGENT_ORDER.every(({ role }) => !summary.byAgentRole[role]) ? (
            <div style={{ fontSize: 12.5, color: 'var(--c-ink-faint)' }}>
              No usage recorded yet — this fills in once real model calls run (still simulated in this build).
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {AGENT_ORDER.filter(({ role }) => summary.byAgentRole[role]).map(({ role, name }) => {
                const bucket = summary.byAgentRole[role]!
                return (
                  <div
                    key={role}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 14px',
                      borderRadius: 9,
                      border: '1px solid var(--c-border)',
                      background: 'var(--c-surface-raised)',
                      fontSize: 12.5
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{name}</span>
                    <span style={{ color: 'var(--c-ink-soft)' }}>
                      {bucket.calls} call{bucket.calls === 1 ? '' : 's'} · {bucket.tokens.toLocaleString()} tokens · $
                      {bucket.costUsd.toFixed(3)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </Section>
  )
}

function PromptEditorSection(): JSX.Element {
  const [selected, setSelected] = useState<AgentRole>('Generator')
  const [text, setText] = useState('')
  const [savedText, setSavedText] = useState('')
  const [version, setVersion] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void window.atlas.prompts.get(selected).then((result) => {
      if (cancelled) return
      setText(result.text)
      setSavedText(result.text)
      setVersion(result.version)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [selected])

  const dirty = text !== savedText

  async function handleReset(): Promise<void> {
    const result = await window.atlas.prompts.reset(selected)
    setText(result.text)
    setSavedText(result.text)
    setVersion(result.version)
  }

  async function handleSaveNewVersion(): Promise<void> {
    const result = await window.atlas.prompts.set(selected, text)
    setSavedText(text)
    setVersion(result.version)
  }

  return (
    <Section title="System prompts">
      <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {AGENT_ORDER.map(({ role, name }) => (
            <button
              key={role}
              onClick={() => setSelected(role)}
              style={{
                textAlign: 'left',
                padding: '8px 10px',
                borderRadius: 7,
                border: 'none',
                background: selected === role ? 'var(--c-accent-soft)' : 'transparent',
                color: selected === role ? 'var(--c-accent-text)' : 'var(--c-ink-soft)',
                fontWeight: selected === role ? 600 : 400,
                fontSize: 13,
                cursor: 'pointer'
              }}
            >
              {name}
            </button>
          ))}
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>
              {AGENT_ORDER.find((a) => a.role === selected)?.name} — system prompt
            </div>
            <span style={{ fontSize: 11, color: 'var(--c-ink-faint)' }}>Version {version}</span>
          </div>
          <textarea
            value={text}
            disabled={loading}
            onChange={(e) => setText(e.target.value)}
            style={{
              width: '100%',
              minHeight: 200,
              border: '1px solid var(--c-border)',
              borderRadius: 10,
              padding: 14,
              fontSize: 13,
              fontFamily: 'ui-monospace, monospace',
              lineHeight: 1.6,
              resize: 'vertical',
              background: 'var(--c-surface-raised)',
              color: 'var(--c-ink)'
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
            <div style={{ fontSize: 11.5, color: 'var(--c-ink-faint)' }}>{loading ? 'Loading…' : dirty ? 'Unsaved changes' : 'Saved'}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => void handleReset()}
                disabled={loading}
                style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-ink-soft)', fontSize: 12.5, cursor: loading ? 'default' : 'pointer' }}
              >
                Reset to default
              </button>
              <button
                onClick={() => void handleSaveNewVersion()}
                disabled={loading}
                style={{ padding: '7px 16px', borderRadius: 7, border: 'none', background: 'var(--c-accent)', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: loading ? 'default' : 'pointer' }}
              >
                Save new version
              </button>
            </div>
          </div>
        </div>
      </div>
    </Section>
  )
}

function TelemetrySection(): JSX.Element {
  const [enabled, setEnabled] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportMessage, setExportMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.atlas.telemetry.getEnabled().then((value) => {
      if (!cancelled) {
        setEnabled(value)
        setLoaded(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleToggle(): Promise<void> {
    const next = !enabled
    setEnabled(next)
    await window.atlas.telemetry.setEnabled(next)
  }

  async function handleExportFeedback(): Promise<void> {
    setExportBusy(true)
    setExportMessage(null)
    try {
      const result = await window.atlas.telemetry.exportFeedback()
      if (result.canceled) {
        // Writer backed out of the save dialog — nothing to report.
      } else if (result.ok) {
        setExportMessage(`Feedback bundle saved to ${result.filePath}`)
      } else {
        setExportMessage(`Export failed: ${result.error}`)
      }
    } finally {
      setExportBusy(false)
    }
  }

  return (
    <Section title="Telemetry & feedback">
      <div style={{ fontSize: 12.5, color: 'var(--c-ink-soft)', lineHeight: 1.5, marginBottom: 14 }}>
        This build of Atlas has no external telemetry or crash-reporting service — nothing on this page is ever sent
        anywhere. Crash details are always written to a local log file on this machine so problems can be diagnosed
        later. Turning on local event logging below additionally records structural app-usage events (never your
        manuscript text) to another local file, purely for your own reference or to include in a feedback bundle.
      </div>
      <div style={{ marginBottom: 16 }}>
        <ToggleRow
          label="Log local usage events (stays on this machine, never transmitted)"
          checked={enabled}
          onChange={() => void handleToggle()}
        />
      </div>
      <button
        onClick={() => void handleExportFeedback()}
        disabled={exportBusy || !loaded}
        style={{
          padding: '8px 16px',
          borderRadius: 7,
          border: '1px solid var(--c-border)',
          background: 'transparent',
          color: 'var(--c-ink-soft)',
          fontSize: 12.5,
          fontWeight: 600,
          cursor: exportBusy ? 'default' : 'pointer',
          opacity: exportBusy ? 0.7 : 1
        }}
      >
        {exportBusy ? 'Preparing…' : 'Save feedback bundle…'}
      </button>
      <div style={{ fontSize: 11.5, color: 'var(--c-ink-faint)', marginTop: 10, lineHeight: 1.5 }}>
        Packages your local crash log, opt-in event log (if any), and sanitized recent agent-run metadata (timestamps,
        agent role, token/cost counts — never scene prose or model output text) into a zip you can attach to an email
        or GitHub issue yourself.
      </div>
      {exportMessage && <div style={{ fontSize: 12.5, color: 'var(--c-ink-soft)', marginTop: 10 }}>{exportMessage}</div>}
    </Section>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div style={{ marginBottom: 28, paddingBottom: 28, borderBottom: '1px solid var(--c-border)' }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', marginBottom: 14 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }): JSX.Element {
  return (
    <button
      onClick={onChange}
      style={{ display: 'flex', alignItems: 'center', gap: 12, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, width: '100%', textAlign: 'left' }}
    >
      <Switch checked={checked} onChange={() => {}} />
      <span style={{ fontSize: 13.5, color: 'var(--c-ink)' }}>{label}</span>
    </button>
  )
}

function Switch({ checked, onChange }: { checked: boolean; onChange: () => void }): JSX.Element {
  return (
    <span
      onClick={onChange}
      role="switch"
      aria-checked={checked}
      style={{
        width: 36,
        height: 20,
        borderRadius: 999,
        background: checked ? 'var(--c-accent)' : 'var(--c-border)',
        position: 'relative',
        flexShrink: 0,
        cursor: 'pointer',
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
