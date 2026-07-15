import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CodexEntry } from '@shared/schema/codex'
import { runAllContinuityChecks, type ContinuityCheckKind, type ContinuityFinding } from '@shared/continuityChecks'
import { CharacterPresenceMap } from '../components/CharacterPresenceMap'
import { ConflictCurveChart } from '../components/ConflictCurveChart'
import { PlotThreadBoard } from '../components/PlotThreadBoard'
import { useAtlasStore } from '../state/store'

type TimelineTab = 'timeline' | 'plot-threads' | 'character-map' | 'conflict-curve' | 'continuity-checks'

const TABS: Array<{ key: TimelineTab; label: string }> = [
  { key: 'timeline', label: 'Timeline' },
  { key: 'plot-threads', label: 'Plot Threads' },
  { key: 'character-map', label: 'Character Map' },
  { key: 'conflict-curve', label: 'Conflict Curve' },
  { key: 'continuity-checks', label: 'Continuity Checks' }
]

interface TimelineEvent {
  id: string
  date: string
  title: string
  body: string
  order: number
}

function toTimelineEvent(entry: CodexEntry): TimelineEvent {
  const body = entry.body as { date?: string; order?: number; summary?: string }
  return {
    id: entry.id,
    date: body.date ?? '',
    title: entry.name,
    body: body.summary ?? '',
    order: body.order ?? 0
  }
}

const TAB_META: Record<TimelineTab, { title: string; subtitle: string }> = {
  timeline: { title: 'Story Timeline', subtitle: 'Anchor events the manuscript resolves against' },
  'plot-threads': {
    title: 'Plot Thread Board',
    subtitle: 'Setups, clues, promises, and payoffs tracked across the manuscript'
  },
  'character-map': { title: 'Character Presence Map', subtitle: 'Which characters appear in which chapters' },
  'conflict-curve': { title: 'Conflict / Tension Curve', subtitle: 'Conflict level by reading order, scene by scene' },
  'continuity-checks': {
    title: 'Continuity Checks',
    subtitle: 'Automated age, timeline, injury, travel-time, and season checks (spec §11)'
  }
}

// Extended per spec §11/Phase 3-4 into a tabbed view: the original static
// Timeline mockup (still reading real Codex timeline-item entries) plus
// three functional, manuscript-linked story tools — see PlotThreadBoard,
// CharacterPresenceMap, and ConflictCurveChart.
export function Timeline(): JSX.Element {
  const [tab, setTab] = useState<TimelineTab>('timeline')
  const meta = TAB_META[tab]

  return (
    <div style={{ padding: '36px 40px 80px' }}>
      <div style={{ fontFamily: 'Source Serif 4, serif', fontSize: 24, fontWeight: 600, marginBottom: 4 }}>{meta.title}</div>
      <div style={{ fontSize: 13.5, color: 'var(--c-ink-faint)', marginBottom: 24 }}>{meta.subtitle}</div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 32, borderBottom: '1px solid var(--c-border)' }}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={tabButtonStyle(tab === t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'timeline' && <TimelineEventsView />}
      {tab === 'plot-threads' && <PlotThreadBoard />}
      {tab === 'character-map' && <CharacterPresenceMap />}
      {tab === 'conflict-curve' && <ConflictCurveChart />}
      {tab === 'continuity-checks' && <ContinuityChecksView />}
    </div>
  )
}

function tabButtonStyle(active: boolean): CSSProperties {
  return {
    padding: '9px 14px',
    border: 'none',
    borderBottom: `2px solid ${active ? 'var(--c-accent)' : 'transparent'}`,
    background: 'transparent',
    color: active ? 'var(--c-ink)' : 'var(--c-ink-faint)',
    fontSize: 13,
    fontWeight: active ? 600 : 500,
    cursor: 'pointer',
    marginBottom: -1
  }
}

// The original static timeline mockup over real Codex timeline-item
// entries — unchanged behavior, just relocated into its own tab.
function TimelineEventsView(): JSX.Element {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    void window.atlas.codex.list({ type: 'timeline-item' }).then((entries) => {
      setEvents(entries.map(toTimelineEvent).sort((a, b) => a.order - b.order))
    })
  }, [])

  return (
    <>
      {events.length === 0 ? (
        <div>
          <div style={{ color: 'var(--c-ink-soft)', fontSize: 14, marginBottom: 14, lineHeight: 1.6 }}>
            Timeline entries come from the Codex — add a "Timeline" entry to place your first anchor event.
          </div>
          <button
            onClick={() => navigate('/codex')}
            style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: 'var(--c-accent)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            Go to Codex
          </button>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', paddingBottom: 16 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${events.length}, minmax(240px, 1fr))`,
              gridTemplateRows: 'auto 32px auto',
              minWidth: events.length * 260,
              columnGap: 16
            }}
          >
            {events.map((ev, i) => (
              <div key={`${ev.id}-top`} style={{ gridColumn: i + 1, gridRow: 1, alignSelf: 'end', paddingBottom: 24 }}>
                {i % 2 === 0 && <EventCard event={ev} />}
              </div>
            ))}

            {events.map((ev, i) => (
              <div key={`${ev.id}-track`} style={{ gridColumn: i + 1, gridRow: 2, position: 'relative', display: 'flex', alignItems: 'center' }}>
                <div style={{ position: 'absolute', left: i === 0 ? '50%' : 0, right: i === events.length - 1 ? '50%' : 0, top: '50%', height: 4, background: 'var(--c-accent)', borderRadius: 2, transform: 'translateY(-50%)' }} />
                <div
                  style={{
                    margin: '0 auto',
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    background: 'var(--c-accent)',
                    border: '3px solid var(--c-bg)',
                    zIndex: 1
                  }}
                />
              </div>
            ))}

            {events.map((ev, i) => (
              <div key={`${ev.id}-bottom`} style={{ gridColumn: i + 1, gridRow: 3, alignSelf: 'start', paddingTop: 24 }}>
                {i % 2 !== 0 && <EventCard event={ev} />}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function EventCard({ event }: { event: TimelineEvent }): JSX.Element {
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--c-ink-faint)', marginBottom: 4 }}>{event.date}</div>
      <div style={{ fontFamily: 'Source Serif 4, serif', fontWeight: 600, fontSize: 15, marginBottom: 6 }}>{event.title}</div>
      <div style={{ fontSize: 12.5, color: 'var(--c-ink-soft)', lineHeight: 1.5 }}>{event.body}</div>
    </div>
  )
}

const CONTINUITY_KIND_LABEL: Record<ContinuityCheckKind, string> = {
  age: 'Age consistency',
  timeline: 'Timeline monotonicity',
  injury: 'Injury continuity',
  travel: 'Travel time',
  season: 'Season consistency'
}
const CONTINUITY_KIND_ORDER: ContinuityCheckKind[] = ['timeline', 'age', 'injury', 'travel', 'season']

// Spec §11 automated continuity validators — runs shared/continuityChecks.ts's
// 5 pure checks against the already-loaded Codex entries + manuscript tree
// (both already fetched elsewhere in the renderer; this view just needs its
// own copy of the full, unfiltered Codex list, since the other tabs above
// only ever fetch one type at a time). No new IPC.
function ContinuityChecksView(): JSX.Element {
  const manuscriptTree = useAtlasStore((s) => s.manuscriptTree)
  const setActiveScene = useAtlasStore((s) => s.setActiveScene)
  const navigate = useNavigate()
  const [entries, setEntries] = useState<CodexEntry[]>([])

  useEffect(() => {
    void window.atlas.codex.list().then(setEntries)
  }, [])

  const sceneTitleById = useMemo(() => {
    const map = new Map<string, string>()
    for (const book of manuscriptTree?.books ?? []) {
      for (const part of book.parts) {
        for (const chapter of part.chapters) {
          for (const scene of chapter.scenes) map.set(scene.id, scene.title)
        }
      }
    }
    return map
  }, [manuscriptTree])

  const codexNameById = useMemo(() => new Map(entries.map((e) => [e.id, e.name])), [entries])

  const findings = useMemo(
    () => (manuscriptTree ? runAllContinuityChecks(entries, manuscriptTree) : []),
    [entries, manuscriptTree]
  )

  const grouped = useMemo(() => {
    const map = new Map<ContinuityCheckKind, ContinuityFinding[]>()
    for (const finding of findings) {
      const list = map.get(finding.kind)
      if (list) list.push(finding)
      else map.set(finding.kind, [finding])
    }
    return map
  }, [findings])

  function jumpToScene(sceneId: string): void {
    setActiveScene(sceneId)
    navigate('/manuscript')
  }

  if (!manuscriptTree) {
    return <div style={{ color: 'var(--c-ink-soft)', fontSize: 14 }}>Loading manuscript…</div>
  }

  if (findings.length === 0) {
    return (
      <div style={{ color: 'var(--c-ink-soft)', fontSize: 14, lineHeight: 1.6 }}>
        No continuity issues detected. These checks run against character birth dates and injuries, location travel
        links, and scene story dates/seasons — add those fields (via a Codex character/location entry's Continuity
        section, or a scene's Continuity &amp; Threads panel) to get more coverage.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {CONTINUITY_KIND_ORDER.filter((kind) => grouped.has(kind)).map((kind) => (
        <div key={kind}>
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
            {CONTINUITY_KIND_LABEL[kind]} ({grouped.get(kind)!.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {grouped.get(kind)!.map((finding) => (
              <div key={finding.id} style={continuityFindingCardStyle(finding.severity)}>
                <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 8 }}>{finding.message}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {finding.relatedSceneIds.map((sceneId) => (
                    <button key={sceneId} onClick={() => jumpToScene(sceneId)} style={continuityChipButtonStyle}>
                      Jump to "{sceneTitleById.get(sceneId) ?? sceneId}" ↦
                    </button>
                  ))}
                  {finding.relatedCodexEntryIds.map((entryId) => (
                    <span key={entryId} style={continuityCodexChipStyle}>
                      {codexNameById.get(entryId) ?? entryId}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function continuityFindingCardStyle(severity: ContinuityFinding['severity']): CSSProperties {
  const accent = severity === 'high' ? 'var(--c-red)' : severity === 'medium' ? 'var(--c-amber)' : 'var(--c-border-strong)'
  return {
    padding: '12px 14px',
    borderRadius: 10,
    border: '1px solid var(--c-border)',
    borderLeft: `3px solid ${accent}`,
    background: 'var(--c-surface)'
  }
}

const continuityChipButtonStyle: CSSProperties = {
  fontSize: 11,
  padding: '3px 10px',
  borderRadius: 12,
  border: '1px solid var(--c-border-strong)',
  background: 'transparent',
  color: 'var(--c-ink-soft)',
  cursor: 'pointer'
}

const continuityCodexChipStyle: CSSProperties = {
  fontSize: 11,
  padding: '3px 10px',
  borderRadius: 12,
  border: '1px solid var(--c-border)',
  background: 'var(--c-surface-raised)',
  color: 'var(--c-ink-faint)'
}
