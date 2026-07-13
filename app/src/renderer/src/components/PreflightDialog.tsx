import { useNavigate } from 'react-router-dom'
import type { ModelRef } from '@shared/schema/agent'
import { describeProvider } from '@shared/privacy'
import { estimateAgentCost } from '../lib/costEstimate'
import { useAtlasStore } from '../state/store'

// Plain-language cost pre-flight per spec §8: shown before any run starts,
// with a real confirm/change-model/cancel choice rather than firing the
// run immediately on click.
export function PreflightDialog({
  agentName,
  model,
  selectionText,
  onConfirm,
  onCancel
}: {
  agentName: string
  model: ModelRef
  selectionText: string
  onConfirm: () => void
  onCancel: () => void
}): JSX.Element {
  const navigate = useNavigate()
  // Read the catalog directly from global state rather than threading it in
  // as a prop, since AgentRail.tsx (this component's one call site) isn't
  // owned by this wave and shouldn't need an extra prop passed through.
  const modelCatalog = useAtlasStore((s) => s.modelCatalog)
  const { tokens, costUsd } = estimateAgentCost(selectionText, model, modelCatalog)
  const modelLabel = describeProvider(model)

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
          width: 360,
          padding: 20,
          borderRadius: 14,
          background: 'var(--c-surface-raised)',
          border: '1px solid var(--c-border)'
        }}
      >
        <div style={{ fontFamily: 'Source Serif 4, serif', fontWeight: 600, fontSize: 16, marginBottom: 8 }}>
          Send to {agentName}?
        </div>
        <div style={{ fontSize: 13, color: 'var(--c-ink-soft)', marginBottom: 14, lineHeight: 1.5 }}>
          Estimated {tokens.toLocaleString()} tokens on {modelLabel}
          {costUsd > 0 ? ` — about $${costUsd.toFixed(3)}.` : ' — free (local model).'}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onConfirm} style={btnStyle(true)}>
            Confirm
          </button>
          <button
            onClick={() => {
              onCancel()
              navigate('/settings')
            }}
            style={btnStyle(false)}
          >
            Change model
          </button>
          <button onClick={onCancel} style={btnStyle(false)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function btnStyle(primary: boolean) {
  return {
    flex: 1,
    padding: '8px 10px',
    borderRadius: 8,
    fontSize: 12.5,
    cursor: 'pointer',
    border: primary ? 'none' : '1px solid var(--c-border)',
    background: primary ? 'var(--c-accent)' : 'var(--c-surface)',
    color: primary ? '#fff' : 'var(--c-ink)'
  } as const
}
