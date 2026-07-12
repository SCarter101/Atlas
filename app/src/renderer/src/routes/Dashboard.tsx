import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CodexEntry } from '@shared/schema/codex'
import type { SessionSummary } from '@shared/schema/session'
import { CHAPTER_STATUS_LABEL, deriveChapterStatus } from '@shared/deriveChapterStatus'
import { useAtlasStore } from '../state/store'

function timeOfDayGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(ms / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

const STATUS_BADGE: Record<string, { bg: string; color: string }> = {
  drafted: { bg: 'var(--c-green-soft)', color: 'var(--c-green)' },
  'in-progress': { bg: 'var(--c-amber-soft)', color: 'var(--c-amber)' },
  'not-started': { bg: 'var(--c-border)', color: 'var(--c-ink-faint)' }
}

export function Dashboard(): JSX.Element {
  const manifest = useAtlasStore((s) => s.manifest)
  const tree = useAtlasStore((s) => s.manuscriptTree)
  const activeSceneId = useAtlasStore((s) => s.activeSceneId)
  const activeSuggestions = useAtlasStore((s) => s.activeSuggestions)
  const navigate = useNavigate()
  const [streakOpen, setStreakOpen] = useState(false)
  const [codexEntries, setCodexEntries] = useState<CodexEntry[]>([])
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null)

  useEffect(() => {
    void window.atlas.codex.list().then(setCodexEntries)
  }, [])

  useEffect(() => {
    void window.atlas.sessions.summary().then(setSessionSummary)
  }, [])

  const book = tree?.books[0]
  const chapters = book?.parts.flatMap((p) => p.chapters) ?? []
  const allScenes = chapters.flatMap((c) => c.scenes)
  const totalWords = allScenes.reduce((sum, s) => sum + s.wordCount, 0)
  const activeScene = allScenes.find((s) => s.id === activeSceneId)
  const isNewProject = chapters.length === 0

  const chapterStatuses = chapters.map((c) => ({ chapter: c, status: deriveChapterStatus(c.scenes) }))
  const draftedCount = chapterStatuses.filter((c) => c.status === 'drafted').length
  const bookProgressPct = chapters.length ? Math.round((draftedCount / chapters.length) * 100) : 0

  const canonCount = codexEntries.filter((e) => e.status === 'canon').length
  const codexCanonPct = codexEntries.length ? Math.round((canonCount / codexEntries.length) * 100) : 0

  const pendingSuggestions = activeSuggestions.filter((s) => s.state === 'pending')
  const pendingAgentRoles = [...new Set(pendingSuggestions.map((s) => s.agentRole))]

  const nextSteps: { title: string; sub: string; action: string; go: () => void; dot: string }[] = []
  if (pendingSuggestions.length > 0) {
    nextSteps.push({
      title: `${pendingSuggestions.length} suggestion${pendingSuggestions.length === 1 ? '' : 's'} awaiting review`,
      sub: [pendingAgentRoles.join(', '), activeScene?.title].filter(Boolean).join(' · '),
      action: 'Review',
      go: () => navigate('/manuscript'),
      dot: 'var(--c-accent)'
    })
  }
  nextSteps.push({
    title: `Codex is ${codexCanonPct}% canon`,
    sub: `${codexEntries.length} entries · ${canonCount} canon`,
    action: 'Continue',
    go: () => navigate('/codex'),
    dot: 'var(--c-green)'
  })
  if (nextSteps.length === 1 && !isNewProject) {
    nextSteps.unshift({
      title: 'Select text in the manuscript and send it to an agent',
      sub: 'Line Editor is wired up in this build — try it on Chapter Three',
      action: 'Open manuscript',
      go: () => navigate('/manuscript'),
      dot: 'var(--c-amber)'
    })
  }

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '36px 40px 80px' }}>
      <div style={{ fontFamily: 'Source Serif 4, serif', fontSize: 26, fontWeight: 600, marginBottom: 4 }}>
        {isNewProject ? (
          `Welcome to ${manifest?.title ?? 'your project'}`
        ) : (
          <>
            {timeOfDayGreeting()}
            {manifest?.writerDisplayName ? `, ${manifest.writerDisplayName}'s Writing Desk` : ''}
          </>
        )}
      </div>
      <div style={{ fontSize: 13.5, color: 'var(--c-ink-faint)', marginBottom: 28 }}>
        {isNewProject
          ? `Your starter Codex is ready · ${codexEntries.length} entries`
          : `${manifest?.title} · ${book?.title ?? 'Book One'} · ${totalWords.toLocaleString()} words drafted`}
      </div>

      {/* Momentum */}
      {isNewProject && (
        <div
          style={{
            borderRadius: 12,
            background: 'var(--c-accent-soft)',
            border: '1px solid var(--c-border)',
            padding: 24,
            marginBottom: 20,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            gap: 24
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--c-accent-text)',
                marginBottom: 8
              }}
            >
              Where to start
            </div>
            <div style={{ fontFamily: 'Source Serif 4, serif', fontSize: 21, fontWeight: 600, marginBottom: 4 }}>Review your Codex</div>
            <div style={{ fontSize: 12.5, color: 'var(--c-ink-soft)' }}>
              Story Foundations seeded {codexEntries.length} entries — the manuscript itself is still a blank page.
            </div>
          </div>
          <button
            onClick={() => navigate('/codex')}
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--c-accent)',
              color: 'var(--c-bg)',
              fontSize: 13.5,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            Review Codex →
          </button>
        </div>
      )}
      {!isNewProject && activeScene && (
        <div
          style={{
            borderRadius: 12,
            background: 'var(--c-accent-soft)',
            border: '1px solid var(--c-border)',
            padding: 24,
            marginBottom: 20,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            gap: 24
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--c-accent-text)',
                marginBottom: 8
              }}
            >
              Where you left off
            </div>
            <div style={{ fontFamily: 'Source Serif 4, serif', fontSize: 21, fontWeight: 600, marginBottom: 4 }}>
              {activeScene.title}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--c-ink-soft)' }}>
              Last edited {timeAgo(activeScene.updatedAt)}
              {activeScene.purpose ? ` · ${activeScene.purpose}` : ''}
            </div>
          </div>
          <button
            onClick={() => navigate('/manuscript')}
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--c-accent)',
              color: 'var(--c-bg)',
              fontSize: 13.5,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            Resume Writing →
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: isNewProject ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 20 }}>
        {/* Today's session — real data from window.atlas.sessions.summary() */}
        <div style={{ border: '1px solid var(--c-border)', borderRadius: 12, padding: '18px 20px', background: 'var(--c-surface-raised)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', marginBottom: 10 }}>
            Today's session
          </div>
          <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--c-ink)', marginBottom: 4 }}>
            {sessionSummary ? `${sessionSummary.today.wordsWritten.toLocaleString()} words today` : 'Loading…'}
          </div>
          {sessionSummary?.goal?.wordCount !== undefined && (
            <div style={{ fontSize: 12, color: sessionSummary.goalMet ? 'var(--c-green)' : 'var(--c-ink-faint)', marginBottom: 4 }}>
              {sessionSummary.goalMet ? 'Goal met' : `Goal: ${sessionSummary.goal.wordCount.toLocaleString()} words`}
            </div>
          )}
          <div style={{ fontSize: 12.5, color: 'var(--c-ink-faint)' }}>
            {sessionSummary && sessionSummary.streakDays > 0
              ? `${sessionSummary.streakDays} day${sessionSummary.streakDays === 1 ? '' : 's'} streak`
              : 'No streak yet'}
          </div>
          <button
            onClick={() => setStreakOpen((v) => !v)}
            style={{ marginTop: 12, background: 'none', border: 'none', padding: 0, fontSize: 12, color: 'var(--c-ink-faint)', cursor: 'pointer', textDecoration: 'underline' }}
          >
            {streakOpen ? 'Hide details' : 'Show details'}
          </button>
          {streakOpen && sessionSummary && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--c-ink-faint)', marginBottom: 6 }}>Last 30 days</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 3, maxWidth: 150 }}>
                {sessionSummary.heatmap.map((day) => (
                  <div
                    key={day.date}
                    title={`${day.date}: ${day.wordsWritten.toLocaleString()} words`}
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 2,
                      background: day.wordsWritten > 0 ? 'var(--c-green)' : 'var(--c-border)',
                      opacity: day.wordsWritten > 0 ? Math.min(1, 0.3 + day.wordsWritten / 1000) : 1
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Book progress */}
        {!isNewProject && (
        <div style={{ border: '1px solid var(--c-border)', borderRadius: 12, padding: '18px 20px', background: 'var(--c-surface-raised)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', marginBottom: 10 }}>
            {book?.title ?? 'Book One'} progress
          </div>
          <div style={{ fontSize: 24, fontWeight: 600, fontFamily: 'Source Serif 4, serif', marginBottom: 10 }}>{bookProgressPct}%</div>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--c-border)', overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ height: '100%', width: `${bookProgressPct}%`, background: 'var(--c-green)', borderRadius: 3 }} />
          </div>
          {chapterStatuses.map(({ chapter, status }) => {
            const badge = STATUS_BADGE[status]
            return (
              <div key={chapter.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '3px 0' }}>
                <span style={{ color: 'var(--c-ink-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                  {chapter.title}
                </span>
                <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 10, background: badge.bg, color: badge.color, flexShrink: 0, whiteSpace: 'nowrap' }}>
                  {CHAPTER_STATUS_LABEL[status]}
                </span>
              </div>
            )
          })}
        </div>
        )}
      </div>

      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', margin: '24px 0 10px' }}>
        Next steps
      </div>
      {nextSteps.map((step) => (
        <div
          key={step.title}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
            border: '1px solid var(--c-border)',
            borderRadius: 10,
            padding: '14px 18px',
            marginBottom: 10,
            background: 'var(--c-surface-raised)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: step.dot, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>{step.title}</div>
              <div style={{ fontSize: 12, color: 'var(--c-ink-faint)', marginTop: 2 }}>{step.sub}</div>
            </div>
          </div>
          <button
            onClick={step.go}
            style={{
              padding: '7px 14px',
              borderRadius: 7,
              border: '1px solid var(--c-border)',
              background: 'transparent',
              color: 'var(--c-ink)',
              fontSize: 12.5,
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            {step.action}
          </button>
        </div>
      ))}
    </div>
  )
}
