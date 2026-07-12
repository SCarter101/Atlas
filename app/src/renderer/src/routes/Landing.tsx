import { useNavigate } from 'react-router-dom'
import { useAtlasStore } from '../state/store'

export function Landing(): JSX.Element {
  const openSampleProject = useAtlasStore((s) => s.openSampleProject)
  const startNewProject = useAtlasStore((s) => s.startNewProject)
  const navigate = useNavigate()

  return (
    <div
      data-theme="night"
      style={{
        height: '100vh',
        overflowY: 'auto',
        position: 'relative',
        background: 'var(--c-bg)'
      }}
    >
      <img
        src="/assets/atlas-icon.png"
        alt="Atlas app icon — a bronze Atlas figure holding a globe over a page, with a fountain pen"
        style={{
          position: 'absolute',
          top: 24,
          left: 24,
          width: 150,
          height: 141,
          borderRadius: 16,
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          zIndex: 2
        }}
      />

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '64px 24px' }}>
        <div style={{ fontFamily: 'Source Serif 4, serif', fontSize: 42, fontWeight: 600, marginBottom: 6, color: 'var(--c-ink)' }}>
          Atlas
        </div>
        <div style={{ fontSize: 18, color: 'var(--c-ink-faint)', marginBottom: 36 }}>
          A writing companion for the long haul of a novel
        </div>

        <div
          style={{
            width: '100%',
            maxWidth: 760,
            position: 'relative',
            borderRadius: 20,
            overflow: 'hidden',
            backgroundImage: "url('/assets/writers-desk.png')",
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            padding: '40px 32px',
            minHeight: 340,
            boxShadow: '0 20px 48px rgba(0,0,0,0.22)'
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              color: '#F1ECE4',
              textShadow: '0 1px 3px rgba(0,0,0,0.6)',
              marginBottom: 16,
              textAlign: 'center'
            }}
          >
            Your projects
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
            <button
              onClick={() => {
                // Spec §2 Phase 1 acceptance criteria: the sample project's
                // default opening state must be the Manuscript view with its
                // open Story Editor report and tracked changes visible, not
                // the Dashboard — the "/" route's default redirect goes to
                // /dashboard, so this explicit navigate is needed here.
                void openSampleProject().then(() => navigate('/manuscript'))
              }}
              style={{
                textAlign: 'left',
                padding: 22,
                borderRadius: 14,
                border: '1px solid rgba(255,255,255,0.14)',
                background: 'rgba(28,24,20,0.72)',
                backdropFilter: 'blur(2px)',
                cursor: 'pointer',
                fontFamily: 'Public Sans, sans-serif'
              }}
            >
              <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--c-accent-soft)', marginBottom: 14 }} />
              <div style={{ fontFamily: 'Source Serif 4, serif', fontSize: 17, fontWeight: 600, color: '#F5F1EA', marginBottom: 4 }}>
                Cottonmouth
              </div>
              <div style={{ fontSize: 12, color: 'rgba(245,241,234,0.68)' }}>Southern crime noir · 41,208 words</div>
            </button>

            <button
              onClick={startNewProject}
              style={{
                textAlign: 'left',
                padding: 22,
                borderRadius: 14,
                border: '1px dashed rgba(255,255,255,0.35)',
                background: 'rgba(28,24,20,0.5)',
                backdropFilter: 'blur(2px)',
                cursor: 'pointer',
                fontFamily: 'Public Sans, sans-serif'
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 9,
                  border: '1px solid rgba(255,255,255,0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                  color: '#F5F1EA',
                  marginBottom: 14
                }}
              >
                +
              </div>
              <div style={{ fontFamily: 'Source Serif 4, serif', fontSize: 17, fontWeight: 600, color: '#F5F1EA', marginBottom: 4 }}>
                New Project
              </div>
              <div style={{ fontSize: 12, color: 'rgba(245,241,234,0.68)' }}>Start with a guided Story Foundations setup</div>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
