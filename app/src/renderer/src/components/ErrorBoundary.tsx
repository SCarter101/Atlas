import { Component, type ErrorInfo, type ReactNode } from 'react'
import { normalizeError } from '@shared/errors'

// Last line of defence for a render/routing crash. Sits OUTSIDE the router in
// main.tsx so even a bad route or a throw during render is caught and shown a
// calm recovery panel instead of a blank white window. React only routes
// render-phase errors here — async/event-handler rejections are surfaced via
// the global toast surface (initErrorHandling.ts) instead.

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[error-boundary] render crash', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    const { message } = normalizeError(error)

    return (
      <div
        style={{
          height: '100vh',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--c-bg)',
          color: 'var(--c-ink)',
          fontFamily: 'Public Sans, system-ui, sans-serif',
          padding: 24
        }}
      >
        <div
          style={{
            maxWidth: 440,
            width: '100%',
            background: 'var(--c-surface)',
            border: '1px solid var(--c-border)',
            borderRadius: 12,
            padding: 28,
            boxShadow: '0 12px 28px rgba(0,0,0,0.16)'
          }}
        >
          <div
            style={{
              fontFamily: 'Source Serif 4, Georgia, serif',
              fontSize: 20,
              fontWeight: 600,
              marginBottom: 10
            }}
          >
            Something went wrong
          </div>
          <p style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--c-ink-soft)', margin: '0 0 20px' }}>
            Atlas hit an unexpected error and stopped rendering. Your work is saved to disk on every
            change, so reloading is safe.
          </p>
          <div
            style={{
              fontFamily: 'ui-monospace, monospace',
              fontSize: 12,
              color: 'var(--c-ink-faint)',
              background: 'var(--c-bg)',
              border: '1px solid var(--c-border)',
              borderRadius: 8,
              padding: '10px 12px',
              marginBottom: 20,
              wordBreak: 'break-word'
            }}
          >
            {message}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                flex: 1,
                padding: '10px 14px',
                borderRadius: 8,
                border: 'none',
                background: 'var(--c-accent)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Reload
            </button>
            <button
              onClick={() => {
                window.location.hash = '#/'
                window.location.reload()
              }}
              style={{
                flex: 1,
                padding: '10px 14px',
                borderRadius: 8,
                border: '1px solid var(--c-border)',
                background: 'var(--c-surface-raised)',
                color: 'var(--c-ink-soft)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Back to projects
            </button>
          </div>
        </div>
      </div>
    )
  }
}
