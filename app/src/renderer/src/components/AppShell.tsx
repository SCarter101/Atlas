import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import type { ManuscriptTree } from '@shared/schema/manuscript'
import { CommandPalette } from './CommandPalette'
import { useAtlasStore } from '../state/store'

const LEFT_NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/manuscript', label: 'Manuscript' },
  { to: '/codex', label: 'Codex' },
  { to: '/outline', label: 'Outline' },
  { to: '/timeline', label: 'Story Timeline' },
  { to: '/settings', label: 'Settings' }
]

const TOP_BAR_NAV_ITEMS = [
  { to: '/routing', label: 'Routing' },
  { to: '/agent-runs', label: 'Agent Runs' },
  { to: '/library', label: 'Library' }
]

// Mock snapshot history — real autosave snapshots are a Phase 3 concern
// (data-contracts §7); this is just the entry point the spec calls for.
const MOCK_SNAPSHOTS = [
  { label: 'Autosave · just now', detail: 'Current' },
  { label: 'Autosave · 22 min ago', detail: '22 min ago' },
  { label: 'Autosave · 54 min ago', detail: '54 min ago' }
]

export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  const manifest = useAtlasStore((s) => s.manifest)
  const theme = useAtlasStore((s) => s.theme)
  const toggleTheme = useAtlasStore((s) => s.toggleTheme)
  const exitToLanding = useAtlasStore((s) => s.exitToLanding)
  const focusMode = useAtlasStore((s) => s.focusMode)
  const activeSceneId = useAtlasStore((s) => s.activeSceneId)
  const setActiveScene = useAtlasStore((s) => s.setActiveScene)
  const manuscriptTree = useAtlasStore((s) => s.manuscriptTree)
  const sceneSaveState = useAtlasStore((s) => s.sceneSaveState)
  const location = useLocation()

  const [snapshotOpen, setSnapshotOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    // Custom properties cascade to descendants only, so setting data-theme
    // on this component's own wrapper div is enough to theme everything
    // inside it — but <body> sits above that div and would otherwise keep
    // resolving --c-bg from :root's paper default. Mirroring the attribute
    // onto <html> keeps body's own background in sync too.
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(true)
      } else if (e.key === 'Escape' && paletteOpen) {
        setPaletteOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [paletteOpen])

  const allScenes = (manuscriptTree?.books ?? []).flatMap((b) =>
    b.parts.flatMap((p) => p.chapters.flatMap((c) => c.scenes))
  )
  const activeScene = allScenes.find((s) => s.id === activeSceneId)
  const estimatedTokens = activeScene ? Math.round(activeScene.wordCount * 1.35) : 0

  return (
    <div
      data-theme={theme}
      style={{
        height: '100vh',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--c-bg)',
        color: 'var(--c-ink)',
        fontFamily: 'Public Sans, system-ui, sans-serif'
      }}
    >
      {!focusMode && (
        <header
          style={{
            height: 56,
            minHeight: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 20px',
            borderBottom: '1px solid var(--c-border)',
            background: 'var(--c-surface)',
            gap: 16,
            flexShrink: 0
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
            <button
              onClick={exitToLanding}
              title="All Projects"
              style={{ width: 28, height: 28, borderRadius: 7, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
            >
              <img src="/assets/atlas-icon.png" alt="All Projects" style={{ width: 28, height: 28, borderRadius: 7, display: 'block' }} />
            </button>
            <div
              style={{
                fontFamily: 'Source Serif 4, Georgia, serif',
                fontSize: 17,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {manifest?.title ?? '—'}
            </div>
            <div style={{ width: 1, height: 18, background: 'var(--c-border)', flexShrink: 0 }} />
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <button
                onClick={() => setSnapshotOpen((v) => !v)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 12.5,
                  color: 'var(--c-ink-faint)',
                  textDecoration: 'underline',
                  whiteSpace: 'nowrap'
                }}
              >
                {sceneSaveState === 'saved' ? 'All changes saved' : 'Saving…'}
              </button>
              {snapshotOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: 26,
                    left: 0,
                    width: 240,
                    background: 'var(--c-surface-raised)',
                    border: '1px solid var(--c-border)',
                    borderRadius: 10,
                    boxShadow: '0 12px 28px rgba(0,0,0,0.16)',
                    padding: 10,
                    zIndex: 40
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', padding: '2px 6px 8px' }}>
                    Snapshot history
                  </div>
                  {MOCK_SNAPSHOTS.map((snap) => (
                    <div key={snap.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 6px', fontSize: 12 }}>
                      <span>{snap.label}</span>
                      <span style={{ color: 'var(--c-ink-faint)' }}>{snap.detail}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {TOP_BAR_NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                style={({ isActive }) => ({
                  padding: '7px 12px',
                  borderRadius: 7,
                  border: `1px solid ${isActive ? '#A9834E' : '#C9AD82'}`,
                  background: isActive ? '#C7A876' : '#E4D3AF',
                  color: isActive ? '#3A2A14' : '#5C4327',
                  fontSize: 12.5,
                  fontWeight: isActive ? 700 : 600,
                  textDecoration: 'none',
                  whiteSpace: 'nowrap'
                })}
              >
                {item.label}
              </NavLink>
            ))}
            <button
              onClick={() => setPaletteOpen(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 10px',
                borderRadius: 7,
                border: '1px solid var(--c-border)',
                background: 'var(--c-bg)',
                color: 'var(--c-ink-soft)',
                fontSize: 12.5,
                cursor: 'pointer'
              }}
            >
              <span>Search</span>
              <span
                style={{
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: 11,
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: 'var(--c-surface-raised)',
                  border: '1px solid var(--c-border)'
                }}
              >
                ⌘K
              </span>
            </button>
            <div style={{ display: 'flex', alignItems: 'center', borderRadius: 7, border: '1px solid var(--c-border)', overflow: 'hidden' }}>
              <button
                onClick={() => theme !== 'paper' && toggleTheme()}
                style={{
                  padding: '6px 12px',
                  fontSize: 12,
                  border: 'none',
                  cursor: 'pointer',
                  background: theme === 'paper' ? 'var(--c-accent)' : 'transparent',
                  color: theme === 'paper' ? '#fff' : 'var(--c-ink-soft)'
                }}
              >
                Paper
              </button>
              <button
                onClick={() => theme !== 'night' && toggleTheme()}
                style={{
                  padding: '6px 12px',
                  fontSize: 12,
                  border: 'none',
                  cursor: 'pointer',
                  background: theme === 'night' ? 'var(--c-accent)' : 'transparent',
                  color: theme === 'night' ? '#fff' : 'var(--c-ink-soft)'
                }}
              >
                Night
              </button>
            </div>
            <NavLink
              to="/export"
              style={{
                padding: '7px 13px',
                borderRadius: 7,
                border: '1px solid var(--c-border)',
                background: 'transparent',
                color: 'var(--c-ink-soft)',
                fontSize: 12.5,
                textDecoration: 'none',
                whiteSpace: 'nowrap'
              }}
            >
              Export
            </NavLink>
          </div>
        </header>
      )}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {!focusMode && (
          <nav
            style={{
              width: 216,
              minWidth: 216,
              borderRight: '1px solid var(--c-border)',
              background: 'var(--c-surface)',
              padding: '18px 12px',
              overflowY: 'auto'
            }}
          >
            <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-ink-faint)', padding: '0 8px 8px' }}>
              Project
            </div>
            {LEFT_NAV_ITEMS.map((item) => (
              <NavItem key={item.to} to={item.to} label={item.label} />
            ))}

            {location.pathname === '/manuscript' && manuscriptTree && (
              <ContextualOutline
                tree={manuscriptTree}
                activeSceneId={activeSceneId}
                onSelectChapterFirstScene={setActiveScene}
              />
            )}
          </nav>
        )}

        <main style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>{children}</main>
      </div>

      {!focusMode && (
        <div
          style={{
            height: 28,
            minHeight: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 20px',
            borderTop: '1px solid var(--c-border)',
            background: 'var(--c-surface)',
            fontSize: 11,
            color: 'var(--c-ink-faint)',
            flexShrink: 0
          }}
        >
          <div>{activeScene ? `${activeScene.title} · ${activeScene.wordCount} words · ${activeScene.status}` : '—'}</div>
          <div style={{ display: 'flex', gap: 16 }}>
            {activeScene && <span>~{estimatedTokens} tokens est.</span>}
            <span>{sceneSaveState === 'saved' ? 'Saved' : 'Saving…'}</span>
          </div>
        </div>
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}

// Contextual mini-outline shown under the main left nav while on the
// Manuscript view — see spec §10 ("Outline panel" as progressive
// disclosure). Chapter-level only, matching the Phase 1 prototype; clicking
// a chapter jumps to its first scene.
function ContextualOutline({
  tree,
  activeSceneId,
  onSelectChapterFirstScene
}: {
  tree: ManuscriptTree
  activeSceneId: string | null
  onSelectChapterFirstScene: (sceneId: string) => void
}): JSX.Element | null {
  const book = tree.books[0]
  const part = book?.parts[0]
  if (!book || !part) return null

  return (
    <>
      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-ink-faint)', padding: '18px 8px 8px' }}>
        Outline
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--c-ink-soft)', padding: '0 8px' }}>
        <div style={{ fontWeight: 600, color: 'var(--c-ink)', marginBottom: 6 }}>{book.title}</div>
        <div style={{ paddingLeft: 10, marginBottom: 4, color: 'var(--c-ink-faint)' }}>{part.title}</div>
        {part.chapters.map((chapter) => {
          const isCurrent = chapter.scenes.some((s) => s.id === activeSceneId)
          return (
            <button
              key={chapter.id}
              onClick={() => {
                const firstScene = chapter.scenes[0]
                if (firstScene) onSelectChapterFirstScene(firstScene.id)
              }}
              disabled={chapter.scenes.length === 0}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                width: '100%',
                textAlign: 'left',
                paddingLeft: 16,
                paddingTop: 4,
                paddingBottom: 4,
                marginBottom: 3,
                borderRadius: 5,
                border: 'none',
                background: isCurrent ? 'var(--c-accent-soft)' : 'transparent',
                cursor: chapter.scenes.length === 0 ? 'default' : 'pointer'
              }}
            >
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: isCurrent ? 'var(--c-accent)' : 'var(--c-ink-faint)', flexShrink: 0 }} />
              <span style={{ color: isCurrent ? 'var(--c-accent-text)' : 'var(--c-ink-soft)', fontWeight: isCurrent ? 600 : 400 }}>
                {chapter.title}
              </span>
            </button>
          )
        })}
      </div>
    </>
  )
}

function NavItem({ to, label }: { to: string; label: string }): JSX.Element {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '9px 12px',
        borderRadius: 8,
        border: `1px solid ${isActive ? 'var(--c-accent)' : 'var(--c-border)'}`,
        marginBottom: 6,
        fontSize: 13.5,
        textDecoration: 'none',
        background: isActive ? 'var(--c-accent-soft)' : 'var(--c-surface-raised)',
        color: isActive ? 'var(--c-accent-text)' : 'var(--c-ink-soft)',
        fontWeight: isActive ? 600 : 500
      })}
    >
      {label}
    </NavLink>
  )
}
