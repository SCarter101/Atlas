import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CodexEntry } from '@shared/schema/codex'

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

// Static timeline mockup over real Codex timeline-item entries — spec §11
// scopes the functional, manuscript-linked version of this to Phases 3/4;
// Phase 1/2 only need the static visualization.
export function Timeline(): JSX.Element {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    void window.atlas.codex.list({ type: 'timeline-item' }).then((entries) => {
      setEvents(entries.map(toTimelineEvent).sort((a, b) => a.order - b.order))
    })
  }, [])

  return (
    <div style={{ padding: '36px 40px 80px' }}>
      <div style={{ fontFamily: 'Source Serif 4, serif', fontSize: 24, fontWeight: 600, marginBottom: 4 }}>Story Timeline</div>
      <div style={{ fontSize: 13.5, color: 'var(--c-ink-faint)', marginBottom: 48 }}>Anchor events the manuscript resolves against</div>

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
    </div>
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
