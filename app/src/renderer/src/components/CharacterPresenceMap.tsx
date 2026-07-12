import { useEffect, useMemo, useState } from 'react'
import type { CodexEntry } from '@shared/schema/codex'
import { getCharacterPresenceMap } from '@shared/codexLogic'
import { useAtlasStore } from '../state/store'

// Grid, not SVG — matches the brief's guidance and the existing CSS-grid
// style already used by Timeline.tsx. Rows are characters, columns are
// chapters; a cell is shaded if the character appears (via
// presentCharacterIds or as povCharacterId) in any scene of that chapter.
export function CharacterPresenceMap(): JSX.Element {
  const manuscriptTree = useAtlasStore((s) => s.manuscriptTree)
  const [characters, setCharacters] = useState<CodexEntry[]>([])

  useEffect(() => {
    void window.atlas.codex.list({ type: 'character' }).then(setCharacters)
  }, [])

  const chapters = useMemo(
    () => (manuscriptTree?.books ?? []).flatMap((book) => book.parts.flatMap((part) => part.chapters)),
    [manuscriptTree]
  )

  const rows = useMemo(
    () => (manuscriptTree ? getCharacterPresenceMap(manuscriptTree, characters) : []),
    [manuscriptTree, characters]
  )

  if (characters.length === 0) {
    return (
      <div style={{ color: 'var(--c-ink-soft)', fontSize: 14, lineHeight: 1.6 }}>
        No characters in the Codex yet — add character entries to build the presence map.
      </div>
    )
  }

  if (chapters.length === 0) {
    return (
      <div style={{ color: 'var(--c-ink-soft)', fontSize: 14, lineHeight: 1.6 }}>
        The manuscript has no chapters yet.
      </div>
    )
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `160px repeat(${chapters.length}, minmax(56px, 1fr))`,
          minWidth: 160 + chapters.length * 56,
          border: '1px solid var(--c-border)',
          borderRadius: 10,
          overflow: 'hidden'
        }}
      >
        <div style={headerCellStyle} />
        {chapters.map((chapter) => (
          <div key={chapter.id} style={{ ...headerCellStyle, writingMode: 'vertical-rl', textAlign: 'right' }} title={chapter.title}>
            {chapter.title}
          </div>
        ))}

        {rows.map((row) => (
          <RowCells key={row.characterId} name={row.characterName} chapters={chapters} presentByChapter={row.presentByChapter} />
        ))}
      </div>
    </div>
  )
}

function RowCells({
  name,
  chapters,
  presentByChapter
}: {
  name: string
  chapters: { id: string; title: string }[]
  presentByChapter: Map<string, boolean>
}): JSX.Element {
  return (
    <>
      <div style={rowLabelStyle}>{name}</div>
      {chapters.map((chapter) => {
        const present = presentByChapter.get(chapter.id) ?? false
        return (
          <div key={chapter.id} style={cellStyle} title={`${name} — ${chapter.title}${present ? ' (present)' : ''}`}>
            {present && <div style={presentDotStyle} />}
          </div>
        )
      })}
    </>
  )
}

const headerCellStyle = {
  padding: '8px 10px',
  fontSize: 10.5,
  fontWeight: 600,
  color: 'var(--c-ink-faint)',
  borderBottom: '1px solid var(--c-border)',
  background: 'var(--c-surface)',
  whiteSpace: 'nowrap' as const,
  overflow: 'hidden' as const,
  textOverflow: 'ellipsis' as const,
  maxHeight: 120
}

const rowLabelStyle = {
  padding: '8px 10px',
  fontSize: 12.5,
  color: 'var(--c-ink)',
  borderTop: '1px solid var(--c-border)',
  background: 'var(--c-surface-raised)',
  display: 'flex',
  alignItems: 'center'
}

const cellStyle = {
  borderTop: '1px solid var(--c-border)',
  borderLeft: '1px solid var(--c-border)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 30
}

const presentDotStyle = {
  width: 10,
  height: 10,
  borderRadius: '50%',
  background: 'var(--c-accent)'
}
