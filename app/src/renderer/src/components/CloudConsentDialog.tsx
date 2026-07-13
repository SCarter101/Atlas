import type { CSSProperties } from 'react'
import { useAtlasStore } from '../state/store'

export function CloudConsentDialog(): JSX.Element | null {
  const pending = useAtlasStore((s) => s.pendingCloudConsent)
  const resolveCloudConsent = useAtlasStore((s) => s.resolveCloudConsent)

  if (!pending) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--c-overlay)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100
      }}
    >
      <div
        style={{
          width: 420,
          padding: 20,
          borderRadius: 14,
          background: 'var(--c-surface-raised)',
          border: '1px solid var(--c-border)'
        }}
      >
        <div style={{ fontFamily: 'Source Serif 4, serif', fontWeight: 600, fontSize: 16, marginBottom: 8 }}>
          Cloud model authorization
        </div>
        <div style={{ fontSize: 13, color: 'var(--c-ink-soft)', marginBottom: 8, lineHeight: 1.5 }}>
          <strong>Provider:</strong> {pending.providerLabel}
        </div>
        <div style={{ fontSize: 13, color: 'var(--c-ink-soft)', marginBottom: 8, lineHeight: 1.5 }}>
          Scene text would be sent to this provider for the agent run (simulated in this build).
        </div>
        {pending.warnCloudUnpublished && (
          <div style={{ fontSize: 12.5, color: 'var(--c-amber)', marginBottom: 16, lineHeight: 1.5 }}>
            Unpublished manuscript content may be included in the run context.
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={btnStyle(true)} onClick={() => resolveCloudConsent('authorized-once')}>
            Authorize once
          </button>
          <button style={btnStyle(false)} onClick={() => resolveCloudConsent('authorized-session')}>
            Authorize for session
          </button>
          <button style={btnStyle(false)} onClick={() => resolveCloudConsent('cancelled')}>
            Cancel
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--c-ink-faint)', marginTop: 10, lineHeight: 1.5 }}>
          Session authorization is cleared when you open or create a project.
        </div>
      </div>
    </div>
  )
}

function btnStyle(primary: boolean): CSSProperties {
  return {
    flex: 1,
    padding: '8px 10px',
    borderRadius: 8,
    fontSize: 12.5,
    cursor: 'pointer',
    border: primary ? 'none' : '1px solid var(--c-border)',
    background: primary ? 'var(--c-accent)' : 'var(--c-surface)',
    color: primary ? 'var(--c-on-accent)' : 'var(--c-ink)'
  }
}
