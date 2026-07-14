import { useEffect } from 'react'
import { markCheatSheetSeen } from '../lib/onboardingStorage'

interface ShortcutEntry {
  keys: string
  description: string
}

interface ShortcutGroup {
  title: string
  shortcuts: ShortcutEntry[]
}

// Lists the shortcuts that are actually wired up today — checked against
// ManuscriptWorkspace.tsx's onKeyDown handler and shared/suggestionReview.ts
// (J/K/A/R + per-section "Accept all" is a button, not a shortcut, so it's
// listed as an action rather than a key combo) and AppShell.tsx's own
// Cmd/Ctrl+K and Escape handling. No aspirational/planned shortcuts are
// listed here.
const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Suggestion review (Manuscript workspace)',
    shortcuts: [
      { keys: 'J', description: 'Focus the next suggestion card' },
      { keys: 'K', description: 'Focus the previous suggestion card' },
      { keys: 'A', description: 'Accept the focused suggestion' },
      { keys: 'R', description: 'Reject the focused suggestion' }
    ]
  },
  {
    title: 'Navigation',
    shortcuts: [
      { keys: 'Ctrl/⌘ + K', description: 'Open the command palette (search or jump anywhere)' },
      { keys: 'Esc', description: 'Close the command palette, or exit distraction-free mode' }
    ]
  }
]

// Actions that exist and matter for review, but aren't a single keypress —
// worth surfacing here anyway so this cheat sheet is a complete "how do I
// review suggestions fast" reference, not just a literal key list.
const RELATED_ACTIONS = [
  'Each suggestion section (Story Editor findings, tracked changes, drafts, dialogue alternatives, Codex additions, and so on) has its own "Accept all" button for batch-accepting everything still pending in that section.',
  'Every suggestion card has a Refine box: type a follow-up instruction and it re-runs the same agent against its own prior output.'
]

export function ShortcutCheatSheet({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  useEffect(() => {
    if (!open) return
    markCheatSheetSeen()
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      onClick={onClose}
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Keyboard shortcuts"
        style={{
          width: 460,
          maxWidth: 'calc(100vw - 48px)',
          maxHeight: '78vh',
          overflowY: 'auto',
          borderRadius: 14,
          background: 'var(--c-surface-raised)',
          border: '1px solid var(--c-border)',
          boxShadow: '0 20px 48px rgba(0,0,0,0.28)',
          padding: 26
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ fontFamily: 'Source Serif 4, Georgia, serif', fontSize: 19, fontWeight: 600, color: 'var(--c-ink)' }}>
            Keyboard shortcuts
          </div>
          <button
            onClick={onClose}
            title="Close"
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--c-ink-faint)',
              fontSize: 18,
              lineHeight: 1,
              padding: 0
            }}
          >
            ×
          </button>
        </div>

        {SHORTCUT_GROUPS.map((group) => (
          <div key={group.title} style={{ marginBottom: 18 }}>
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
              {group.title}
            </div>
            {group.shortcuts.map((s) => (
              <div
                key={s.keys}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '6px 0',
                  borderBottom: '1px solid var(--c-border)'
                }}
              >
                <span
                  style={{
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 12,
                    padding: '3px 9px',
                    borderRadius: 5,
                    background: 'var(--c-bg)',
                    border: '1px solid var(--c-border)',
                    color: 'var(--c-ink)',
                    whiteSpace: 'nowrap',
                    flexShrink: 0
                  }}
                >
                  {s.keys}
                </span>
                <span style={{ fontSize: 13, color: 'var(--c-ink-soft)' }}>{s.description}</span>
              </div>
            ))}
          </div>
        ))}

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
          Related, not a shortcut
        </div>
        {RELATED_ACTIONS.map((text) => (
          <div key={text} style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--c-ink-faint)', marginBottom: 8 }}>
            {text}
          </div>
        ))}
      </div>
    </div>
  )
}
