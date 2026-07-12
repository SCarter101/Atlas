import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AgentGoal, AgentRole } from '@shared/schema/agent'
import { encodeWorldBuilderInterview, genreTemplateLabel, type WorldBuilderInterviewAnswers } from '@shared/worldBuilderInterview'
import { AssistantIcon, type IconKind } from './AssistantIcon'
import { PreflightDialog } from './PreflightDialog'
import { WorldBuilderInterview } from './WorldBuilderInterview'
import { useAtlasStore } from '../state/store'

interface AgentDef {
  role: AgentRole
  name: string
  iconKind: IconKind
  wired: boolean
}

const AGENTS: AgentDef[] = [
  { role: 'Generator', name: 'Generator', iconKind: 'nib', wired: true },
  { role: 'Dev-Editor', name: 'Story Editor', iconKind: 'compass', wired: true },
  { role: 'Line-Editor', name: 'Line Editor', iconKind: 'loupe', wired: true },
  { role: 'Dialoguer', name: 'Dialogue Editor', iconKind: 'quote', wired: true },
  { role: 'World-Builder', name: 'World Builder', iconKind: 'globe', wired: true }
]

export function AgentRail({ getSelection, sceneId }: { getSelection: () => string; sceneId: string }): JSX.Element {
  const handleAgentStep = useAtlasStore((s) => s.handleAgentStep)
  const startAgentRun = useAtlasStore((s) => s.startAgentRun)
  const activeSuggestions = useAtlasStore((s) => s.activeSuggestions)
  const agentModels = useAtlasStore((s) => s.agentModels)
  const currentRunGoal = useAtlasStore((s) => s.currentRunGoal)
  const currentRunSteps = useAtlasStore((s) => s.currentRunSteps)
  const [expandedRole, setExpandedRole] = useState<AgentRole | null>(null)
  const [preflight, setPreflight] = useState<{ agent: AgentDef; selectionText: string } | null>(null)
  const [interviewOpen, setInterviewOpen] = useState(false)
  const navigate = useNavigate()

  const runInFlight =
    currentRunGoal && !currentRunSteps.some((s) => s.kind === 'result')
      ? { agentRole: currentRunGoal.agentRole, runId: currentRunGoal.runId, stepCount: currentRunSteps.length, goal: currentRunGoal }
      : null

  // Shared by both the "Invoke on scene" flow (a raw manuscript selection)
  // and the World Builder interview flow (a marker-encoded interview
  // payload, see startInterviewRun below) — both just need an AgentGoal
  // built and dispatched the same way.
  function runAgent(agent: AgentDef, selectionText: string, userIntent: string): void {
    const runId = crypto.randomUUID()
    const goal: AgentGoal = {
      runId,
      agentRole: agent.role,
      // Provider is 'anthropic' (not 'openrouter'/'lm-studio') because model
      // calls are simulated in this build — those two providers are a real,
      // reachable seam (see main/agent/providers/) for a future integration,
      // not something any goal built here should route through today.
      modelRef: { provider: 'anthropic', modelId: agentModels[agent.role], viaOpenRouter: false },
      userIntent,
      scope: { sceneIds: [sceneId], selectionText },
      constraints: {
        maxTurns: 4,
        maxTokens: 4000,
        maxToolCalls: 3,
        maxElapsedMs: 30000,
        allowedCapabilityCategories: ['line-editing']
      }
    }

    startAgentRun(goal)
    void window.atlas.agentRuns.start(goal)
    window.atlas.agentRuns.onStep(runId, (step) => handleAgentStep(runId, step))
  }

  function startRun(agent: AgentDef, selectionText: string): void {
    runAgent(agent, selectionText, `Send selected text to ${agent.name}`)
  }

  function startInterviewRun(agent: AgentDef, answers: WorldBuilderInterviewAnswers): void {
    runAgent(agent, encodeWorldBuilderInterview(answers), `Run World Builder interview for a ${genreTemplateLabel(answers.genreTemplate)}`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', marginBottom: 4 }}>
        Agents
      </div>
      {AGENTS.map((agent) => {
        const pendingCount = activeSuggestions.filter((s) => s.agentRole === agent.role && s.state === 'pending').length
        const isExpanded = expandedRole === agent.role
        const selectionAvailable = getSelection().length > 0
        const thisAgentRunning = runInFlight?.agentRole === agent.role

        return (
          <div
            key={agent.role}
            style={{
              border: `1px solid ${thisAgentRunning ? 'var(--c-amber)' : 'var(--c-border)'}`,
              borderRadius: 10,
              marginBottom: 4,
              background: isExpanded ? 'var(--c-surface-raised)' : 'transparent',
              overflow: 'hidden'
            }}
          >
            <button
              onClick={() => setExpandedRole(isExpanded ? null : agent.role)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                textAlign: 'left'
              }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  background: 'var(--c-accent-soft)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}
              >
                <AssistantIcon kind={agent.iconKind} color="var(--c-accent)" size={16} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)' }}>{agent.name}</div>
                <div style={{ fontSize: 11, color: 'var(--c-ink-faint)', marginTop: 1 }}>{agentModels[agent.role]}</div>
              </div>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: thisAgentRunning || pendingCount > 0 ? 'var(--c-amber)' : 'var(--c-ink-faint)',
                  flexShrink: 0
                }}
              />
            </button>

            {isExpanded && (
              <div style={{ padding: '0 12px 12px' }}>
                {thisAgentRunning ? (
                  <>
                    <div style={{ fontSize: 12, color: 'var(--c-ink-soft)', marginBottom: 10 }}>
                      Running — step {runInFlight.stepCount} of up to {runInFlight.goal.constraints.maxToolCalls} tool calls,{' '}
                      {runInFlight.goal.constraints.maxTokens} token budget
                    </div>
                    <button
                      onClick={() => void window.atlas.agentRuns.cancel(runInFlight.runId)}
                      style={{
                        width: '100%',
                        padding: '7px 0',
                        borderRadius: 7,
                        border: '1px solid var(--c-red)',
                        background: 'var(--c-red-soft)',
                        color: 'var(--c-red)',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Cancel run
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 12, color: 'var(--c-ink-soft)', marginBottom: 10 }}>
                      {pendingCount > 0 ? `${pendingCount} pending` : 'Idle'}
                      {agent.wired && !selectionAvailable ? ' · select text in the manuscript first' : ''}
                      {!agent.wired ? ' · not wired up in this build yet' : ''}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => setPreflight({ agent, selectionText: getSelection() })}
                        disabled={!agent.wired || !selectionAvailable}
                        style={{
                          flex: 1,
                          padding: '7px 0',
                          borderRadius: 7,
                          border: 'none',
                          background: agent.wired && selectionAvailable ? 'var(--c-accent)' : 'var(--c-border)',
                          color: agent.wired && selectionAvailable ? '#fff' : 'var(--c-ink-faint)',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: agent.wired && selectionAvailable ? 'pointer' : 'default'
                        }}
                      >
                        Invoke on scene
                      </button>
                      <button
                        onClick={() => navigate('/settings')}
                        style={{
                          flex: 1,
                          padding: '7px 0',
                          borderRadius: 7,
                          border: '1px solid var(--c-border)',
                          background: 'transparent',
                          color: 'var(--c-ink-soft)',
                          fontSize: 12,
                          cursor: 'pointer'
                        }}
                      >
                        Configure
                      </button>
                    </div>
                    {agent.role === 'World-Builder' && (
                      <button
                        onClick={() => setInterviewOpen(true)}
                        style={{
                          width: '100%',
                          marginTop: 8,
                          padding: '7px 0',
                          borderRadius: 7,
                          border: '1px solid var(--c-border)',
                          background: 'var(--c-accent-soft)',
                          color: 'var(--c-accent-text)',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        Start world interview
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}

      {preflight && (
        <PreflightDialog
          agentName={preflight.agent.name}
          model={agentModels[preflight.agent.role]}
          selectionText={preflight.selectionText}
          onConfirm={() => {
            startRun(preflight.agent, preflight.selectionText)
            setPreflight(null)
          }}
          onCancel={() => setPreflight(null)}
        />
      )}

      {interviewOpen && (
        <WorldBuilderInterview
          onSubmit={(answers) => {
            const worldBuilder = AGENTS.find((a) => a.role === 'World-Builder')
            if (worldBuilder) startInterviewRun(worldBuilder, answers)
            setInterviewOpen(false)
          }}
          onCancel={() => setInterviewOpen(false)}
        />
      )}
    </div>
  )
}
