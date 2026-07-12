export function ComingSoon({ title, description }: { title: string; description: string }): JSX.Element {
  return (
    <div style={{ maxWidth: 600, margin: '80px auto', padding: '0 40px', textAlign: 'center' }}>
      <div style={{ fontFamily: 'Source Serif 4, serif', fontSize: 22, fontWeight: 600, marginBottom: 10 }}>{title}</div>
      <div style={{ fontSize: 14, color: 'var(--c-ink-soft)', lineHeight: 1.6 }}>{description}</div>
    </div>
  )
}
