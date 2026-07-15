// Runtime validation for data that crosses the IPC boundary as a *write*
// input — i.e. renderer -> main payloads that end up persisted to disk.
//
// Per "Atlas Architecture and Data Contracts.md" §5: "main never trusts the
// renderer's input". These zod schemas are the runtime enforcement of that
// rule. They are deliberately structural mirrors of the hand-written TS
// interfaces in src/shared/schema/*.ts and src/shared/ipc.ts — no additional
// business-rule constraints (length limits, extra requiredness, etc.) beyond
// what those types already say. The `z.infer<>` checks below cross-check
// each schema against its source-of-truth interface at compile time.
import { z } from 'zod'
import type { AgentGoal, GeneratorControls, LineEditorControls, ModelRef } from './schema/agent'
import type { CapabilityManifest, JsonSchema } from './schema/capability'
import type {
  CharacterVoiceProfile,
  CodexEntry,
  CodexEntryType,
  CodexVersion,
  CodexRelationship,
  FactStatus,
  ManuscriptLink
} from './schema/codex'
import type { ProjectManifest } from './schema/project'
import type { SessionGoal } from './schema/session'
import type { SceneWritePatch } from './ipc'

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

export const CodexEntryTypeSchema = z.enum([
  'character',
  'location',
  'faction',
  'object',
  'event',
  'world-rule',
  'timeline-item',
  'plot-thread',
  'relationship',
  'theme',
  'motif',
  'research-note',
  'historical-reference',
  'scene-note',
  'private-author-note'
])

export const FactStatusSchema = z.enum(['canon', 'tentative', 'deprecated', 'contradicted'])

export const CodexRelationshipSchema = z.object({
  id: z.string(),
  targetEntryId: z.string(),
  kind: z.string(),
  notes: z.string().optional()
})

export const ManuscriptLinkSchema = z.object({
  sceneId: z.string(),
  excerpt: z.string().optional()
})

export const CodexVersionSchema = z.object({
  versionId: z.string(),
  changedAt: z.string(),
  changedBy: z.string(),
  diffSummary: z.string(),
  snapshot: z.record(z.unknown())
})

// Spec §7.4 voice-profile fields — see CharacterVoiceProfile in
// schema/codex.ts. Only relevant when CodexEntry.type === 'character', but
// validated unconditionally here like the rest of CodexEntry's optional
// fields (the schema doesn't branch on `type`).
export const CharacterVoiceProfileSchema = z.object({
  vocabulary: z.string().optional(),
  rhythm: z.string().optional(),
  educationLevel: z.string().optional(),
  humorStyle: z.string().optional(),
  emotionalGuardedness: z.string().optional(),
  accentOrDialect: z.string().optional(),
  verbalTics: z.array(z.string()).optional(),
  tabooTopics: z.array(z.string()).optional(),
  speechDirectness: z.enum(['indirect', 'balanced', 'direct']).optional(),
  formalityLevel: z.enum(['casual', 'neutral', 'formal']).optional(),
  favoritePhrases: z.array(z.string()).optional(),
  avoidedPhrases: z.array(z.string()).optional(),
  powerDynamics: z.string().optional()
})

export const CodexEntrySchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  type: CodexEntryTypeSchema,
  name: z.string(),
  status: FactStatusSchema,
  body: z.record(z.unknown()),
  isPrivate: z.boolean(),
  localModelOnly: z.boolean(),
  locked: z.boolean(),
  source: z.enum(['author', 'ai-proposed', 'ai-extracted']),
  approvedAt: z.string().optional(),
  relationships: z.array(CodexRelationshipSchema),
  manuscriptLinks: z.array(ManuscriptLinkSchema),
  spoilerRevealSceneId: z.string().optional(),
  voiceProfile: CharacterVoiceProfileSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  history: z.array(CodexVersionSchema)
})

// Compile-time cross-checks: if src/shared/schema/codex.ts drifts from these
// schemas, these assignments stop type-checking.
type _CodexEntryTypeCheck = z.infer<typeof CodexEntryTypeSchema> extends CodexEntryType ? true : never
type _FactStatusCheck = z.infer<typeof FactStatusSchema> extends FactStatus ? true : never
type _CodexRelationshipCheck = z.infer<typeof CodexRelationshipSchema> extends CodexRelationship ? true : never
type _ManuscriptLinkCheck = z.infer<typeof ManuscriptLinkSchema> extends ManuscriptLink ? true : never
type _CodexVersionCheck = z.infer<typeof CodexVersionSchema> extends CodexVersion ? true : never
type _CharacterVoiceProfileCheck = z.infer<typeof CharacterVoiceProfileSchema> extends CharacterVoiceProfile
  ? true
  : never
type _CodexEntryCheck = z.infer<typeof CodexEntrySchema> extends CodexEntry ? true : never
const _codexEntryTypeCheck: _CodexEntryTypeCheck = true
const _factStatusCheck: _FactStatusCheck = true
const _codexRelationshipCheck: _CodexRelationshipCheck = true
const _manuscriptLinkCheck: _ManuscriptLinkCheck = true
const _codexVersionCheck: _CodexVersionCheck = true
const _characterVoiceProfileCheck: _CharacterVoiceProfileCheck = true
const _codexEntryCheck: _CodexEntryCheck = true
void _codexEntryTypeCheck
void _factStatusCheck
void _codexRelationshipCheck
void _manuscriptLinkCheck
void _codexVersionCheck
void _characterVoiceProfileCheck
void _codexEntryCheck

// ---------------------------------------------------------------------------
// Scene write patch
// ---------------------------------------------------------------------------

const SceneCraftMetaSchema = z.object({
  characterDesire: z.string().optional(),
  externalGoal: z.string().optional(),
  internalConflict: z.string().optional(),
  opposition: z.string().optional(),
  stakes: z.string().optional(),
  turningPoint: z.string().optional(),
  outcome: z.string().optional(),
  emotionalShift: z.string().optional(),
  revealedInformation: z.string().optional(),
  conflictLevel: z.number().optional()
})

const SceneContinuityMetaSchema = z.object({
  timelinePlacement: z.string().optional(),
  continuityNotes: z.string().optional(),
  setupIds: z.array(z.string()).optional(),
  payoffIds: z.array(z.string()).optional(),
  foreshadowingNotes: z.string().optional(),
  themeIds: z.array(z.string()).optional(),
  motifIds: z.array(z.string()).optional(),
  relatedCodexIds: z.array(z.string()).optional()
})

const SceneStatusSchema = z.enum(['outline', 'drafting', 'drafted', 'revised', 'final'])

// All fields optional to mirror Partial<SceneMeta> in SceneWritePatch.
const SceneMetaPatchSchema = z.object({
  schemaVersion: z.literal(2).optional(),
  id: z.string().optional(),
  chapterId: z.string().optional(),
  order: z.number().optional(),
  title: z.string().optional(),
  povCharacterId: z.string().optional(),
  locationId: z.string().optional(),
  timeOrDate: z.string().optional(),
  purpose: z.string().optional(),
  presentCharacterIds: z.array(z.string()).optional(),
  localModelOnly: z.boolean().optional(),
  craft: SceneCraftMetaSchema.optional(),
  continuity: SceneContinuityMetaSchema.optional(),
  wordCount: z.number().optional(),
  status: SceneStatusSchema.optional(),
  updatedAt: z.string().optional()
})

export const SceneWritePatchSchema = z.object({
  meta: SceneMetaPatchSchema.optional(),
  prose: z.string().optional()
})

type _SceneWritePatchCheck = z.infer<typeof SceneWritePatchSchema> extends SceneWritePatch ? true : never
const _sceneWritePatchCheck: _SceneWritePatchCheck = true
void _sceneWritePatchCheck

// ---------------------------------------------------------------------------
// Agent goal
// ---------------------------------------------------------------------------

export const AgentRoleSchema = z.enum(['Generator', 'Dev-Editor', 'Line-Editor', 'Dialoguer', 'World-Builder'])

export const ModelProviderSchema = z.enum(['anthropic', 'openai', 'google', 'openrouter', 'lm-studio', 'simulator'])

export const ModelRefSchema = z.object({
  provider: ModelProviderSchema,
  modelId: z.string(),
  viaOpenRouter: z.boolean()
})

type _ModelRefCheck = z.infer<typeof ModelRefSchema> extends ModelRef ? true : never
const _modelRefCheck: _ModelRefCheck = true
void _modelRefCheck

// Phase 8 §7.1/§7.3 per-role control sets — mirrored here since AgentGoal
// (which embeds them) is validated at the agentRuns.start IPC boundary; see
// GeneratorControls/LineEditorControls in schema/agent.ts for field-by-field
// rationale.
export const GeneratorControlsSchema = z.object({
  tone: z.string().optional(),
  pacing: z.enum(['slow', 'moderate', 'fast']).optional(),
  povDepth: z.enum(['distant', 'close', 'deep']).optional(),
  dialogueDensity: z.enum(['sparse', 'balanced', 'dialogue-heavy']).optional(),
  exposition: z.enum(['minimal', 'moderate', 'detailed']).optional(),
  heatLevel: z.enum(['closed-door', 'suggestive', 'explicit']).optional(),
  literaryStyle: z.string().optional(),
  styleSampleText: z.string().optional()
})

type _GeneratorControlsCheck = z.infer<typeof GeneratorControlsSchema> extends GeneratorControls ? true : never
const _generatorControlsCheck: _GeneratorControlsCheck = true
void _generatorControlsCheck

export const LineEditorControlsSchema = z.object({
  intensity: z.enum(['light', 'standard', 'heavy', 'custom']),
  houseStyleRules: z.array(z.string()).optional(),
  flagAiSoundingProse: z.boolean().optional()
})

type _LineEditorControlsCheck = z.infer<typeof LineEditorControlsSchema> extends LineEditorControls ? true : never
const _lineEditorControlsCheck: _LineEditorControlsCheck = true
void _lineEditorControlsCheck

export const AgentGoalSchema = z.object({
  runId: z.string(),
  agentRole: AgentRoleSchema,
  modelRef: ModelRefSchema,
  userIntent: z.string(),
  scope: z.object({
    sceneIds: z.array(z.string()).optional(),
    selectionText: z.string().optional(),
    codexEntryIds: z.array(z.string()).optional()
  }),
  constraints: z.object({
    maxTurns: z.number(),
    maxTokens: z.number(),
    maxToolCalls: z.number(),
    maxElapsedMs: z.number(),
    maxCostUsd: z.number().optional(),
    allowedCapabilityCategories: z.array(z.string())
  }),
  generateAlternatives: z.boolean().optional(),
  lmStudioFallback: z.boolean().optional(),
  generatorControls: GeneratorControlsSchema.optional(),
  lineEditorControls: LineEditorControlsSchema.optional(),
  refinesSuggestionId: z.string().optional()
})

type _AgentGoalCheck = z.infer<typeof AgentGoalSchema> extends AgentGoal ? true : never
const _agentGoalCheck: _AgentGoalCheck = true
void _agentGoalCheck

// ---------------------------------------------------------------------------
// Capability manifest
// ---------------------------------------------------------------------------

// JsonSchema is a self-referential minimal JSON Schema surface (see
// schema/capability.ts) with an index signature for arbitrary extra keys —
// z.lazy() + catchall mirrors both.
export const JsonSchemaSchema: z.ZodType<JsonSchema> = z.lazy(() =>
  z
    .object({
      type: z.string().optional(),
      properties: z.record(JsonSchemaSchema).optional(),
      items: JsonSchemaSchema.optional(),
      required: z.array(z.string()).optional(),
      description: z.string().optional()
    })
    .catchall(z.unknown())
)

export const CapabilityTypeSchema = z.enum(['tool', 'skill'])
export const CapabilityScopeSchema = z.enum(['global', 'project'])
export const CapabilitySideEffectsSchema = z.enum(['none', 'reads-project', 'writes-project', 'network', 'filesystem-external'])
export const ValidationStatusSchema = z.enum(['untested', 'passed', 'failed'])
export const LifecycleStateSchema = z.enum(['draft', 'enabled', 'disabled', 'deprecated'])

// Self-referential: history[].snapshot is a full CapabilityManifest (see
// that field's doc comment in schema/capability.ts). z.lazy() + an explicit
// z.ZodType<CapabilityManifest> annotation is the same recursive-schema
// pattern JsonSchemaSchema above already uses for its own self-reference.
export const CapabilityManifestSchema: z.ZodType<CapabilityManifest> = z.lazy(() =>
  z.object({
    schemaVersion: z.literal(1),
    id: z.string(),
    name: z.string(),
    description: z.string(),
    type: CapabilityTypeSchema,
    scope: CapabilityScopeSchema,
    owner: z.string(),
    version: z.string(),
    inputSchema: JsonSchemaSchema,
    outputSchema: JsonSchemaSchema,
    requiredContext: z.array(z.string()),
    dependsOn: z.array(z.string()),
    compatibleAgentRoles: z.array(AgentRoleSchema),
    compatibleModelCapabilities: z.array(z.string()),
    sideEffects: CapabilitySideEffectsSchema,
    permissionCategory: z.string(),
    localOnly: z.boolean(),
    costCharacteristics: z.object({
      estTokens: z.number().optional(),
      estTimeMs: z.number().optional(),
      estCostUsd: z.number().optional()
    }),
    validationStatus: ValidationStatusSchema,
    lifecycleState: LifecycleStateSchema,
    createdBy: z.enum(['author', 'agent-generated']),
    history: z.array(
      z.object({
        versionId: z.string(),
        changedAt: z.string(),
        note: z.string(),
        snapshot: CapabilityManifestSchema.optional()
      })
    )
  })
)

type _CapabilityManifestCheck = z.infer<typeof CapabilityManifestSchema> extends CapabilityManifest ? true : never
const _capabilityManifestCheck: _CapabilityManifestCheck = true
void _capabilityManifestCheck

// ---------------------------------------------------------------------------
// Session goal
// ---------------------------------------------------------------------------

export const SessionGoalSchema = z.object({
  wordCount: z.number().optional(),
  minutes: z.number().optional()
})

type _SessionGoalCheck = z.infer<typeof SessionGoalSchema> extends SessionGoal ? true : never
const _sessionGoalCheck: _SessionGoalCheck = true
void _sessionGoalCheck

// ---------------------------------------------------------------------------
// Project manifest seed (Partial<ProjectManifest>)
// ---------------------------------------------------------------------------

export const ThemeSchema = z.enum(['paper', 'night', 'typewriter'])

// All fields optional to mirror Partial<ProjectManifest> used as the
// project:create seed.
export const ProjectManifestSeedSchema = z.object({
  schemaVersion: z.literal(1).optional(),
  id: z.string().optional(),
  title: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  genrePrimary: z.string().optional(),
  targetWordCount: z.number().optional(),
  books: z.array(z.string()).optional(),
  activeSceneId: z.string().optional(),
  advancedMode: z.boolean().optional(),
  theme: ThemeSchema.optional(),
  writerDisplayName: z.string().optional(),
  sessionGoal: SessionGoalSchema.optional()
})

type _ProjectManifestSeedCheck = z.infer<typeof ProjectManifestSeedSchema> extends Partial<ProjectManifest>
  ? true
  : never
const _projectManifestSeedCheck: _ProjectManifestSeedCheck = true
void _projectManifestSeedCheck

// ---------------------------------------------------------------------------
// Backup schedule (Round 10/Phase 9)
// ---------------------------------------------------------------------------

// Validates the payload for the backup:schedule-set IPC handler (see
// main/ipc/handlers.ts / shared/ipc.ts's BackupScheduleSet channel). Not
// folded into ProjectManifestSeedSchema above since project:create's seed
// never needs to set this at creation time — it's only ever written later
// via the dedicated backups.setSchedule bridge call.
export const BackupScheduleSchema = z.object({
  enabled: z.boolean(),
  intervalMinutes: z.number().positive()
})

type _BackupScheduleCheck = z.infer<typeof BackupScheduleSchema> extends NonNullable<ProjectManifest['backupSchedule']>
  ? true
  : never
const _backupScheduleCheck: _BackupScheduleCheck = true
void _backupScheduleCheck
