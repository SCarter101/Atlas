import type { PermissionRequest, ToolCall } from '@shared/schema/agent'
import { ContextInspectionPanel } from '../components/ContextInspectionPanel'
import { useAtlasStore } from '../state/store'

interface NodeSpec {
  title: string
  detail: string
  active: boolean
  modeled: boolean
}

// Node-based visualization of how an agent request flows through the
// runtime (spec §8). Driven by the most recent real AgentGoal/AgentStep[]
// in the store — nothing here is fabricated. Nodes for pipeline stages our
// simulator doesn't actually populate yet (Codex retrieval, chapter
// summaries, web search) are shown but honestly marked "not modeled".
export function RoutingView(): JSX.Element {
  const goal = useAtlasStore((s) => s.currentRunGoal)
  const steps = useAtlasStore((s) => s.currentRunSteps)
  const activeSuggestions = useAtlasStore((s) => s.activeSuggestions)
  const advancedMode = useAtlasStore((s) => s.advancedMode)

  if (!goal) {
    return (
      <div style={{ maxWidth: 640, margin: '80px auto', padding: '0 40px', textAlign: 'center' }}>
        <div style={{ fontFamily: 'Source Serif 4, serif', fontSize: 22, fontWeight: 600, marginBottom: 10 }}>Agent Routing</div>
        <div style={{ fontSize: 14, color: 'var(--c-ink-soft)', lineHeight: 1.6 }}>
          No agent run yet this session. Send a selection to Line Editor from the manuscript, then come back here — this
          view traces the actual run, not a canned example.
        </div>
      </div>
    )
  }

  const toolCalls = steps.filter((s) => s.kind === 'tool-call')
  const permissionSteps = steps.filter((s) => s.kind === 'permission-request')
  const lastPermission = permissionSteps.at(-1)?.detail as PermissionRequest | undefined
  const resultStep = steps.find((s) => s.kind === 'result')
  const runSuggestions = activeSuggestions.filter((s) => s.provenance.runId === goal.runId)
  const approved = runSuggestions.some((s) => s.state === 'accepted' || s.state === 'rejected')

  const stages: { label: string; nodes: NodeSpec[] }[] = [
    {
      label: 'Trigger',
      nodes: [
        { title: 'Selected agent', detail: goal.agentRole, active: true, modeled: true },
        { title: 'User selection', detail: truncate(goal.scope.selectionText ?? '—'), active: !!goal.scope.selectionText, modeled: true }
      ]
    },
    {
      label: 'Goal',
      nodes: [
        {
          title: 'Agent goal & constraints',
          detail: `${goal.userIntent} · max ${goal.constraints.maxTurns} turns, ${goal.constraints.maxTokens} tokens`,
          active: true,
          modeled: true
        },
        { title: 'Agent prompt & bounded loop', detail: `${steps.length} step${steps.length === 1 ? '' : 's'} so far`, active: steps.length > 0, modeled: true }
      ]
    },
    {
      label: 'Capabilities',
      nodes: [
        {
          title: 'Tool & skill discovery',
          detail: toolCalls.length ? (toolCalls[0].detail as ToolCall).toolId : 'none called',
          active: toolCalls.length > 0,
          modeled: true
        },
        {
          title: 'Permission check',
          detail: lastPermission ? `${lastPermission.capabilityId} · ${lastPermission.decision}` : 'none requested',
          active: permissionSteps.length > 0,
          modeled: true
        }
      ]
    },
    {
      label: 'Model routing',
      nodes: [
        { title: 'Model selection', detail: goal.modelRef.modelId, active: true, modeled: true },
        { title: 'OpenRouter', detail: goal.modelRef.viaOpenRouter ? 'routed' : 'not used', active: goal.modelRef.viaOpenRouter, modeled: true },
        { title: 'LM Studio fallback', detail: goal.modelRef.provider === 'lm-studio' ? 'active' : 'standing by', active: goal.modelRef.provider === 'lm-studio', modeled: true }
      ]
    },
    {
      label: 'Context',
      nodes: [
        { title: 'Manuscript context', detail: goal.scope.sceneIds?.join(', ') ?? '—', active: !!goal.scope.sceneIds?.length, modeled: true },
        { title: 'Codex retrieval', detail: 'not modeled in this simulated run', active: false, modeled: false },
        { title: 'Chapter summaries', detail: 'not modeled in this simulated run', active: false, modeled: false },
        { title: 'Web search', detail: 'not modeled in this simulated run', active: false, modeled: false }
      ]
    },
    {
      label: 'Execution',
      nodes: [
        {
          title: 'Structured tool result',
          detail: toolCalls.length ? `${Array.isArray((toolCalls[0].detail as ToolCall).output) ? ((toolCalls[0].detail as ToolCall).output as unknown[]).length : 0} item(s)` : 'none',
          active: toolCalls.some((s) => (s.detail as ToolCall).output !== undefined),
          modeled: true
        },
        { title: 'Response format', detail: runSuggestions[0]?.kind ?? '—', active: runSuggestions.length > 0, modeled: true }
      ]
    },
    {
      label: 'Approval',
      nodes: [
        { title: 'Writer approval step', detail: approved ? 'reviewed' : 'awaiting review', active: runSuggestions.length > 0, modeled: true }
      ]
    }
  ]

  return (
    <div style={{ padding: '36px 40px 80px', overflowX: 'auto' }}>
      <div style={{ fontFamily: 'Source Serif 4, serif', fontSize: 24, fontWeight: 600, marginBottom: 4 }}>Agent Routing</div>
      <div style={{ fontSize: 13.5, color: 'var(--c-ink-faint)', marginBottom: 28 }}>
        Tracing the most recent run: {goal.agentRole} · {resultStep ? 'completed' : 'running'}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, minWidth: 'max-content' }}>
        {stages.map((stage, i) => (
          <div key={stage.label} style={{ display: 'flex', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', marginBottom: 10 }}>
                {stage.label}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {stage.nodes.map((node) => (
                  <Node key={node.title} node={node} />
                ))}
              </div>
            </div>
            {i < stages.length - 1 && (
              <div style={{ padding: '24px 10px 0', color: 'var(--c-ink-faint)', fontSize: 16 }}>→</div>
            )}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 32, fontSize: 11.5, color: 'var(--c-ink-faint)' }}>
        No private model reasoning is shown or stored here — only structured step data, per spec §8.
      </div>

      {advancedMode ? (
        <ContextInspectionPanel goal={goal} steps={steps} />
      ) : (
        <div style={{ marginTop: 20, fontSize: 12, color: 'var(--c-ink-faint)' }}>
          Turn on Advanced Mode in Settings to see the full context inspection breakdown for this run.
        </div>
      )}
    </div>
  )
}

function Node({ node }: { node: NodeSpec }): JSX.Element {
  return (
    <div
      style={{
        width: 190,
        padding: '10px 12px',
        borderRadius: 10,
        border: `1px solid ${node.active ? 'var(--c-accent)' : 'var(--c-border)'}`,
        background: node.active ? 'var(--c-accent-soft)' : node.modeled ? 'var(--c-surface-raised)' : 'transparent',
        borderStyle: node.modeled ? 'solid' : 'dashed',
        opacity: node.modeled ? 1 : 0.6
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: node.active ? 'var(--c-accent-text)' : 'var(--c-ink)', marginBottom: 3 }}>{node.title}</div>
      <div style={{ fontSize: 11, color: 'var(--c-ink-faint)', lineHeight: 1.4, wordBreak: 'break-word' }}>{node.detail}</div>
    </div>
  )
}

function truncate(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}
