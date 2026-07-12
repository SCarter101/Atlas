export type IconKind = 'nib' | 'compass' | 'loupe' | 'quote' | 'globe'

// Ported 1:1 from the Phase 1 prototype's AssistantIcon.dc.html — restrained
// geometric marks per spec §2 ("stable role icon ... without mascots").
export function AssistantIcon({ kind, color, size = 20 }: { kind: IconKind; color: string; size?: number }): JSX.Element {
  return (
    <div style={{ width: size, height: size, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {kind === 'nib' && (
        <div style={{ width: '62%', height: '62%', background: color, transform: 'rotate(45deg)', borderRadius: 2 }} />
      )}
      {kind === 'compass' && (
        <div style={{ width: '90%', height: '90%', borderRadius: '50%', border: `1.6px solid ${color}`, position: 'relative' }}>
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              width: 1.6,
              height: '64%',
              background: color,
              transform: 'translate(-50%,-50%) rotate(35deg)'
            }}
          />
        </div>
      )}
      {kind === 'loupe' && (
        <>
          <div style={{ width: '66%', height: '66%', borderRadius: '50%', border: `1.6px solid ${color}`, position: 'absolute', top: '6%', left: '6%' }} />
          <div
            style={{
              width: '34%',
              height: 1.8,
              background: color,
              position: 'absolute',
              bottom: '12%',
              right: '6%',
              transform: 'rotate(45deg)',
              borderRadius: 2
            }}
          />
        </>
      )}
      {kind === 'quote' && (
        <div style={{ fontFamily: 'Source Serif 4, Georgia, serif', fontWeight: 700, color, lineHeight: 1 }}>&#8221;</div>
      )}
      {kind === 'globe' && (
        <div style={{ width: '90%', height: '90%', borderRadius: '50%', border: `1.6px solid ${color}`, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: '50%', left: 0, width: '100%', height: 1.6, background: color, transform: 'translateY(-50%)' }} />
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: '50%',
              width: '46%',
              height: '100%',
              borderLeft: `1.6px solid ${color}`,
              borderRight: `1.6px solid ${color}`,
              borderRadius: '50%',
              transform: 'translateX(-50%)'
            }}
          />
        </div>
      )}
    </div>
  )
}
