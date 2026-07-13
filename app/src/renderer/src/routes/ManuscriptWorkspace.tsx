import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AgentRole, InsertionPayload, SuggestionRef } from '@shared/schema/agent'
import { isReviewable, nextReviewIndex, orderSuggestionsForReview, prevReviewIndex } from '@shared/suggestionReview'
import { ManuscriptEditor, type ManuscriptEditorHandle } from '../components/ManuscriptEditor'
import { AgentRail } from '../components/AgentRail'
import { SuggestionCard } from '../components/SuggestionCard'
import { EditorialFindingCard } from '../components/EditorialFindingCard'
import { GeneratorSuggestionCard } from '../components/GeneratorSuggestionCard'
import { DraftComparisonView } from '../components/DraftComparisonView'
import { DialogueAlternativeCard } from '../components/DialogueAlternativeCard'
import { CodexAdditionCard } from '../components/CodexAdditionCard'
import { MetadataProposalCard } from '../components/MetadataProposalCard'
import { CapabilityRecommendationCard } from '../components/CapabilityRecommendationCard'
import { PermissionDialog } from '../components/PermissionDialog'
import { CloudConsentDialog } from '../components/CloudConsentDialog'
import { SceneMetadataPanel } from '../components/SceneMetadataPanel'
import { ReadAloudControl } from '../components/ReadAloudControl'
import { SprintTimer, SprintTimerCompactPill, useSprintTimer } from '../components/SprintTimer'
import { SnapshotDiffView } from '../components/SnapshotDiffView'
import { countWords } from '../lib/textStats'
import { useAtlasStore } from '../state/store'

// Keyboard-first suggestion review (Phase 4 spec: J/K next/previous, A
// accept, R reject). Guards against stealing keystrokes from the writer —
// bails whenever the active element is a text input, a textarea, or
// contenteditable (Tiptap's ProseMirror root sets `contenteditable`, which
// `isContentEditable` picks up natively), and whenever a modifier key is
// held (so Ctrl/Cmd+R, for example, still reaches the browser/OS).
function isTypingTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return (el as HTMLElement).isContentEditable === true
}

const focusRingStyle: CSSProperties = {
  outline: '2px solid var(--c-accent)',
  outlineOffset: 2,
  borderRadius: 10
}

function SectionHeader({
  label,
  items,
  onAcceptAll
}: {
  label: string
  items: SuggestionRef[]
  onAcceptAll: (items: SuggestionRef[]) => void
}): JSX.Element {
  const pendingCount = items.filter(isReviewable).length
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--c-ink-faint)'
        }}
      >
        {label}
      </div>
      {pendingCount > 0 && (
        <button
          onClick={() => onAcceptAll(items)}
          style={{
            flexShrink: 0,
            fontSize: 10.5,
            fontWeight: 600,
            padding: '3px 9px',
            borderRadius: 999,
            border: '1px solid var(--c-border)',
            background: 'transparent',
            color: 'var(--c-accent-text)',
            cursor: 'pointer'
          }}
        >
          Accept all ({pendingCount})
        </button>
      )}
    </div>
  )
}

// Splits Generator `insertion` suggestions into ordinary single drafts
// (rendered one card each, as before) and groups sharing a draftGroupId —
// the output of the opt-in "Generate Alternatives" mode — rendered together
// via DraftComparisonView so they read as one comparable set instead of N
// unrelated cards.
function partitionInsertions(insertions: SuggestionRef[]): { single: SuggestionRef[]; groups: SuggestionRef[][] } {
  const single: SuggestionRef[] = []
  const groupsById = new Map<string, SuggestionRef[]>()

  for (const s of insertions) {
    const groupId = (s.payload as InsertionPayload).draftGroupId
    if (!groupId) {
      single.push(s)
      continue
    }
    const list = groupsById.get(groupId) ?? []
    list.push(s)
    groupsById.set(groupId, list)
  }

  return { single, groups: [...groupsById.values()] }
}

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
  const lastSavedAt = useAtlasStore((s) => s.lastSavedAt)
  const setSceneSaveState = useAtlasStore((s) => s.setSceneSaveState)
  const focusMode = useAtlasStore((s) => s.focusMode)
  const toggleFocusMode = useAtlasStore((s) => s.toggleFocusMode)
  const sceneProseVersion = useAtlasStore((s) => s.sceneProseVersion)
  const setSuggestionState = useAtlasStore((s) => s.setSuggestionState)
  const navigate = useNavigate()

  const [prose, setProse] = useState('')
  const [focusedSuggestionId, setFocusedSuggestionId] = useState<string | null>(null)
  const [showRevisionHistory, setShowRevisionHistory] = useState(false)
  const [showRecoveryBanner, setShowRecoveryBanner] = useState(false)
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
  const insertions = sceneSuggestions.filter((s) => s.kind === 'insertion')
  const { single: singleInsertions, groups: draftGroups } = partitionInsertions(insertions)
  const dialogueAlternatives = sceneSuggestions.filter((s) => s.kind === 'dialogue-alternative')
  const codexAdditions = sceneSuggestions.filter((s) => s.kind === 'codex-addition')
  const metadataProposals = sceneSuggestions.filter((s) => s.kind === 'metadata-proposal')
  const capabilityRecommendations = sceneSuggestions.filter((s) => s.kind === 'capability-recommendation')
  const orderedSuggestions = orderSuggestionsForReview(sceneSuggestions)
  const savedLabel =
    sceneSaveState === 'saved' && lastSavedAt
      ? `All changes saved · ${new Date(lastSavedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : 'All changes saved'

  useEffect(() => {
    if (!activeSceneId) return
    void window.atlas.scenes.read(activeSceneId).then((result) => setProse(result.prose))
  }, [activeSceneId, sceneProseVersion])

  useEffect(() => {
    void window.atlas.backups.recoveryStatus().then((status) => setShowRecoveryBanner(status.recoveryAvailable))
  }, [])

  // Clear keyboard-review focus whenever the scene changes so J/K doesn't
  // silently resume mid-list on a suggestion belonging to the old scene.
  useEffect(() => {
    setFocusedSuggestionId(null)
  }, [activeSceneId])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape' && focusMode) {
        toggleFocusMode()
        return
      }
      // Keyboard-first suggestion review (J/K/A/R). Never in focus mode
      // (the review rail isn't even rendered there), never with a modifier
      // held (so e.g. Ctrl+R still reaches the browser), and never while
      // the writer is actually typing — see isTypingTarget above.
      if (focusMode) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isTypingTarget(document.activeElement)) return
      if (orderedSuggestions.length === 0) return

      const key = e.key.toLowerCase()
      if (key === 'j' || key === 'k') {
        e.preventDefault()
        const currentIndex = orderedSuggestions.findIndex((s) => s.id === focusedSuggestionId)
        const nextIdx = key === 'j' ? nextReviewIndex(currentIndex, orderedSuggestions.length) : prevReviewIndex(currentIndex, orderedSuggestions.length)
        const next = orderedSuggestions[nextIdx]
        if (next) {
          setFocusedSuggestionId(next.id)
          document.getElementById(`suggestion-${next.id}`)?.scrollIntoView({ block: 'nearest' })
        }
      } else if (key === 'a' || key === 'r') {
        const target = orderedSuggestions.find((s) => s.id === focusedSuggestionId)
        if (!target || !isReviewable(target)) return
        e.preventDefault()
        void setSuggestionState(target.id, key === 'a' ? 'accepted' : 'rejected')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focusMode, toggleFocusMode, orderedSuggestions, focusedSuggestionId, setSuggestionState])

  // Batch acceptance by issue category — loops setSuggestionState over every
  // still-reviewable suggestion in a section, sequentially (not
  // Promise.all) because acceptance for tracked-change/insertion kinds
  // read-modify-writes the scene's prose via IPC; concurrent writes could
  // race and clobber each other.
  async function acceptAllInSection(items: SuggestionRef[]): Promise<void> {
    for (const s of items.filter(isReviewable)) {
      await setSuggestionState(s.id, 'accepted')
    }
  }

  function handleProseChange(nextProse: string): void {
    setProse(nextProse)
    setSceneSaveState('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      if (!activeSceneId) return
      void window.atlas.scenes.write(activeSceneId, { prose: nextProse }).then(() => setSceneSaveState('saved'))
    }, SAVE_DEBOUNCE_MS)
  }

  // Called unconditionally (before the early return below) and kept alive
  // for the lifetime of this route component — see the comment on
  // useSprintTimer for why a running sprint must not live inside a
  // component that gets mounted/unmounted as focusMode toggles.
  const sprint = useSprintTimer(prose)

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
      {showRecoveryBanner && !focusMode && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            padding: '10px 24px',
            borderBottom: '1px solid var(--c-border)',
            background: 'var(--c-surface-raised)',
            color: 'var(--c-ink-soft)',
            fontSize: 12.5,
            flexShrink: 0
          }}
        >
          <span>
            Your last session may not have closed cleanly. Your work autosaves to disk; you can also restore an earlier backup in Settings.
          </span>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button onClick={() => navigate('/settings')} style={pillButtonStyle}>
              Settings
            </button>
            <button onClick={() => setShowRecoveryBanner(false)} style={pillButtonStyle}>
              Dismiss
            </button>
          </div>
        </div>
      )}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ReadAloudControl sceneId={activeSceneId} prose={prose} />
            <SprintTimer sprint={sprint} />
            <button onClick={() => setShowRevisionHistory((v) => !v)} style={pillButtonStyle}>
              {showRevisionHistory ? 'Hide revision history' : 'Revision history'}
            </button>
            <button onClick={toggleFocusMode} style={pillButtonStyle}>
              Distraction-free
            </button>
          </div>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: focusMode ? '64px 0' : '40px 48px' }}>
          <div style={{ maxWidth: 700, margin: '0 auto' }}>
            {!focusMode && activeScene && (
              <>
                <SceneMetadataPanel scene={activeScene} />
                <div style={{ fontSize: 12, color: 'var(--c-ink-faint)', marginBottom: 16 }}>
                  {sceneSaveState === 'saved' ? savedLabel : 'Saving…'}
                </div>
              </>
            )}
            {!focusMode && showRevisionHistory && activeSceneId && (
              <div style={{ marginBottom: 20 }}>
                <SnapshotDiffView sceneId={activeSceneId} />
              </div>
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

            {(editorialFindings.length > 0 ||
              trackedChanges.length > 0 ||
              insertions.length > 0 ||
              dialogueAlternatives.length > 0 ||
              codexAdditions.length > 0 ||
              metadataProposals.length > 0 ||
              capabilityRecommendations.length > 0) && (
              <div>
                <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', marginBottom: 10 }}>
                  Comments &amp; Tracked Changes
                </div>

                {editorialFindings.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <SectionHeader
                      label={ROLE_NAME[editorialFindings[0].agentRole]}
                      items={editorialFindings}
                      onAcceptAll={acceptAllInSection}
                    />
                    {editorialFindings.map((s) => (
                      <div key={s.id} id={`suggestion-${s.id}`} style={s.id === focusedSuggestionId ? focusRingStyle : undefined}>
                        <EditorialFindingCard suggestion={s} />
                      </div>
                    ))}
                  </div>
                )}

                {trackedChanges.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <SectionHeader
                      label={`${ROLE_NAME[trackedChanges[0].agentRole]} — Tracked Changes`}
                      items={trackedChanges}
                      onAcceptAll={acceptAllInSection}
                    />
                    {trackedChanges.map((s) => (
                      <div key={s.id} id={`suggestion-${s.id}`} style={s.id === focusedSuggestionId ? focusRingStyle : undefined}>
                        <SuggestionCard suggestion={s} />
                      </div>
                    ))}
                  </div>
                )}

                {insertions.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <SectionHeader
                      label={`${ROLE_NAME[insertions[0].agentRole]} — Suggested Insertions`}
                      items={singleInsertions}
                      onAcceptAll={acceptAllInSection}
                    />
                    {draftGroups.map((group) => (
                      <DraftComparisonView
                        key={(group[0].payload as InsertionPayload).draftGroupId}
                        suggestions={group}
                        focusedSuggestionId={focusedSuggestionId}
                      />
                    ))}
                    {singleInsertions.map((s) => (
                      <div key={s.id} id={`suggestion-${s.id}`} style={s.id === focusedSuggestionId ? focusRingStyle : undefined}>
                        <GeneratorSuggestionCard suggestion={s} />
                      </div>
                    ))}
                  </div>
                )}

                {dialogueAlternatives.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <SectionHeader
                      label={`${ROLE_NAME[dialogueAlternatives[0].agentRole]} — Dialogue Alternatives`}
                      items={dialogueAlternatives}
                      onAcceptAll={acceptAllInSection}
                    />
                    {dialogueAlternatives.map((s) => (
                      <div key={s.id} id={`suggestion-${s.id}`} style={s.id === focusedSuggestionId ? focusRingStyle : undefined}>
                        <DialogueAlternativeCard suggestion={s} />
                      </div>
                    ))}
                  </div>
                )}

                {codexAdditions.length > 0 && (
                  <div style={{ marginBottom: metadataProposals.length > 0 || capabilityRecommendations.length > 0 ? 16 : 0 }}>
                    <SectionHeader
                      label={`${ROLE_NAME[codexAdditions[0].agentRole]} — Codex Additions`}
                      items={codexAdditions}
                      onAcceptAll={acceptAllInSection}
                    />
                    {codexAdditions.map((s) => (
                      <div key={s.id} id={`suggestion-${s.id}`} style={s.id === focusedSuggestionId ? focusRingStyle : undefined}>
                        <CodexAdditionCard suggestion={s} />
                      </div>
                    ))}
                  </div>
                )}

                {metadataProposals.length > 0 && (
                  <div style={{ marginBottom: capabilityRecommendations.length > 0 ? 16 : 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', marginBottom: 8 }}>
                      {ROLE_NAME[metadataProposals[0].agentRole]} — Proposed Metadata
                    </div>
                    {metadataProposals.map((s) => (
                      <MetadataProposalCard key={s.id} suggestion={s} />
                    ))}
                  </div>
                )}

                {capabilityRecommendations.length > 0 && (
                  <div>
                    <SectionHeader
                      label={`${ROLE_NAME[capabilityRecommendations[0].agentRole]} — Recommended Capabilities`}
                      items={capabilityRecommendations}
                      onAcceptAll={acceptAllInSection}
                    />
                    {capabilityRecommendations.map((s) => (
                      <div key={s.id} id={`suggestion-${s.id}`} style={s.id === focusedSuggestionId ? focusRingStyle : undefined}>
                        <CapabilityRecommendationCard suggestion={s} />
                      </div>
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

      {/* A running/just-finished sprint stays visible even with the toolbar
          hidden — see SprintTimerCompactPill's comment. */}
      {focusMode && <SprintTimerCompactPill sprint={sprint} />}

      {/* Word count is otherwise shown in AppShell's bottom bar, which
          distraction-free mode hides along with the rest of the chrome.
          Spec: "Word count may appear on hover or keyboard focus" — hidden
          by default via the .focus-word-count class in tokens.css. */}
      {focusMode && (
        <div
          tabIndex={0}
          className="focus-word-count"
          style={{
            position: 'absolute',
            bottom: 16,
            right: 16,
            fontSize: 11.5,
            color: 'var(--c-ink-faint)',
            background: 'var(--c-surface)',
            border: '1px solid var(--c-border)',
            borderRadius: 999,
            padding: '5px 14px'
          }}
        >
          {countWords(prose)} words
        </div>
      )}

      <PermissionDialog />
      <CloudConsentDialog />
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
