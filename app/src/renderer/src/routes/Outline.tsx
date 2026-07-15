import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CHAPTER_STATUS_LABEL, deriveChapterStatus } from '@shared/deriveChapterStatus'
import type { OutlineBeat, OutlineFramework, OutlineFrameworkKind } from '@shared/schema/outline'
import { createFrameworkFromTemplate, getBeatStatus } from '@shared/outlineLogic'
import { useAtlasStore } from '../state/store'

const STATUS_BADGE: Record<string, { bg: string; color: string }> = {
  drafted: { bg: 'var(--c-green-soft)', color: 'var(--c-green)' },
  'in-progress': { bg: 'var(--c-amber-soft)', color: 'var(--c-amber)' },
  'not-started': { bg: 'var(--c-border)', color: 'var(--c-ink-faint)' }
}

// Spec §11: named story-structure templates the writer can pick from, or a
// blank 'custom' framework built beat-by-beat. See shared/outlineLogic.ts's
// TEMPLATE_BEATS for the real seed beats each named template produces.
const FRAMEWORK_KINDS: OutlineFrameworkKind[] = [
  'three-act',
  'save-the-cat',
  'heros-journey',
  'mystery-clue-grid',
  'thriller-escalation',
  'custom'
]

const FRAMEWORK_LABEL: Record<OutlineFrameworkKind, string> = {
  'three-act': 'Three-Act Structure',
  'save-the-cat': 'Save the Cat',
  'heros-journey': "Hero's Journey",
  'mystery-clue-grid': 'Mystery Clue Grid',
  'thriller-escalation': 'Thriller Escalation Map',
  custom: 'Custom'
}

const BEAT_BADGE: Record<'mapped' | 'unmapped' | 'order-violation', { label: string; bg: string; color: string }> = {
  mapped: { label: 'Mapped', bg: 'var(--c-green-soft)', color: 'var(--c-green)' },
  unmapped: { label: 'Unmapped', bg: 'var(--c-border)', color: 'var(--c-ink-faint)' },
  'order-violation': { label: 'Order issue', bg: 'var(--c-amber-soft)', color: 'var(--c-amber)' }
}

export function Outline(): JSX.Element {
  const tree = useAtlasStore((s) => s.manuscriptTree)
  const setActiveScene = useAtlasStore((s) => s.setActiveScene)
  const navigate = useNavigate()

  const book = tree?.books[0]
  const part = book?.parts[0]
  const chapters = part?.chapters ?? []

  const [framework, setFrameworkState] = useState<OutlineFramework | null>(null)
  const [loadingFramework, setLoadingFramework] = useState(true)

  useEffect(() => {
    let cancelled = false
    void window.atlas.outline.getFramework().then((loaded) => {
      if (cancelled) return
      setFrameworkState(loaded)
      setLoadingFramework(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const persistFramework = async (next: OutlineFramework): Promise<void> => {
    setFrameworkState(next)
    await window.atlas.outline.setFramework(next)
  }

  const pickTemplate = async (kind: OutlineFrameworkKind): Promise<void> => {
    if (framework && !window.confirm(`Replace the current outline ("${framework.name}") with a new ${FRAMEWORK_LABEL[kind]} outline?`)) {
      return
    }
    const next =
      kind === 'custom'
        ? { schemaVersion: 1 as const, id: crypto.randomUUID(), kind, name: 'Custom Outline', beats: [] }
        : createFrameworkFromTemplate(kind, FRAMEWORK_LABEL[kind])
    await persistFramework(next)
  }

  const updateBeat = async (beatId: string, patch: Partial<OutlineBeat>): Promise<void> => {
    if (!framework) return
    const next: OutlineFramework = {
      ...framework,
      beats: framework.beats.map((beat) => (beat.id === beatId ? { ...beat, ...patch } : beat))
    }
    await persistFramework(next)
  }

  // Flattened book/part/chapter rows for the beat-mapping dropdowns — every
  // chapter across every book/part, not just the first part like the
  // existing flat scene list below (a beat can map to any chapter).
  const chapterRows = useMemo(() => {
    if (!tree) return []
    return tree.books.flatMap((b) =>
      b.parts.flatMap((p) =>
        p.chapters.map((chapter) => ({
          id: chapter.id,
          label: `${b.title} · ${p.title} · ${chapter.title}`,
          scenes: chapter.scenes
        }))
      )
    )
  }, [tree])

  const beatStatuses = useMemo(() => {
    if (!framework || !tree) return new Map<string, { mapped: boolean; orderViolation: boolean }>()
    return new Map(getBeatStatus(framework, tree).map((s) => [s.beatId, s]))
  }, [framework, tree])

  const sortedBeats = useMemo(() => {
    if (!framework) return []
    return [...framework.beats].sort((a, b) => a.order - b.order)
  }, [framework])

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '36px 40px 80px' }}>
      <div style={{ fontFamily: 'Source Serif 4, serif', fontSize: 24, fontWeight: 600, marginBottom: 4 }}>Outline</div>
      {book && part && (
        <div style={{ fontSize: 13.5, color: 'var(--c-ink-faint)', marginBottom: 24 }}>
          {book.title} · {part.title}
        </div>
      )}

      {chapters.map((chapter) => {
        const status = deriveChapterStatus(chapter.scenes)
        const badge = STATUS_BADGE[status]
        return (
          <div
            key={chapter.id}
            style={{
              border: '1px solid var(--c-border)',
              borderRadius: 12,
              background: 'var(--c-surface-raised)',
              marginBottom: 16,
              overflow: 'hidden'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px' }}>
              <div style={{ fontFamily: 'Source Serif 4, serif', fontSize: 16, fontWeight: 600 }}>{chapter.title}</div>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  padding: '2px 7px',
                  borderRadius: 10,
                  background: badge.bg,
                  color: badge.color,
                  whiteSpace: 'nowrap'
                }}
              >
                {CHAPTER_STATUS_LABEL[status]}
              </span>
            </div>

            {chapter.scenes.length === 0 ? (
              <div style={{ padding: '0 18px 16px', fontSize: 13, color: 'var(--c-ink-faint)' }}>No scenes outlined yet.</div>
            ) : (
              chapter.scenes.map((scene, index) => (
                <button
                  key={scene.id}
                  onClick={() => {
                    setActiveScene(scene.id)
                    navigate('/manuscript')
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '12px 18px',
                    border: 'none',
                    borderTop: index === 0 ? '1px solid var(--c-border)' : 'none',
                    borderBottom: index < chapter.scenes.length - 1 ? '1px solid var(--c-border)' : 'none',
                    background: 'transparent',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--c-ink)' }}>{scene.title}</div>
                  {scene.purpose && <div style={{ fontSize: 12, color: 'var(--c-ink-faint)', marginTop: 2 }}>{scene.purpose}</div>}
                </button>
              ))
            )}
          </div>
        )
      })}

      <div style={{ marginTop: 40, paddingTop: 24, borderTop: '1px solid var(--c-border)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontFamily: 'Source Serif 4, serif', fontSize: 18, fontWeight: 600 }}>Outline Framework</div>
        </div>
        <div style={{ fontSize: 13, color: 'var(--c-ink-faint)', marginBottom: 16 }}>
          {framework
            ? `${framework.name} · ${FRAMEWORK_LABEL[framework.kind]}`
            : 'Pick a story-structure template to map beats onto your manuscript, or start a custom outline.'}
        </div>

        {!loadingFramework && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
            {FRAMEWORK_KINDS.map((kind) => (
              <button
                key={kind}
                onClick={() => void pickTemplate(kind)}
                style={{
                  padding: '7px 12px',
                  borderRadius: 8,
                  border: `1px solid ${framework?.kind === kind ? 'var(--c-accent)' : 'var(--c-border)'}`,
                  background: framework?.kind === kind ? 'var(--c-accent-soft)' : 'var(--c-surface-raised)',
                  color: framework?.kind === kind ? 'var(--c-accent)' : 'var(--c-ink)',
                  fontSize: 12.5,
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                {FRAMEWORK_LABEL[kind]}
              </button>
            ))}
          </div>
        )}

        {framework && sortedBeats.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--c-ink-faint)' }}>
            This custom outline has no beats yet. (Beat authoring UI for custom frameworks is not yet built — beats currently
            only come from the named templates above.)
          </div>
        )}

        {framework &&
          sortedBeats.map((beat) => {
            const status = beatStatuses.get(beat.id)
            const badgeKey = status?.orderViolation ? 'order-violation' : status?.mapped ? 'mapped' : 'unmapped'
            const badge = BEAT_BADGE[badgeKey]
            const targetChapter = beat.targetChapterId ? chapterRows.find((c) => c.id === beat.targetChapterId) : undefined

            return (
              <div
                key={beat.id}
                style={{
                  border: '1px solid var(--c-border)',
                  borderRadius: 12,
                  background: 'var(--c-surface-raised)',
                  marginBottom: 12,
                  padding: '14px 18px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {beat.label}
                    {beat.role && <span style={{ color: 'var(--c-ink-faint)', fontWeight: 400 }}> · {beat.role}</span>}
                  </div>
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 600,
                      padding: '2px 7px',
                      borderRadius: 10,
                      background: badge.bg,
                      color: badge.color,
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {badge.label}
                  </span>
                </div>
                {beat.description && (
                  <div style={{ fontSize: 12.5, color: 'var(--c-ink-faint)', marginBottom: 10 }}>{beat.description}</div>
                )}

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <select
                    value={beat.targetChapterId ?? ''}
                    onChange={(e) =>
                      void updateBeat(beat.id, {
                        targetChapterId: e.target.value || undefined,
                        targetSceneId: undefined
                      })
                    }
                    style={{ fontSize: 12.5, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--c-border)' }}
                  >
                    <option value="">No chapter assigned</option>
                    {chapterRows.map((chapter) => (
                      <option key={chapter.id} value={chapter.id}>
                        {chapter.label}
                      </option>
                    ))}
                  </select>

                  {targetChapter && (
                    <select
                      value={beat.targetSceneId ?? ''}
                      onChange={(e) => void updateBeat(beat.id, { targetSceneId: e.target.value || undefined })}
                      style={{ fontSize: 12.5, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--c-border)' }}
                    >
                      <option value="">No specific scene</option>
                      {targetChapter.scenes.map((scene) => (
                        <option key={scene.id} value={scene.id}>
                          {scene.title}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            )
          })}
      </div>
    </div>
  )
}
