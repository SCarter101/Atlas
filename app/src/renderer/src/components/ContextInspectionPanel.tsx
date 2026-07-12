import type { ReactNode } from 'react'
import type { AgentGoal, AgentStep, PermissionRequest, ToolCall } from '@shared/schema/agent'

// spec §9 Context Inspection — what was (or would be) sent to the model for
// this run. Only sections backed by real goal/step data are populated;
// retrieval categories our simulator doesn't do (Codex, chapter summaries)
// are shown honestly empty with a structured warning, in the exact
// what/why/fix shape spec §9 calls for, rather than silently omitted.
export function ContextInspectionPanel({ goal, steps }: { goal: AgentGoal; steps: AgentStep[] }): JSX.Element {
  const toolCalls = steps.filter((s): s is AgentStep & { detail: ToolCall } => s.kind === 'tool-call')
  const permissionSteps = steps.filter((s): s is AgentStep & { detail: PermissionRequest } => s.kind === 'permission-request')
  const resultStep = steps.find((s) => s.kind === 'result')

  return (
    <div style={{ marginTop: 32, maxWidth: 640 }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', marginBottom: 12 }}>
        Context inspection
      </div>

      <Row label="Included manuscript excerpt">{goal.scope.selectionText ? `"${goal.scope.selectionText}"` : '—'}</Row>
      <Row label="Included scene metadata">{goal.scope.sceneIds?.join(', ') ?? '—'}</Row>
      <Row label="Included Codex entries">none — not retrieved in this simulated run</Row>
      <Row label="Included chapter summaries">none — not retrieved in this simulated run</Row>
      <Row label="Model settings">
        {goal.modelRef.modelId} via {goal.modelRef.provider} · max {goal.constraints.maxTurns} turns, {goal.constraints.maxTokens} tokens,{' '}
        {goal.constraints.maxToolCalls} tool calls, {(goal.constraints.maxElapsedMs / 1000).toFixed(0)}s
      </Row>
      <Row label="Run budget used">
        {steps.length} step{steps.length === 1 ? '' : 's'} of up to {goal.constraints.maxToolCalls} tool calls
      </Row>
      <Row label="Tools & skills selected">
        {toolCalls.length > 0 ? toolCalls.map((s) => s.detail.toolId).join(', ') : 'none yet'}
      </Row>
      <Row label="Permission decisions">
        {permissionSteps.length > 0
          ? permissionSteps.map((s) => `${s.detail.capabilityId}: ${s.detail.decision}`).join('; ')
          : 'none yet'}
      </Row>
      <Row label="Structured result">{resultStep ? (resultStep.detail as { summary: string }).summary : 'not finished yet'}</Row>

      <div
        style={{
          marginTop: 16,
          padding: '12px 14px',
          borderRadius: 10,
          background: 'var(--c-amber-soft)',
          border: '1px solid var(--c-amber)',
          fontSize: 12.5,
          color: 'var(--c-ink)'
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Context warning</div>
        <div style={{ marginBottom: 4 }}>
          <strong>What's missing:</strong> Codex entries and chapter summaries relevant to this scene aren't included in
          this run's context.
        </div>
        <div style={{ marginBottom: 4 }}>
          <strong>Why it matters:</strong> the agent can't check its suggestion against canon facts or prior chapters, so
          it may miss continuity issues.
        </div>
        <div>
          <strong>Suggested fix:</strong> retrieval lands in Phase 3 (data-contracts §8) once real model calls replace
          the simulator — until then, treat suggestions as prose-local only.
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10.5, color: 'var(--c-ink-faint)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 12.5, color: 'var(--c-ink)', lineHeight: 1.5 }}>{children}</div>
    </div>
  )
}
