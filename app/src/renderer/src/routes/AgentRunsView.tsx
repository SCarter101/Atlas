import { ComingSoon } from '../components/ComingSoon'

export function AgentRunsView(): JSX.Element {
  return (
    <ComingSoon
      title="Agent Runs"
      description="A history/detail view over past agent runs isn't built yet. The underlying records already exist on disk (agent-runs/*.json) every time you send a selection to Line Editor — this view just needs to read and list them."
    />
  )
}
