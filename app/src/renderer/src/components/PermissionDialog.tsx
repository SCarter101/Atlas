import type { CSSProperties } from 'react'
import { useAtlasStore } from '../state/store'

export function PermissionDialog(): JSX.Element | null {
  const pending = useAtlasStore((s) => s.pendingPermission)
  const resolvePermission = useAtlasStore((s) => s.resolvePermission)

  if (!pending) return null
  const { request } = pending

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
          Permission requested
        </div>
        <div style={{ fontSize: 13, color: 'var(--c-ink-soft)', marginBottom: 4 }}>
          <strong>Capability:</strong> {request.capabilityId}
        </div>
        <div style={{ fontSize: 13, color: 'var(--c-ink-soft)', marginBottom: 4 }}>
          <strong>Action:</strong> {request.actionType}
        </div>
        <div style={{ fontSize: 13, color: 'var(--c-ink-soft)', marginBottom: 16 }}>
          <strong>Scope:</strong> {request.dataScope} · <strong>Destination:</strong> {request.destination}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={btnStyle(true)} onClick={() => resolvePermission('approved-once')}>
            Approve once
          </button>
          <button style={btnStyle(false)} onClick={() => resolvePermission('approved-session')}>
            Approve for session
          </button>
          <button style={btnStyle(false)} onClick={() => resolvePermission('denied')}>
            Deny
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--c-ink-faint)', marginTop: 10 }}>
          "Approve for session" is remembered and won't ask again for this exact capability, action, scope, and
          destination during this session.
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
    color: primary ? '#fff' : 'var(--c-ink)'
  }
}
