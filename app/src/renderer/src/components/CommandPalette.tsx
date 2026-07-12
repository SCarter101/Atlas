import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAtlasStore } from '../state/store'

interface Command {
  label: string
  group: string
  run: () => void
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const navigate = useNavigate()
  const toggleTheme = useAtlasStore((s) => s.toggleTheme)
  const toggleFocusMode = useAtlasStore((s) => s.toggleFocusMode)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  if (!open) return null

  const commands: Command[] = [
    { label: 'Go to Dashboard', group: 'Navigate', run: () => navigate('/dashboard') },
    { label: 'Go to Manuscript', group: 'Navigate', run: () => navigate('/manuscript') },
    { label: 'Go to Codex', group: 'Navigate', run: () => navigate('/codex') },
    { label: 'Go to Outline', group: 'Navigate', run: () => navigate('/outline') },
    { label: 'Go to Story Timeline', group: 'Navigate', run: () => navigate('/timeline') },
    { label: 'Go to Agent Routing', group: 'Navigate', run: () => navigate('/routing') },
    { label: 'Go to Agent Runs', group: 'Navigate', run: () => navigate('/agent-runs') },
    { label: 'Go to Tool & Skill Library', group: 'Navigate', run: () => navigate('/library') },
    { label: 'Go to Export', group: 'Navigate', run: () => navigate('/export') },
    { label: 'Go to Settings', group: 'Navigate', run: () => navigate('/settings') },
    { label: 'Toggle Paper / Night theme', group: 'View', run: toggleTheme },
    { label: 'Toggle distraction-free mode', group: 'View', run: () => { navigate('/manuscript'); toggleFocusMode() } }
  ]

  const results = query ? commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase())) : commands

  function run(cmd: Command): void {
    cmd.run()
    onClose()
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
        zIndex: 200
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480,
          maxHeight: '60vh',
          borderRadius: 12,
          background: 'var(--c-surface-raised)',
          border: '1px solid var(--c-border)',
          boxShadow: '0 20px 48px rgba(0,0,0,0.25)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results.length) run(results[0])
            if (e.key === 'Escape') onClose()
          }}
          placeholder="Search or run a command…"
          style={{
            padding: '14px 16px',
            border: 'none',
            borderBottom: '1px solid var(--c-border)',
            fontSize: 14,
            background: 'transparent',
            color: 'var(--c-ink)'
          }}
        />
        <div style={{ overflowY: 'auto', padding: 6 }}>
          {results.map((cmd) => (
            <button
              key={cmd.label}
              onClick={() => run(cmd)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                width: '100%',
                textAlign: 'left',
                padding: '9px 12px',
                borderRadius: 8,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 13.5,
                color: 'var(--c-ink)'
              }}
            >
              <span>{cmd.label}</span>
              <span style={{ fontSize: 11, color: 'var(--c-ink-faint)' }}>{cmd.group}</span>
            </button>
          ))}
          {results.length === 0 && (
            <div style={{ padding: '12px 12px', fontSize: 13, color: 'var(--c-ink-faint)' }}>No matches.</div>
          )}
        </div>
      </div>
    </div>
  )
}
