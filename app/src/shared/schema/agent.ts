import type { CapabilityManifest } from './capability'
import type { SceneMeta } from './manuscript'

export type AgentRole = 'Generator' | 'Dev-Editor' | 'Line-Editor' | 'Dialoguer' | 'World-Builder'

export type ModelProvider = 'anthropic' | 'openai' | 'google' | 'openrouter' | 'lm-studio' | 'simulator'

export interface ModelRef {
  provider: ModelProvider
  modelId: string
  viaOpenRouter: boolean
}

export interface AgentGoal {
  runId: string
  agentRole: AgentRole
  modelRef: ModelRef
  userIntent: string
  scope: {
    sceneIds?: string[]
    selectionText?: string
    codexEntryIds?: string[]
  }
  constraints: {
    maxTurns: number
    maxTokens: number
    maxToolCalls: number
    maxElapsedMs: number
    maxCostUsd?: number
    allowedCapabilityCategories: string[]
  }
  // Opt-in "Generate Alternatives" mode (Required UI Features: "Enable
  // multiple drafts only as an optional advanced feature"). Only consulted
  // by the Generator role today — see simulateGeneratorContinuation() in
  // main/agent/simulator.ts. Gated in the UI behind Advanced Mode (see
  // AgentRail.tsx), not just this flag, so a hand-crafted AgentGoal that
  // sets it without Advanced Mode still works — the gate is a UX affordance,
  // not a security boundary.
  generateAlternatives?: boolean
  // Phase 6: when the primary adapter's real model call fails (network
  // error, upstream error, bad response — see ModelCallFailure in
  // main/agent/simulator.ts), fall back to a local LM Studio call instead of
  // ending the run in error. Opt-in (unset/false = old behavior: any model
  // call failure ends the run). Never consulted when the primary adapter is
  // already 'simulator' or 'lm-studio' — there's nothing meaningfully
  // different to fall back to. Mirrored into AgentGoalSchema in
  // shared/validation.ts — zod silently strips unmirrored fields at the IPC
  // boundary, see that file's comment.
  lmStudioFallback?: boolean
  // Phase 8 §7.1: Generator's writer-facing control set, folded into the
  // prompt fed to a real model call (see runGenerator() in
  // main/agent/simulator.ts) as a rendered "Style guidance" block. Every
  // field is optional — an unset control simply isn't mentioned in the
  // prompt, preserving today's behavior when the writer hasn't touched
  // Advanced Mode's control-set UI (see AgentRail.tsx).
  generatorControls?: GeneratorControls
  // Phase 8 §7.3: Line-Editor's writer-facing control set — editing
  // intensity, house style rules, and AI-sounding-prose flagging — folded
  // into its real model call's prompt the same way generatorControls is.
  lineEditorControls?: LineEditorControls
  // Phase 8: set by refineSuggestion() (renderer/src/state/store.ts) when
  // this goal is a scoped re-run of a prior suggestion rather than a fresh
  // invocation. Each run<Role>() method's real-output branch threads this
  // straight into the resulting SuggestionRef's
  // provenance.refinesSuggestionId — the goal itself has no other use for
  // it (userIntent already carries the refine instruction, scope.selectionText
  // already carries the prior suggestion's own output text).
  refinesSuggestionId?: string
  // Round 12: opt-in real web research for World-Builder via a Brave Search
  // MCP connection (main/mcp/braveSearchAdapter.ts). Only consulted when
  // agentRole === 'World-Builder' and the selected model is a real (non-
  // simulator) adapter — see runWorldBuilder() in main/agent/simulator.ts.
  // Gated in the UI behind Advanced Mode (see AgentRail.tsx), same as every
  // other opt-in flag above; unset/false preserves prior behavior byte-for-
  // byte (no research attempted). Mirrored into AgentGoalSchema in
  // shared/validation.ts.
  webResearchEnabled?: boolean
}

export interface GeneratorControls {
  tone?: string
  pacing?: 'slow' | 'moderate' | 'fast'
  povDepth?: 'distant' | 'close' | 'deep'
  dialogueDensity?: 'sparse' | 'balanced' | 'dialogue-heavy'
  exposition?: 'minimal' | 'moderate' | 'detailed'
  heatLevel?: 'closed-door' | 'suggestive' | 'explicit'
  literaryStyle?: string
  // Spec §7.1 "style imitation from prose samples" — an excerpt of the
  // writer's own prose the model should match the voice of, folded into the
  // prompt as "Match the voice of this sample: ...". Distinct from
  // literaryStyle (a named style, e.g. "literary," "commercial thriller"),
  // which describes a style rather than demonstrating one.
  styleSampleText?: string
}

export interface LineEditorControls {
  intensity: 'light' | 'standard' | 'heavy' | 'custom'
  houseStyleRules?: string[]
  flagAiSoundingProse?: boolean
}

// Payload shape for a `kind: 'tracked-change'` SuggestionRef (Line Editor).
// Previously only ever inline-typed as `{category, before, after}` at each
// call site (simulator.ts's trackedChange() helper) — pulled out here so the
// new real-model-output path (runLineEditor's `isReal` branch, Phase 6) can
// share the same shape instead of re-declaring it ad hoc.
export interface TrackedChangePayload {
  category: string
  before: string
  after: string
}

export interface AgentError {
  code: string
  message: string
  recoverable: boolean
}

export interface ToolCall {
  toolId: string
  input: unknown
  output?: unknown
  error?: AgentError
}

export interface SkillInvocation {
  skillId: string
  input: unknown
  output?: unknown
}

export type PermissionDecision = 'approved-once' | 'approved-session' | 'denied' | 'pending'

export interface PermissionRequest {
  requestId: string
  capabilityId: string
  actionType: string
  dataScope: string
  destination?: string
  decision: PermissionDecision
}

// spec §9 Context Inspection — one class of material a context-assembly pass
// (main/agent/context/assemble.ts, Phase 7) considered including in a model
// call's contextText. `included: false` entries are the "excluded but
// potentially relevant items" the spec calls for, with `excludedReason`
// explaining why (over budget, no match, spoiler-filtered, etc.).
export type ContextSectionClass =
  | 'chapter-summary'
  | 'scene-outline'
  | 'codex-entry'
  | 'voice-profile'
  | 'locked-world-rule'
  | 'recent-excerpt'
  | 'full-text'
  // Round 12: real Brave Search MCP results, opt-in via
  // AgentGoal.webResearchEnabled, folded in by main/agent/context/assemble.ts
  // as the highest-priority section when present — see assembleContext's
  // `webResearch` param.
  | 'web-research'

export interface ContextSection {
  class: ContextSectionClass
  label: string
  included: boolean
  tokensEstimate: number
  excludedReason?: string
}

export interface ModelCallSummary {
  modelRef: ModelRef
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number
  // The model's actual completion text. Absent for SimulatorAdapter (there
  // is no real text to report); present for real adapters (openRouterAdapter
  // / lmStudioAdapter, Phase 6). No zod mirror in shared/validation.ts —
  // ModelCallSummary is never validated at an IPC write boundary.
  outputText?: string
  // Phase 7: what main/agent/context/assemble.ts actually packed into this
  // call's contextText, for real Context Inspection display. Absent for
  // pre-Phase-7 run records and for any call site not yet migrated onto
  // assembleContext() — ContextInspectionPanel must handle its absence.
  assembledContext?: {
    sections: ContextSection[]
    tokenBudget: number
    usedTokens: number
  }
}

export interface Citation {
  sourceUrl?: string
  note: string
  // 'author-stated': pre-existing World Builder interview citations (see
  // worldBuilderCitation() in main/agent/simulator.ts) — was already
  // produced before this union included it, a real pre-existing mirror gap.
  // 'researched': Round 12 — a citation backed by a real Brave Search MCP
  // result (see main/mcp/braveSearchAdapter.ts), distinct from 'high' since
  // it marks genuine external verification rather than a model's own
  // confidence in an unverified claim.
  reliability?: 'low' | 'medium' | 'high' | 'author-stated' | 'researched'
}

// Payload shape for `kind: 'editorial-finding'` suggestions (Story Editor /
// Dev-Editor). Previously only inline-typed at the point of use
// (simulator.ts's simulateStructuralFindings, EditorialFindingCard.tsx's
// render cast) — pulled out here so both sides share one definition.
// `craftConceptIds` is optional and references `CRAFT_CONCEPTS` in
// renderer/src/lib/craftReference.ts (spec Phase 4 ~line 847: findings should
// link to concise in-app craft explainers, not become a writing course).
export interface EditorialFindingPayload {
  title: string
  body: string
  severity: string
  craftConceptIds?: string[]
  // Phase 8 §7.2: which detection category a real Dev-Editor model call
  // classified this finding under (continuity/pacing/pov/stakes/hooks/
  // setup-payoff/other) — absent for the pre-Phase-8 template-simulated
  // finding, which never categorized itself this way.
  issueCategory?: string
  // Phase 8 §7.2: a concrete suggested next step for addressing the
  // finding, distinct from `body` (which describes the issue) — only
  // populated by a real Dev-Editor model call, not the template fallback.
  revisionPlan?: string
}

// Payload shape for `kind: 'metadata-proposal'` suggestions. Spec Phase 4
// (~line 183): agents may propose scene metadata based on the current draft,
// but the writer must approve changes — this is the "proposal" the writer
// reviews via MetadataProposalCard.tsx before it's ever written to disk.
export interface MetadataProposalPayload {
  proposedMeta: Partial<SceneMeta>
  rationale: string
}

// Payload shape for a `kind: 'insertion'` SuggestionRef (Generator). Plain
// suggestions omit draftGroupId; the opt-in "Generate Alternatives" mode
// (see AgentGoal.generateAlternatives) tags every draft it produces in one
// run with the same draftGroupId so the UI can recognize and render them as
// a comparable set (DraftComparisonView.tsx) instead of N unrelated cards.
export interface InsertionPayload {
  text: string
  draftGroupId?: string
  draftLabel?: string
}

// Spec §7.4: "suggest alternate dialogue options at different tension
// levels." Payload shape for a `kind: 'dialogue-alternative'` SuggestionRef
// (Dialoguer). tier is only meaningful when the alternative was generated
// from a character's Codex voice profile — see buildTensionAlternatives()
// in main/agent/simulator.ts.
export type DialogueTensionTier = 'calm' | 'guarded' | 'confrontational'

export interface DialogueAlternativeOption {
  tier: DialogueTensionTier
  text: string
}

export interface DialogueAlternativePayload {
  characterName?: string
  original: string
  alternatives: DialogueAlternativeOption[]
}

// Payload shape for a `kind: 'capability-recommendation'` SuggestionRef.
// Spec Phase 4 ("Capability recommendations based on repeated real writing
// workflows"): when the same tool has been invoked across `occurrences`
// separate completed agent runs (see detectRepeatedToolPattern() in
// main/agent/simulator.ts), the writer is offered a draft capability they
// can approve into a real installed one via CapabilityRecommendationCard.tsx
// — accepting calls the existing `capabilities:create` IPC directly with
// `draftManifest`, the same contract Library.tsx's "New Capability" form
// already uses.
export interface CapabilityRecommendationPayload {
  toolId: string
  occurrences: number
  runIds: string[]
  rationale: string
  draftManifest: CapabilityManifest
}

export interface SuggestionRef {
  id: string
  agentRole: AgentRole
  kind:
    | 'insertion'
    | 'tracked-change'
    | 'editorial-finding'
    | 'dialogue-alternative'
    | 'metadata-proposal'
    | 'codex-addition'
    | 'capability-recommendation'
  targetSceneId?: string
  targetCodexEntryId?: string
  payload: unknown
  // Phase 8: `refinesSuggestionId` links a suggestion produced by a
  // refineSuggestion() re-run (see renderer/src/state/store.ts) back to the
  // original suggestion it was refining, so the UI can show refinement
  // lineage instead of an unexplained new card appearing.
  provenance: { capabilityId?: string; capabilityVersion?: string; runId: string; refinesSuggestionId?: string }
  // 'fixed' is Story-Editor-specific (spec §7.2's 5 issue statuses: Open,
  // Accepted, Rejected, In progress, Fixed — 'refining' already covers "In
  // progress"). Only EditorialFindingCard.tsx offers a UI path to it; other
  // suggestion kinds never produce it.
  state: 'pending' | 'accepted' | 'rejected' | 'refining' | 'fixed'
  refineInstruction?: string
}

export interface AgentResult {
  summary: string
  proposedManuscriptChanges?: SuggestionRef[]
  proposedCodexChanges?: SuggestionRef[]
  citations?: Citation[]
  warnings?: string[]
  nextSteps?: string[]
}

export type AgentStepKind = 'plan' | 'tool-call' | 'skill-invoke' | 'permission-request' | 'model-call' | 'result'

export interface AgentStep {
  stepIndex: number
  kind: AgentStepKind
  timestamp: string
  detail: ToolCall | SkillInvocation | PermissionRequest | ModelCallSummary | AgentResult
}

export type AgentRunStatus = 'running' | 'paused' | 'completed' | 'cancelled' | 'error'

export interface AgentRunRecord {
  schemaVersion: 1
  goal: AgentGoal
  steps: AgentStep[]
  status: AgentRunStatus
  startedAt: string
  endedAt?: string
}
