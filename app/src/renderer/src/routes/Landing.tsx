import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ProjectManifest } from '@shared/schema/project'
import { useAtlasStore } from '../state/store'

interface ProjectListEntry {
  projectRoot: string
  manifest: ProjectManifest
}

export function Landing(): JSX.Element {
  const openSampleProject = useAtlasStore((s) => s.openSampleProject)
  const openProjectAtPath = useAtlasStore((s) => s.openProjectAtPath)
  const startNewProject = useAtlasStore((s) => s.startNewProject)
  const setPendingImportCandidates = useAtlasStore((s) => s.setPendingImportCandidates)
  const navigate = useNavigate()

  const [projects, setProjects] = useState<ProjectListEntry[]>([])
  const [importError, setImportError] = useState<string | null>(null)

  const refreshProjects = (): void => {
    void window.atlas.project.list().then(setProjects)
  }

  useEffect(() => {
    refreshProjects()
  }, [])

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
          A writing companion for the long haul of a novel — draft, revise, and world-build alongside five specialized agents
        </div>

        <div
          style={{
            width: '100%',
            maxWidth: 920,
            position: 'relative',
            borderRadius: 20,
            overflow: 'hidden',
            backgroundImage: "url('/assets/writers-desk.png')",
            backgroundSize: 'contain',
            backgroundPosition: 'center',
            padding: '52px 40px',
            aspectRatio: '1402 / 1122',
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
            {importError && (
              <div
                style={{
                  gridColumn: '1 / -1',
                  padding: 12,
                  borderRadius: 8,
                  border: '1px solid rgba(255,160,160,0.55)',
                  background: 'rgba(90,20,20,0.45)',
                  color: '#FFE6E2',
                  fontSize: 13
                }}
              >
                {importError}
              </div>
            )}

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

            <button
              onClick={() => {
                setImportError(null)
                void window.atlas.import.manuscript().then(async (result) => {
                  if (result.canceled) return
                  if (result.error || !result.projectRoot) {
                    setImportError(result.error ?? 'Import failed.')
                    return
                  }
                  await openProjectAtPath(result.projectRoot)
                  setPendingImportCandidates(result.codexCandidates ?? [])
                  navigate('/codex-import-review')
                })
              }}
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
                IM
              </div>
              <div style={{ fontFamily: 'Source Serif 4, serif', fontSize: 17, fontWeight: 600, color: '#F5F1EA', marginBottom: 4 }}>
                Import Manuscript
              </div>
              <div style={{ fontSize: 12, color: 'rgba(245,241,234,0.68)' }}>Create a project from Markdown, text, or Word</div>
            </button>

            {projects.map(({ projectRoot, manifest }) => {
              const sublineParts: string[] = []
              if (manifest.genrePrimary) sublineParts.push(manifest.genrePrimary)
              if (manifest.targetWordCount) sublineParts.push(`${manifest.targetWordCount.toLocaleString()} word target`)

              return (
                <div
                  key={projectRoot}
                  style={{
                    textAlign: 'left',
                    padding: 22,
                    borderRadius: 14,
                    border: '1px solid rgba(255,255,255,0.14)',
                    background: 'rgba(28,24,20,0.72)',
                    backdropFilter: 'blur(2px)',
                    fontFamily: 'Public Sans, sans-serif',
                    display: 'flex',
                    flexDirection: 'column'
                  }}
                >
                  <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--c-accent-soft)', marginBottom: 14 }} />
                  <div
                    style={{
                      fontFamily: 'Source Serif 4, serif',
                      fontSize: 17,
                      fontWeight: 600,
                      color: '#F5F1EA',
                      marginBottom: 4
                    }}
                  >
                    {manifest.title}
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(245,241,234,0.68)', marginBottom: 14 }}>
                    {sublineParts.length > 0 ? sublineParts.join(' · ') : 'In progress'}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                    <button
                      onClick={() => {
                        void openProjectAtPath(projectRoot)
                      }}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid rgba(255,255,255,0.25)',
                        background: 'rgba(255,255,255,0.08)',
                        color: '#F5F1EA',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontFamily: 'Public Sans, sans-serif'
                      }}
                    >
                      Open
                    </button>
                    <button
                      onClick={() => {
                        if (!window.confirm(`Delete "${manifest.title}"? This cannot be undone.`)) return
                        void window.atlas.project.delete(projectRoot).then(refreshProjects)
                      }}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid rgba(255,255,255,0.14)',
                        background: 'transparent',
                        color: 'rgba(245,241,234,0.68)',
                        fontSize: 12,
                        cursor: 'pointer',
                        fontFamily: 'Public Sans, sans-serif'
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
