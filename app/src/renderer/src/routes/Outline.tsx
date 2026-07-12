import { useNavigate } from 'react-router-dom'
import { CHAPTER_STATUS_LABEL, deriveChapterStatus } from '@shared/deriveChapterStatus'
import { useAtlasStore } from '../state/store'

const STATUS_BADGE: Record<string, { bg: string; color: string }> = {
  drafted: { bg: 'var(--c-green-soft)', color: 'var(--c-green)' },
  'in-progress': { bg: 'var(--c-amber-soft)', color: 'var(--c-amber)' },
  'not-started': { bg: 'var(--c-border)', color: 'var(--c-ink-faint)' }
}

export function Outline(): JSX.Element {
  const tree = useAtlasStore((s) => s.manuscriptTree)
  const setActiveScene = useAtlasStore((s) => s.setActiveScene)
  const navigate = useNavigate()

  const book = tree?.books[0]
  const part = book?.parts[0]
  const chapters = part?.chapters ?? []

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
    </div>
  )
}
