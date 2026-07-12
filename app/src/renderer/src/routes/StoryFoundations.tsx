import { useState } from 'react'
import type { CodexEntryType, FactStatus } from '@shared/schema/codex'
import type { FoundationsCodexDraft } from '@shared/ipc'
import { useAtlasStore } from '../state/store'

interface Question {
  entryType: CodexEntryType
  entryLabel: string
  entryName: string
  status: FactStatus
  q: string
}

// Ported from the Phase 1 prototype's StoryFoundations.dc.html — same six
// questions, same fast/thorough framing. Answers map onto the spec §6
// minimum starter Codex (protagonist character bible, world interview,
// synopsis); the two questions without a dedicated Codex entry type
// (synopsis, style note) land as 'scene-note', the closest general-purpose
// slot the schema has.
const QUESTIONS: Question[] = [
  {
    entryType: 'character',
    entryLabel: 'Character',
    entryName: 'Protagonist',
    status: 'canon',
    q: "What's your protagonist's name, and what do they want more than anything?"
  },
  {
    entryType: 'location',
    entryLabel: 'World',
    entryName: 'Story World',
    status: 'canon',
    q: 'Where and when does your story take place?'
  },
  {
    entryType: 'scene-note',
    entryLabel: 'Synopsis',
    entryName: 'Synopsis',
    status: 'canon',
    q: "In a sentence or two, what's the story about?"
  },
  {
    entryType: 'character',
    entryLabel: 'Character',
    entryName: 'Opposition',
    status: 'canon',
    q: "Who or what stands in your protagonist's way?"
  },
  {
    entryType: 'world-rule',
    entryLabel: 'World Rule',
    entryName: 'World Rule',
    status: 'tentative',
    q: "Is there a rule about your story's world the reader needs to know early?"
  },
  {
    entryType: 'scene-note',
    entryLabel: 'Style Note',
    entryName: 'Style Note',
    status: 'tentative',
    q: 'What tone, or what comparable books, should Atlas aim for?'
  }
]

type Step = 'title' | 'path' | 'question' | 'done'

export function StoryFoundations(): JSX.Element {
  const exitToLanding = useAtlasStore((s) => s.exitToLanding)
  const createProjectFromFoundations = useAtlasStore((s) => s.createProjectFromFoundations)

  const [step, setStep] = useState<Step>('title')
  const [title, setTitle] = useState('')
  const [path, setPath] = useState<'fast' | 'thorough' | null>(null)
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [draft, setDraft] = useState('')
  const [creating, setCreating] = useState(false)

  const total = QUESTIONS.length
  const current = QUESTIONS[index] ?? QUESTIONS[0]
  const builtEntries = Object.keys(answers)
    .map((k) => Number(k))
    .sort((a, b) => a - b)
    .map((i) => ({ label: QUESTIONS[i].entryLabel, text: answers[i] }))

  function commitAndAdvance(skip: boolean): void {
    const next = { ...answers }
    if (!skip && draft.trim()) next[index] = draft.trim()
    else if (skip) delete next[index]

    const nextIndex = index + 1
    setAnswers(next)
    if (nextIndex >= total) {
      setStep('done')
    } else {
      setIndex(nextIndex)
      setDraft(next[nextIndex] ?? '')
    }
  }

  function goBack(): void {
    const prevIndex = Math.max(0, index - 1)
    setIndex(prevIndex)
    setDraft(answers[prevIndex] ?? '')
  }

  async function finish(): Promise<void> {
    setCreating(true)
    const entries: FoundationsCodexDraft[] = Object.keys(answers)
      .map((k) => Number(k))
      .map((i) => ({
        type: QUESTIONS[i].entryType,
        name: QUESTIONS[i].entryName,
        summary: answers[i],
        status: QUESTIONS[i].status
      }))
    await createProjectFromFoundations(title.trim() || 'Untitled Project', undefined, entries)
  }

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '48px 40px 80px', height: '100%', overflowY: 'auto' }}>
      {step === 'title' && (
        <div style={{ textAlign: 'center', maxWidth: 480, margin: '60px auto 0' }}>
          <div style={{ fontFamily: 'Source Serif 4, serif', fontSize: 26, fontWeight: 600, marginBottom: 10 }}>
            What's this novel called?
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--c-ink-soft)', marginBottom: 24 }}>
            A working title is fine — you can change it later.
          </div>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Working title…"
            style={{
              width: '100%',
              padding: '12px 16px',
              borderRadius: 10,
              border: '1px solid var(--c-border)',
              background: 'var(--c-surface-raised)',
              color: 'var(--c-ink)',
              fontSize: 15,
              marginBottom: 16,
              textAlign: 'center'
            }}
          />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button onClick={() => title.trim() && setStep('path')} disabled={!title.trim()} style={primaryBtn(!!title.trim())}>
              Continue
            </button>
            <button onClick={exitToLanding} style={secondaryBtn}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === 'path' && (
        <div style={{ textAlign: 'center', maxWidth: 560, margin: '40px auto 0' }}>
          <div style={{ fontFamily: 'Source Serif 4, serif', fontSize: 28, fontWeight: 600, marginBottom: 10 }}>
            Let's build your Story Foundations
          </div>
          <div style={{ fontSize: 14.5, color: 'var(--c-ink-soft)', lineHeight: 1.6, marginBottom: 32 }}>
            A few quick questions build your starter Codex — the protagonist, the world, and the shape of the story.
            Answer briefly now; you can always deepen entries later.
          </div>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => {
                setPath('fast')
                setStep('question')
              }}
              style={pathCard}
            >
              <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 6 }}>Fast path</div>
              <div style={{ fontSize: 12.5, color: 'var(--c-ink-faint)', lineHeight: 1.5 }}>
                ~10 minutes. Core essentials only — you can deepen the Codex as you write.
              </div>
            </button>
            <button
              onClick={() => {
                setPath('thorough')
                setStep('question')
              }}
              style={pathCard}
            >
              <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 6 }}>Thorough path</div>
              <div style={{ fontSize: 12.5, color: 'var(--c-ink-faint)', lineHeight: 1.5 }}>
                45+ minutes. Covers voice, themes, and secondary characters in more depth.
              </div>
            </button>
          </div>
        </div>
      )}

      {step === 'question' && (
        <>
          <div style={{ marginBottom: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 11.5, color: 'var(--c-ink-faint)' }}>
                Question {index + 1} of {total} · {path === 'thorough' ? 'Thorough path' : 'Fast path'}
              </div>
              <button onClick={exitToLanding} style={linkStyle}>
                Save and exit
              </button>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--c-border)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.round((index / total) * 100)}%`, background: 'var(--c-accent)', borderRadius: 3 }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 28, alignItems: 'start' }}>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-accent-text)', marginBottom: 8 }}>
                {current.entryLabel}
              </div>
              <div style={{ fontFamily: 'Source Serif 4, serif', fontSize: 21, fontWeight: 600, marginBottom: 16, lineHeight: 1.4 }}>{current.q}</div>
              <textarea
                key={index}
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Answer briefly — a sentence or two is plenty…"
                style={{
                  width: '100%',
                  minHeight: 120,
                  border: '1px solid var(--c-border)',
                  borderRadius: 10,
                  padding: '14px 16px',
                  fontSize: 14.5,
                  resize: 'vertical',
                  background: 'var(--c-surface-raised)',
                  color: 'var(--c-ink)',
                  marginBottom: 16
                }}
              />
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => commitAndAdvance(false)} style={primaryBtn(true)}>
                  {index + 1 >= total ? 'Finish' : 'Next'}
                </button>
                <button onClick={() => commitAndAdvance(true)} style={secondaryBtn}>
                  Skip for now
                </button>
                {index > 0 && (
                  <button onClick={goBack} style={{ ...linkStyle, padding: '10px 16px' }}>
                    Back
                  </button>
                )}
              </div>
            </div>

            <div style={{ border: '1px solid var(--c-border)', borderRadius: 12, padding: 16, background: 'var(--c-surface-raised)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', marginBottom: 10 }}>
                Codex forming
              </div>
              {builtEntries.length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--c-ink-faint)', lineHeight: 1.5 }}>Entries will appear here as you answer.</div>
              ) : (
                builtEntries.map((e, i) => (
                  <div key={i} style={{ borderBottom: '1px solid var(--c-border)', padding: '8px 0' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--c-accent-text)', marginBottom: 2 }}>
                      {e.label}
                    </div>
                    <div style={{ fontSize: 12.5, lineHeight: 1.4 }}>{e.text}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {step === 'done' && (
        <div style={{ textAlign: 'center', maxWidth: 520, margin: '40px auto 0' }}>
          <div style={{ fontFamily: 'Source Serif 4, serif', fontSize: 26, fontWeight: 600, marginBottom: 10 }}>Your Codex is ready</div>
          <div style={{ fontSize: 14, color: 'var(--c-ink-soft)', lineHeight: 1.6, marginBottom: 24 }}>
            {builtEntries.length} starter {builtEntries.length === 1 ? 'entry is' : 'entries are'} in place. Deepen{' '}
            {builtEntries.length === 1 ? 'it' : 'them'} anytime from the Codex panel — or just start writing.
          </div>
          <button onClick={() => void finish()} disabled={creating} style={primaryBtn(!creating)}>
            {creating ? 'Creating…' : 'Go to Dashboard →'}
          </button>
        </div>
      )}
    </div>
  )
}

function primaryBtn(enabled: boolean) {
  return {
    padding: '10px 20px',
    borderRadius: 8,
    border: 'none',
    background: enabled ? 'var(--c-accent)' : 'var(--c-border)',
    color: enabled ? '#fff' : 'var(--c-ink-faint)',
    fontSize: 13.5,
    fontWeight: 600,
    cursor: enabled ? 'pointer' : 'default'
  } as const
}

const secondaryBtn = {
  padding: '10px 16px',
  borderRadius: 8,
  border: '1px solid var(--c-border)',
  background: 'transparent',
  color: 'var(--c-ink-soft)',
  fontSize: 13.5,
  cursor: 'pointer'
} as const

const linkStyle = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 12,
  color: 'var(--c-ink-faint)',
  textDecoration: 'underline'
} as const

const pathCard = {
  width: 220,
  textAlign: 'left',
  padding: 20,
  borderRadius: 12,
  border: '1px solid var(--c-border)',
  background: 'var(--c-surface-raised)',
  cursor: 'pointer'
} as const
