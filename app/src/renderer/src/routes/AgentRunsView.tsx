import { useEffect, useState } from 'react'
import type {
  AgentResult,
  AgentRunRecord,
  AgentRunStatus,
  AgentStep,
  ModelCallSummary,
  PermissionRequest,
  SkillInvocation,
  ToolCall
} from '@shared/schema/agent'
import type { AgentRunSummary } from '@shared/ipc'
import { ComingSoon } from '../components/ComingSoon'

const STATUS_COLOR: Record<AgentRunStatus, string> = {
  running: 'var(--c-accent-text)',
  paused: 'var(--c-amber)',
  completed: 'var(--c-green)',
  cancelled: 'var(--c-ink-faint)',
  error: 'var(--c-red)'
}

const KIND_LABEL: Record<AgentStep['kind'], string> = {
  plan: 'Plan',
  'tool-call': 'Tool Call',
  'skill-invoke': 'Skill Invoke',
  'permission-request': 'Permission',
  'model-call': 'Model Call',
  result: 'Result'
}

// This app doesn't have a router-level "back" concept for these lightweight
// history views, so run selection is just local state — see CodexView.tsx
// and RoutingView.tsx for the same local-fetch-on-mount convention.
export function AgentRunsView(): JSX.Element {
  const [runs, setRuns] = useState<AgentRunSummary[] | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedRun, setSelectedRun] = useState<AgentRunRecord | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  useEffect(() => {
    void window.atlas.agentRuns.list().then(setRuns)
  }, [])

  useEffect(() => {
    if (!selectedRunId) {
      setSelectedRun(null)
      return
    }
    setLoadingDetail(true)
    void window.atlas.agentRuns
      .get(selectedRunId)
      .then(setSelectedRun)
      .finally(() => setLoadingDetail(false))
  }, [selectedRunId])

  if (runs === null) {
    return (
      <div style={{ padding: '36px 40px 80px' }}>
        <div style={{ fontSize: 13, color: 'var(--c-ink-faint)' }}>Loading agent runs…</div>
      </div>
    )
  }

  if (runs.length === 0) {
    return (
      <ComingSoon
        title="Agent Runs"
        description="No agent runs yet — send a selection to an agent from the manuscript, and its run history will show up here."
      />
    )
  }

  if (selectedRunId) {
    return (
      <div style={{ maxWidth: 820, margin: '0 auto', padding: '36px 40px 80px' }}>
        <button
          onClick={() => setSelectedRunId(null)}
          style={{
            border: 'none',
            background: 'none',
            color: 'var(--c-accent-text)',
            cursor: 'pointer',
            padding: 0,
            fontSize: 12.5,
            marginBottom: 18
          }}
        >
          ← Back to all runs
        </button>

        {loadingDetail || !selectedRun ? (
          <div style={{ fontSize: 13, color: 'var(--c-ink-faint)' }}>Loading run…</div>
        ) : (
          <RunDetail run={selectedRun} />
        )}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '36px 40px 80px' }}>
      <div style={{ fontFamily: 'Source Serif 4, serif', fontSize: 24, fontWeight: 600, marginBottom: 4 }}>Agent Runs</div>
      <div style={{ fontSize: 13, color: 'var(--c-ink-faint)', marginBottom: 24 }}>
        A record of every agent run in this project, newest first — nothing here is shown that isn't already saved to
        agent-runs/*.json.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {runs.map((run) => (
          <button
            key={run.runId}
            onClick={() => setSelectedRunId(run.runId)}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 16,
              padding: '14px 16px',
              borderRadius: 10,
              border: '1px solid var(--c-border)',
              background: 'var(--c-surface-raised)',
              cursor: 'pointer',
              textAlign: 'left',
              font: 'inherit',
              color: 'inherit'
            }}
          >
            <div>
              <div style={{ fontFamily: 'Source Serif 4, serif', fontWeight: 600, fontSize: 15 }}>{run.agentRole}</div>
              <div style={{ fontSize: 12, color: 'var(--c-ink-faint)', marginTop: 3 }}>
                Started {formatTimestamp(run.startedAt)}
                {run.endedAt ? ` · Ended ${formatTimestamp(run.endedAt)}` : ''}
              </div>
            </div>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '3px 9px',
                borderRadius: 10,
                background: 'var(--c-surface)',
                color: STATUS_COLOR[run.status],
                textTransform: 'capitalize',
                whiteSpace: 'nowrap'
              }}
            >
              {run.status}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function RunDetail({ run }: { run: AgentRunRecord }): JSX.Element {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <div style={{ fontFamily: 'Source Serif 4, serif', fontSize: 22, fontWeight: 600 }}>{run.goal.agentRole}</div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '3px 9px',
            borderRadius: 10,
            background: 'var(--c-surface)',
            color: STATUS_COLOR[run.status],
            textTransform: 'capitalize',
            whiteSpace: 'nowrap'
          }}
        >
          {run.status}
        </span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--c-ink-soft)', marginBottom: 4 }}>{run.goal.userIntent}</div>
      <div style={{ fontSize: 12, color: 'var(--c-ink-faint)', marginBottom: 24 }}>
        Started {formatTimestamp(run.startedAt)}
        {run.endedAt ? ` · Ended ${formatTimestamp(run.endedAt)}` : ' · Still running'} · {run.goal.modelRef.modelId}
      </div>

      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', marginBottom: 10 }}>
        Steps ({run.steps.length})
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {run.steps.map((step) => (
          <div
            key={step.stepIndex}
            style={{
              padding: '12px 14px',
              borderRadius: 10,
              border: '1px solid var(--c-border)',
              background: 'var(--c-surface-raised)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--c-ink-faint)', marginBottom: 5 }}>
              <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>{KIND_LABEL[step.kind]}</span>
              <span>{formatTimestamp(step.timestamp)}</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--c-ink)', lineHeight: 1.5 }}>{stepSummary(step)}</div>
          </div>
        ))}
      </div>

      {run.steps.length === 0 && <div style={{ fontSize: 13, color: 'var(--c-ink-faint)' }}>This run has no recorded steps.</div>}
    </div>
  )
}

function stepSummary(step: AgentStep): string {
  switch (step.kind) {
    case 'plan':
    case 'result': {
      const detail = step.detail as AgentResult
      return detail.summary
    }
    case 'tool-call': {
      const detail = step.detail as ToolCall
      if (detail.error) return `${detail.toolId} → error: ${detail.error.message}`
      return `${detail.toolId}${detail.output !== undefined ? ' → completed' : ''}`
    }
    case 'skill-invoke': {
      const detail = step.detail as SkillInvocation
      return detail.skillId
    }
    case 'permission-request': {
      const detail = step.detail as PermissionRequest
      return `${detail.capabilityId} (${detail.actionType}) · ${detail.decision}`
    }
    case 'model-call': {
      const detail = step.detail as ModelCallSummary
      return `${detail.modelRef.modelId} · ${detail.inputTokens}+${detail.outputTokens} tokens · ~$${detail.estimatedCostUsd.toFixed(4)}`
    }
    default:
      return ''
  }
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}
