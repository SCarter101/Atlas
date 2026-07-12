import { useState, type ReactNode } from 'react'
import type { AgentRole } from '@shared/schema/agent'
import { useAtlasStore } from '../state/store'

const MODEL_OPTIONS = ['Claude Opus 4', 'Claude Sonnet 4', 'GPT-4.1', 'Gemini 1.5 Pro', 'Local (LM Studio)']

const AGENT_ORDER: { role: AgentRole; name: string }[] = [
  { role: 'Generator', name: 'Generator' },
  { role: 'Dev-Editor', name: 'Story Editor' },
  { role: 'Line-Editor', name: 'Line Editor' },
  { role: 'Dialoguer', name: 'Dialogue Editor' },
  { role: 'World-Builder', name: 'World Builder' }
]

// Ported from the Phase 1 prototype's PromptEditor.dc.html — default
// prompts and starting version numbers, kept purely as in-memory session
// state here since there's no real prompt-driven agent behavior yet to
// persist against (spec §14: prompts must be editable, reversible, and
// versioned once that lands).
const DEFAULT_PROMPTS: Record<AgentRole, string> = {
  Generator:
    "You are Generator, the primary drafting agent for this novelist's manuscript. Draft prose from the scene outline and metadata provided. Match the writer's established voice. Never contradict locked world rules or canon Codex facts. Ask a clarifying question if the outline is too vague to draft confidently.",
  'Dev-Editor':
    'You are Story Editor, an industry developmental editor. Operate at the act or full-manuscript level. Detect plot holes, pacing problems, weak stakes, and broken setups/payoffs. Return a structured report with severity scores — never rewrite prose directly.',
  'Line-Editor':
    'You are Line Editor, a copy editor focused on clarity and voice preservation. Propose tracked changes only — never silently edit. Flag AI-sounding prose separately from grammar and style issues.',
  Dialoguer:
    "You are Dialogue Editor. Use each character's Codex voice profile to evaluate whether dialogue is distinct, advances conflict, and avoids sounding interchangeable between characters.",
  'World-Builder':
    'You are World Builder. Use the Codex world repository as primary knowledge. Clearly separate invented facts from researched real-world facts, and cite sources for anything pulled from the web. Never add to the Codex without writer approval.'
}

const DEFAULT_VERSIONS: Record<AgentRole, string> = {
  Generator: '1.2',
  'Dev-Editor': '1.0',
  'Line-Editor': '1.3',
  Dialoguer: '1.0',
  'World-Builder': '1.1'
}

export function Settings(): JSX.Element {
  const agentModels = useAtlasStore((s) => s.agentModels)
  const setAgentModel = useAtlasStore((s) => s.setAgentModel)
  const lmStudioFallback = useAtlasStore((s) => s.lmStudioFallback)
  const toggleLmStudioFallback = useAtlasStore((s) => s.toggleLmStudioFallback)
  const advancedMode = useAtlasStore((s) => s.advancedMode)
  const toggleAdvancedMode = useAtlasStore((s) => s.toggleAdvancedMode)
  const sessionApprovals = useAtlasStore((s) => s.sessionApprovals)
  const revokeSessionApproval = useAtlasStore((s) => s.revokeSessionApproval)

  const [apiKey, setApiKey] = useState('')

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
                value={agentModels[role]}
                onChange={(e) => setAgentModel(role, e.target.value)}
                style={{
                  padding: '6px 10px',
                  borderRadius: 7,
                  border: '1px solid var(--c-border)',
                  background: 'var(--c-surface)',
                  color: 'var(--c-ink)',
                  fontSize: 12.5
                }}
              >
                {MODEL_OPTIONS.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            ) : (
              <span style={{ fontSize: 13, color: 'var(--c-ink-faint)' }}>{agentModels[role]}</span>
            )}
          </div>
        ))}
      </div>

      {advancedMode && (
        <>
          <Section title="OpenRouter">
            <div style={{ fontSize: 12.5, color: 'var(--c-ink-soft)', marginBottom: 10 }}>
              Bring your own OpenRouter API key so cloud models can be routed per-agent above.
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
            <div style={{ fontSize: 11.5, color: 'var(--c-ink-faint)' }}>
              Not saved anywhere in this build — spec §13 requires a backend vault, not raw local storage, and that
              vault isn't implemented yet.
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

          <PromptEditorSection />
        </>
      )}
    </div>
  )
}

function PromptEditorSection(): JSX.Element {
  const [selected, setSelected] = useState<AgentRole>('Generator')
  const [drafts, setDrafts] = useState<Record<AgentRole, string>>({ ...DEFAULT_PROMPTS })
  const [versions, setVersions] = useState<Record<AgentRole, string>>({ ...DEFAULT_VERSIONS })
  const [dirty, setDirty] = useState(false)

  return (
    <Section title="System prompts">
      <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {AGENT_ORDER.map(({ role, name }) => (
            <button
              key={role}
              onClick={() => {
                setSelected(role)
                setDirty(false)
              }}
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
            <span style={{ fontSize: 11, color: 'var(--c-ink-faint)' }}>Version {versions[selected]}</span>
          </div>
          <textarea
            value={drafts[selected]}
            onChange={(e) => {
              setDrafts((d) => ({ ...d, [selected]: e.target.value }))
              setDirty(true)
            }}
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
            <div style={{ fontSize: 11.5, color: 'var(--c-ink-faint)' }}>{dirty ? 'Unsaved changes' : 'Saved'}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => {
                  setDrafts((d) => ({ ...d, [selected]: DEFAULT_PROMPTS[selected] }))
                  setDirty(false)
                }}
                style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-ink-soft)', fontSize: 12.5, cursor: 'pointer' }}
              >
                Reset to default
              </button>
              <button
                onClick={() => {
                  setVersions((v) => ({ ...v, [selected]: (parseFloat(v[selected]) + 0.1).toFixed(1) }))
                  setDirty(false)
                }}
                style={{ padding: '7px 16px', borderRadius: 7, border: 'none', background: 'var(--c-accent)', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
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
