import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AgentRole } from '@shared/schema/agent'
import { ManuscriptEditor, type ManuscriptEditorHandle } from '../components/ManuscriptEditor'
import { AgentRail } from '../components/AgentRail'
import { SuggestionCard } from '../components/SuggestionCard'
import { EditorialFindingCard } from '../components/EditorialFindingCard'
import { PermissionDialog } from '../components/PermissionDialog'
import { SceneMetadataPanel } from '../components/SceneMetadataPanel'
import { useAtlasStore } from '../state/store'

const SAVE_DEBOUNCE_MS = 800

const ROLE_NAME: Record<AgentRole, string> = {
  Generator: 'Generator',
  'Dev-Editor': 'Story Editor',
  'Line-Editor': 'Line Editor',
  Dialoguer: 'Dialogue Editor',
  'World-Builder': 'World Builder'
}

export function ManuscriptWorkspace(): JSX.Element {
  const tree = useAtlasStore((s) => s.manuscriptTree)
  const activeSceneId = useAtlasStore((s) => s.activeSceneId)
  const activeSuggestions = useAtlasStore((s) => s.activeSuggestions)
  const lastAgentSummary = useAtlasStore((s) => s.lastAgentSummary)
  const sceneSaveState = useAtlasStore((s) => s.sceneSaveState)
  const setSceneSaveState = useAtlasStore((s) => s.setSceneSaveState)
  const focusMode = useAtlasStore((s) => s.focusMode)
  const toggleFocusMode = useAtlasStore((s) => s.toggleFocusMode)
  const sceneProseVersion = useAtlasStore((s) => s.sceneProseVersion)
  const navigate = useNavigate()

  const [prose, setProse] = useState('')
  const editorRef = useRef<ManuscriptEditorHandle>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()

  const allScenes = (tree?.books ?? []).flatMap((b) => b.parts.flatMap((p) => p.chapters.flatMap((c) => c.scenes)))

  let breadcrumb: { book: string; part: string; chapter: string } | null = null
  for (const book of tree?.books ?? []) {
    for (const part of book.parts) {
      for (const chapter of part.chapters) {
        if (chapter.scenes.some((s) => s.id === activeSceneId)) {
          breadcrumb = { book: book.title, part: part.title, chapter: chapter.title }
        }
      }
    }
  }
  const activeScene = allScenes.find((s) => s.id === activeSceneId)

  const sceneSuggestions = activeSuggestions.filter((s) => s.targetSceneId === activeSceneId)
  const editorialFindings = sceneSuggestions.filter((s) => s.kind === 'editorial-finding')
  const trackedChanges = sceneSuggestions.filter((s) => s.kind === 'tracked-change')

  useEffect(() => {
    if (!activeSceneId) return
    void window.atlas.scenes.read(activeSceneId).then((result) => setProse(result.prose))
  }, [activeSceneId, sceneProseVersion])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape' && focusMode) toggleFocusMode()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focusMode, toggleFocusMode])

  function handleProseChange(nextProse: string): void {
    setProse(nextProse)
    setSceneSaveState('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      if (!activeSceneId) return
      void window.atlas.scenes.write(activeSceneId, { prose: nextProse }).then(() => setSceneSaveState('saved'))
    }, SAVE_DEBOUNCE_MS)
  }

  if (!activeSceneId) {
    return (
      <div style={{ maxWidth: 420, margin: '80px auto', padding: '0 32px', textAlign: 'center' }}>
        <div style={{ fontSize: 14, color: 'var(--c-ink-soft)', marginBottom: 16, lineHeight: 1.6 }}>
          This project doesn't have any manuscript structure yet — your Codex is the place to start.
        </div>
        <button
          onClick={() => navigate('/codex')}
          style={{
            padding: '9px 18px',
            borderRadius: 8,
            border: 'none',
            background: 'var(--c-accent)',
            color: '#fff',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          Review Codex
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      {!focusMode && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 24px',
            borderBottom: '1px solid var(--c-border)',
            background: 'var(--c-surface)',
            flexShrink: 0
          }}
        >
          <div style={{ fontSize: 12.5, color: 'var(--c-ink-faint)' }}>
            {breadcrumb ? (
              <>
                {breadcrumb.book} <span style={{ opacity: 0.5 }}>›</span> {breadcrumb.part}{' '}
                <span style={{ opacity: 0.5 }}>›</span>{' '}
                <span style={{ color: 'var(--c-ink)', fontWeight: 500 }}>{breadcrumb.chapter}</span>{' '}
                <span style={{ opacity: 0.5 }}>›</span> {activeScene?.title}
              </>
            ) : (
              activeScene?.title
            )}
          </div>
          <button onClick={toggleFocusMode} style={pillButtonStyle}>
            Distraction-free
          </button>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: focusMode ? '64px 0' : '40px 48px' }}>
          <div style={{ maxWidth: 700, margin: '0 auto' }}>
            {!focusMode && activeScene && (
              <>
                <SceneMetadataPanel scene={activeScene} />
                <div style={{ fontSize: 12, color: 'var(--c-ink-faint)', marginBottom: 16 }}>
                  {sceneSaveState === 'saved' ? 'All changes saved' : 'Saving…'}
                </div>
              </>
            )}
            <ManuscriptEditor
              ref={editorRef}
              sceneId={activeSceneId}
              prose={prose}
              onProseChange={handleProseChange}
              reloadToken={sceneProseVersion}
            />
          </div>
        </div>

        {!focusMode && (
          <aside
            style={{
              width: 300,
              flexShrink: 0,
              borderLeft: '1px solid var(--c-border)',
              padding: 16,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 20
            }}
          >
            <AgentRail sceneId={activeSceneId} getSelection={() => editorRef.current?.getSelectionText() ?? ''} />

            {lastAgentSummary && <div style={{ fontSize: 12.5, color: 'var(--c-ink-soft)' }}>{lastAgentSummary}</div>}

            {(editorialFindings.length > 0 || trackedChanges.length > 0) && (
              <div>
                <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', marginBottom: 10 }}>
                  Comments &amp; Tracked Changes
                </div>

                {editorialFindings.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', marginBottom: 8 }}>
                      {ROLE_NAME[editorialFindings[0].agentRole]}
                    </div>
                    {editorialFindings.map((s) => (
                      <EditorialFindingCard key={s.id} suggestion={s} />
                    ))}
                  </div>
                )}

                {trackedChanges.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', marginBottom: 8 }}>
                      {ROLE_NAME[trackedChanges[0].agentRole]} — Tracked Changes
                    </div>
                    {trackedChanges.map((s) => (
                      <SuggestionCard key={s.id} suggestion={s} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </aside>
        )}
      </div>

      {focusMode && (
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: 11.5,
            color: 'var(--c-ink-faint)',
            background: 'var(--c-surface)',
            border: '1px solid var(--c-border)',
            borderRadius: 999,
            padding: '5px 14px'
          }}
        >
          Press <strong>Esc</strong> to exit distraction-free mode
        </div>
      )}

      <PermissionDialog />
    </div>
  )
}

const pillButtonStyle = {
  padding: '7px 13px',
  borderRadius: 7,
  border: '1px solid var(--c-border)',
  background: 'transparent',
  color: 'var(--c-ink-soft)',
  fontSize: 12.5,
  cursor: 'pointer'
} as const
