import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AgentGoal, AgentRole, GeneratorControls, LineEditorControls } from '@shared/schema/agent'
import { describeProvider } from '@shared/privacy'
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

// Phase 8 §7.1/§7.3: shared visual language for the new Generator/Line-Editor
// control-set inputs below — matches the existing inline-style-object
// convention used throughout this file rather than introducing a new UI kit.
const controlInputStyle = {
  width: '100%',
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--c-border)',
  background: 'var(--c-bg)',
  color: 'var(--c-ink)',
  fontSize: 12,
  fontFamily: 'Public Sans, sans-serif',
  boxSizing: 'border-box'
} as const

export function AgentRail({ getSelection, sceneId }: { getSelection: () => string; sceneId: string }): JSX.Element {
  const handleAgentStep = useAtlasStore((s) => s.handleAgentStep)
  const startAgentRun = useAtlasStore((s) => s.startAgentRun)
  const activeSuggestions = useAtlasStore((s) => s.activeSuggestions)
  const agentModels = useAtlasStore((s) => s.agentModels)
  const authorizeAgentRun = useAtlasStore((s) => s.authorizeAgentRun)
  const currentRunGoal = useAtlasStore((s) => s.currentRunGoal)
  const currentRunSteps = useAtlasStore((s) => s.currentRunSteps)
  const advancedMode = useAtlasStore((s) => s.advancedMode)
  const lmStudioFallback = useAtlasStore((s) => s.lmStudioFallback)
  const [expandedRole, setExpandedRole] = useState<AgentRole | null>(null)
  const [preflight, setPreflight] = useState<{ agent: AgentDef; selectionText: string } | null>(null)
  const [interviewOpen, setInterviewOpen] = useState(false)
  const [privacyMessage, setPrivacyMessage] = useState<string | null>(null)
  // Opt-in "Generate Alternatives" mode (Required UI Features: "Enable
  // multiple drafts only as an optional advanced feature") — only exposed
  // for Generator, and only when Advanced Mode is on (see Settings.tsx's
  // description of what Advanced Mode reveals, which literally names
  // "multiple drafts"). Read at the moment a run is started, not baked into
  // AgentDef, since it's a per-run choice rather than a per-agent setting.
  const [generateAlternatives, setGenerateAlternatives] = useState(false)

  // Round 12: World Builder's opt-in real web-research mode (Brave Search
  // MCP) — same Advanced-Mode-gated, per-run, local-useState convention as
  // generateAlternatives above, just scoped to World-Builder instead of
  // Generator.
  const [webResearchEnabled, setWebResearchEnabled] = useState(false)

  // Phase 8 §7.1: Generator's writer-facing control set — Advanced-Mode-gated
  // the same way generateAlternatives is above, local useState only (no
  // persistence needed since AgentRail doesn't unmount between runs).
  const [genTone, setGenTone] = useState('')
  const [genPacing, setGenPacing] = useState<'' | NonNullable<GeneratorControls['pacing']>>('')
  const [genPovDepth, setGenPovDepth] = useState<'' | NonNullable<GeneratorControls['povDepth']>>('')
  const [genDialogueDensity, setGenDialogueDensity] = useState<'' | NonNullable<GeneratorControls['dialogueDensity']>>('')
  const [genExposition, setGenExposition] = useState<'' | NonNullable<GeneratorControls['exposition']>>('')
  const [genHeatLevel, setGenHeatLevel] = useState<'' | NonNullable<GeneratorControls['heatLevel']>>('')
  const [genLiteraryStyle, setGenLiteraryStyle] = useState('')
  const [genStyleSampleText, setGenStyleSampleText] = useState('')

  // Phase 8 §7.3: Line-Editor's writer-facing control set, same pattern.
  const [lineIntensity, setLineIntensity] = useState<LineEditorControls['intensity']>('standard')
  const [lineHouseStyleRules, setLineHouseStyleRules] = useState('')
  const [lineFlagAiSounding, setLineFlagAiSounding] = useState(false)

  const navigate = useNavigate()

  const runInFlight =
    currentRunGoal && !currentRunSteps.some((s) => s.kind === 'result')
      ? { agentRole: currentRunGoal.agentRole, runId: currentRunGoal.runId, stepCount: currentRunSteps.length, goal: currentRunGoal }
      : null

  // Shared by both the "Invoke on scene" flow (a raw manuscript selection)
  // and the World Builder interview flow (a marker-encoded interview
  // payload, see startInterviewRun below) — both just need an AgentGoal
  // built and dispatched the same way. The actual privacy/cloud-consent
  // gating now lives in the store's authorizeAgentRun (Phase 8), shared
  // with the Refine loop — this just surfaces its result as this
  // component's local banner.
  async function authorizeRun(goal: AgentGoal): Promise<boolean> {
    const { ok, message } = await authorizeAgentRun(goal)
    setPrivacyMessage(message ?? null)
    return ok
  }

  async function runAgent(agent: AgentDef, selectionText: string, userIntent: string): Promise<void> {
    const runId = crypto.randomUUID()

    // Phase 8 §7.1/§7.3: only ever populated when Advanced Mode is on, the
    // run targets the matching role, AND at least one control differs from
    // its default — otherwise the whole object is omitted so an ordinary run
    // (or a run against the other 3 roles) is completely unaffected, same
    // convention generateAlternatives above already follows.
    const generatorControls: GeneratorControls | undefined =
      agent.role === 'Generator' &&
      advancedMode &&
      (genTone.trim() ||
        genPacing ||
        genPovDepth ||
        genDialogueDensity ||
        genExposition ||
        genHeatLevel ||
        genLiteraryStyle.trim() ||
        genStyleSampleText.trim())
        ? {
            tone: genTone.trim() || undefined,
            pacing: genPacing || undefined,
            povDepth: genPovDepth || undefined,
            dialogueDensity: genDialogueDensity || undefined,
            exposition: genExposition || undefined,
            heatLevel: genHeatLevel || undefined,
            literaryStyle: genLiteraryStyle.trim() || undefined,
            styleSampleText: genStyleSampleText.trim() || undefined
          }
        : undefined

    const lineEditorControls: LineEditorControls | undefined =
      agent.role === 'Line-Editor' && advancedMode && (lineIntensity !== 'standard' || lineHouseStyleRules.trim() || lineFlagAiSounding)
        ? {
            // intensity is the one required field on LineEditorControls, so
            // it's always included once the object is included at all —
            // defaults to 'standard' the same as the control's own useState.
            intensity: lineIntensity,
            houseStyleRules: lineHouseStyleRules.trim()
              ? lineHouseStyleRules
                  .split('\n')
                  .map((rule) => rule.trim())
                  .filter((rule) => rule.length > 0)
              : undefined,
            flagAiSoundingProse: lineFlagAiSounding || undefined
          }
        : undefined

    const goal: AgentGoal = {
      runId,
      agentRole: agent.role,
      // Phase 6: agentModels now holds a real per-role ModelRef (see
      // store.ts) instead of a bare display string, so it's used directly
      // here rather than wrapped in a hand-built 'anthropic' stand-in.
      modelRef: agentModels[agent.role],
      userIntent,
      scope: { sceneIds: [sceneId], selectionText },
      constraints: {
        maxTurns: 4,
        // Phase 8: bumped from 4000 — real structured (JSON-mode) output
        // for the now-real Dev-Editor/Dialoguer/World-Builder/Line-Editor
        // paths runs more output-token-hungry than equivalent free-form
        // prose for the same content, and guardModelCall's budget check
        // only runs after the (already-billed) call completes, so a too-tight
        // budget mostly just discards a real result rather than saving cost.
        maxTokens: 6000,
        maxToolCalls: 3,
        maxElapsedMs: 30000,
        allowedCapabilityCategories: ['line-editing']
      },
      generateAlternatives: agent.role === 'Generator' && advancedMode && generateAlternatives ? true : undefined,
      lmStudioFallback,
      generatorControls,
      lineEditorControls,
      webResearchEnabled: agent.role === 'World-Builder' && advancedMode && webResearchEnabled ? true : undefined
    }

    if (!(await authorizeRun(goal))) return

    startAgentRun(goal)
    void window.atlas.agentRuns.start(goal)
    window.atlas.agentRuns.onStep(runId, (step) => handleAgentStep(runId, step))
  }

  function startRun(agent: AgentDef, selectionText: string): void {
    void runAgent(agent, selectionText, `Send selected text to ${agent.name}`)
  }

  function startInterviewRun(agent: AgentDef, answers: WorldBuilderInterviewAnswers): void {
    void runAgent(agent, encodeWorldBuilderInterview(answers), `Run World Builder interview for a ${genreTemplateLabel(answers.genreTemplate)}`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', marginBottom: 4 }}>
        Agents
      </div>
      {privacyMessage && (
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.45,
            color: 'var(--c-amber)',
            background: 'var(--c-amber-soft)',
            border: '1px solid var(--c-border)',
            borderRadius: 8,
            padding: '8px 10px',
            marginBottom: 8
          }}
        >
          {privacyMessage}
        </div>
      )}
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
                <div style={{ fontSize: 11, color: 'var(--c-ink-faint)', marginTop: 1 }}>{describeProvider(agentModels[agent.role])}</div>
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
                    {agent.role === 'Generator' && advancedMode && (
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 12,
                          color: 'var(--c-ink-soft)',
                          marginBottom: 10,
                          cursor: 'pointer'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={generateAlternatives}
                          onChange={(e) => setGenerateAlternatives(e.target.checked)}
                        />
                        Generate alternatives (3 drafts to compare)
                      </label>
                    )}
                    {agent.role === 'Generator' && advancedMode && (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                          marginBottom: 10,
                          paddingTop: 8,
                          borderTop: '1px solid var(--c-border)'
                        }}
                      >
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-ink-soft)' }}>Style guidance (optional)</div>
                        <input
                          type="text"
                          value={genTone}
                          onChange={(e) => setGenTone(e.target.value)}
                          placeholder="Tone (e.g. wry, tense, wistful)"
                          style={controlInputStyle}
                        />
                        <select
                          value={genPacing}
                          onChange={(e) => setGenPacing(e.target.value as typeof genPacing)}
                          style={controlInputStyle}
                        >
                          <option value="">Pacing — default</option>
                          <option value="slow">Slow</option>
                          <option value="moderate">Moderate</option>
                          <option value="fast">Fast</option>
                        </select>
                        <select
                          value={genPovDepth}
                          onChange={(e) => setGenPovDepth(e.target.value as typeof genPovDepth)}
                          style={controlInputStyle}
                        >
                          <option value="">POV depth — default</option>
                          <option value="distant">Distant</option>
                          <option value="close">Close</option>
                          <option value="deep">Deep</option>
                        </select>
                        <select
                          value={genDialogueDensity}
                          onChange={(e) => setGenDialogueDensity(e.target.value as typeof genDialogueDensity)}
                          style={controlInputStyle}
                        >
                          <option value="">Dialogue density — default</option>
                          <option value="sparse">Sparse</option>
                          <option value="balanced">Balanced</option>
                          <option value="dialogue-heavy">Dialogue-heavy</option>
                        </select>
                        <select
                          value={genExposition}
                          onChange={(e) => setGenExposition(e.target.value as typeof genExposition)}
                          style={controlInputStyle}
                        >
                          <option value="">Exposition — default</option>
                          <option value="minimal">Minimal</option>
                          <option value="moderate">Moderate</option>
                          <option value="detailed">Detailed</option>
                        </select>
                        <select
                          value={genHeatLevel}
                          onChange={(e) => setGenHeatLevel(e.target.value as typeof genHeatLevel)}
                          style={controlInputStyle}
                        >
                          <option value="">Heat/violence level — default</option>
                          <option value="closed-door">Closed-door</option>
                          <option value="suggestive">Suggestive</option>
                          <option value="explicit">Explicit</option>
                        </select>
                        <input
                          type="text"
                          value={genLiteraryStyle}
                          onChange={(e) => setGenLiteraryStyle(e.target.value)}
                          placeholder="Literary style (e.g. commercial thriller)"
                          style={controlInputStyle}
                        />
                        <textarea
                          value={genStyleSampleText}
                          onChange={(e) => setGenStyleSampleText(e.target.value)}
                          placeholder="Paste a prose sample to imitate its voice…"
                          style={{ ...controlInputStyle, minHeight: 48, resize: 'vertical' }}
                        />
                      </div>
                    )}
                    {agent.role === 'Line-Editor' && advancedMode && (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                          marginBottom: 10,
                          paddingTop: 8,
                          borderTop: '1px solid var(--c-border)'
                        }}
                      >
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-ink-soft)' }}>Editing controls (optional)</div>
                        <select
                          value={lineIntensity}
                          onChange={(e) => setLineIntensity(e.target.value as LineEditorControls['intensity'])}
                          style={controlInputStyle}
                        >
                          <option value="light">Light — only clear errors</option>
                          <option value="standard">Standard — default thoroughness</option>
                          <option value="heavy">Heavy — aggressive tightening</option>
                          <option value="custom">Custom — follow house style rules</option>
                        </select>
                        <textarea
                          value={lineHouseStyleRules}
                          onChange={(e) => setLineHouseStyleRules(e.target.value)}
                          placeholder="House style rules, one per line…"
                          style={{ ...controlInputStyle, minHeight: 48, resize: 'vertical' }}
                        />
                        <label
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            fontSize: 12,
                            color: 'var(--c-ink-soft)',
                            cursor: 'pointer'
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={lineFlagAiSounding}
                            onChange={(e) => setLineFlagAiSounding(e.target.checked)}
                          />
                          Flag AI-sounding prose
                        </label>
                      </div>
                    )}
                    {agent.role === 'World-Builder' && advancedMode && (
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 12,
                          color: 'var(--c-ink-soft)',
                          marginBottom: 10,
                          cursor: 'pointer'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={webResearchEnabled}
                          onChange={(e) => setWebResearchEnabled(e.target.checked)}
                        />
                        Include real web research (Brave Search)
                      </label>
                    )}
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
