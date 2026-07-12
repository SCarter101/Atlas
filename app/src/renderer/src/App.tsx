import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { Landing } from './routes/Landing'
import { StoryFoundations } from './routes/StoryFoundations'
import { Dashboard } from './routes/Dashboard'
import { ManuscriptWorkspace } from './routes/ManuscriptWorkspace'
import { CodexView } from './routes/CodexView'
import { Outline } from './routes/Outline'
import { Timeline } from './routes/Timeline'
import { Settings } from './routes/Settings'
import { RoutingView } from './routes/RoutingView'
import { AgentRunsView } from './routes/AgentRunsView'
import { Library } from './routes/Library'
import { Export } from './routes/Export'
import { useAtlasStore } from './state/store'

export default function App(): JSX.Element {
  const stage = useAtlasStore((s) => s.stage)

  if (stage === 'landing') {
    return <Landing />
  }

  if (stage === 'onboarding') {
    return (
      <div style={{ height: '100vh', background: 'var(--c-bg)', color: 'var(--c-ink)' }}>
        <StoryFoundations />
      </div>
    )
  }

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/manuscript" element={<ManuscriptWorkspace />} />
        <Route path="/codex" element={<CodexView />} />
        <Route path="/outline" element={<Outline />} />
        <Route path="/timeline" element={<Timeline />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/routing" element={<RoutingView />} />
        <Route path="/agent-runs" element={<AgentRunsView />} />
        <Route path="/library" element={<Library />} />
        <Route path="/export" element={<Export />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AppShell>
  )
}
