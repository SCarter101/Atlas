import { useState } from 'react'
import type { AgentRole, InsertionPayload, SuggestionRef } from '@shared/schema/agent'
import type { SnapshotDiffRun } from '@shared/schema/revision'
import { diffWords } from '@shared/diffText'
import { AssistantIcon, type IconKind } from './AssistantIcon'
import { useAtlasStore } from '../state/store'

const STATE_BADGE: Record<SuggestionRef['state'], { bg: string; color: string; label: string }> = {
  pending: { bg: 'var(--c-amber-soft)', color: 'var(--c-amber)', label: 'Open' },
  accepted: { bg: 'var(--c-green-soft)', color: 'var(--c-green)', label: 'Accepted' },
  rejected: { bg: 'var(--c-red-soft)', color: 'var(--c-red)', label: 'Rejected' },
  refining: { bg: 'var(--c-accent-soft)', color: 'var(--c-accent-text)', label: 'In progress' },
  fixed: { bg: 'var(--c-accent-soft)', color: 'var(--c-accent)', label: 'Fixed' }
}

const ROLE_ICON: Record<AgentRole, IconKind> = {
  Generator: 'nib',
  'Dev-Editor': 'compass',
  'Line-Editor': 'loupe',
  Dialoguer: 'quote',
  'World-Builder': 'globe'
}

function diffRunStyle(type: SnapshotDiffRun['type']) {
  if (type === 'add') {
    return { background: 'var(--c-green-soft)', color: 'var(--c-green)', textDecoration: 'underline' }
  }
  if (type === 'remove') {
    return { background: 'var(--c-red-soft)', color: 'var(--c-red)', textDecoration: 'line-through' }
  }
  return {}
}

// Renders a group of Generator `insertion` suggestions that share a
// draftGroupId — i.e. the output of the opt-in "Generate Alternatives" mode
// (Required UI Features: "Compare generated versions side-by-side," "Enable
// multiple drafts only as an optional advanced feature"). Reuses the same
// word-level diff algorithm as SnapshotDiffView.tsx (shared/diffText.ts)
// rather than a second implementation — the only difference is the two
// texts being compared come from suggestion payloads already in memory
// instead of scene snapshots read over IPC.
export function DraftComparisonView({
  suggestions,
  focusedSuggestionId
}: {
  suggestions: SuggestionRef[]
  // The J/K keyboard-review cursor (ManuscriptWorkspace). Grouped drafts are
  // part of the same review traversal as ungrouped cards, so each per-draft
  // row carries the `suggestion-<id>` anchor scrollIntoView targets and shows
  // a focus ring when it's the active row — otherwise focusing a grouped
  // draft with J/K would be invisible.
  focusedSuggestionId?: string | null
}): JSX.Element | null {
  const setSuggestionState = useAtlasStore((s) => s.setSuggestionState)

  const drafts = suggestions.map((s, i) => {
    const payload = s.payload as InsertionPayload
    return { suggestion: s, label: payload.draftLabel ?? `Draft ${i + 1}`, text: payload.text }
  })

  const [indexA, setIndexA] = useState(0)
  const [indexB, setIndexB] = useState(Math.min(1, drafts.length - 1))

  if (drafts.length === 0) return null

  const textA = drafts[indexA]?.text ?? ''
  const textB = drafts[indexB]?.text ?? ''
  const diff = indexA !== indexB ? diffWords(textA, textB) : null

  return (
    <div style={{ border: '1px solid var(--c-border)', borderRadius: 10, padding: 12, marginBottom: 10, background: 'var(--c-surface-raised)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: 'var(--c-accent-soft)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}
        >
          <AssistantIcon kind={ROLE_ICON[drafts[0].suggestion.agentRole]} color="var(--c-accent)" size={12} />
        </div>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--c-ink-soft)' }}>
          Generator · {drafts.length} draft alternatives
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={indexA} onChange={(e) => setIndexA(Number(e.target.value))} style={selectStyle}>
          {drafts.map((d, i) => (
            <option key={d.suggestion.id} value={i}>
              {d.label}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 11.5, color: 'var(--c-ink-faint)' }}>vs</span>
        <select value={indexB} onChange={(e) => setIndexB(Number(e.target.value))} style={selectStyle}>
          {drafts.map((d, i) => (
            <option key={d.suggestion.id} value={i}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      {diff ? (
        <div style={{ fontSize: 12.5, lineHeight: 1.7, whiteSpace: 'pre-wrap', marginBottom: 12 }}>
          {diff.map((run, i) => (
            <span key={i} style={diffRunStyle(run.type)}>
              {run.text}{' '}
            </span>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--c-ink-soft)', lineHeight: 1.6, marginBottom: 12 }}>{textA}</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {drafts.map((d) => {
          const isResolved = d.suggestion.state === 'accepted' || d.suggestion.state === 'rejected'
          const badge = STATE_BADGE[d.suggestion.state]
          const isFocused = d.suggestion.id === focusedSuggestionId
          return (
            <div
              key={d.suggestion.id}
              id={`suggestion-${d.suggestion.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '6px 8px',
                borderRadius: 7,
                background: 'var(--c-surface)',
                border: '1px solid var(--c-border)',
                outline: isFocused ? '2px solid var(--c-accent)' : undefined,
                outlineOffset: isFocused ? 2 : undefined
              }}
            >
              <span style={{ fontSize: 11.5, color: 'var(--c-ink-soft)' }}>{d.label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: badge.bg, color: badge.color }}>
                  {badge.label}
                </span>
                {!isResolved && (
                  <>
                    <button onClick={() => setSuggestionState(d.suggestion.id, 'accepted')} style={pillStyle('var(--c-green-soft)', 'var(--c-green)')}>
                      Accept
                    </button>
                    <button onClick={() => setSuggestionState(d.suggestion.id, 'rejected')} style={pillStyle('var(--c-red-soft)', 'var(--c-red)')}>
                      Reject
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const selectStyle = {
  fontSize: 12,
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--c-border)',
  background: 'var(--c-bg)',
  color: 'var(--c-ink)'
} as const

function pillStyle(bg: string, color: string) {
  return {
    padding: '4px 10px',
    borderRadius: 6,
    border: 'none',
    background: bg,
    color,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer'
  } as const
}
