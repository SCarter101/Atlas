// World Builder interview: shared, dependency-free types + encode/decode
// helpers for the multi-step interview wizard (spec §7.5). Kept free of
// node:*/electron imports — same "renderer can import it directly" pattern
// as shared/codexLogic.ts — because both the renderer wizard
// (components/WorldBuilderInterview.tsx, components/AgentRail.tsx) and the
// main-process simulator (main/agent/simulator.ts) need the exact same
// shape and marker string.
//
// The interview itself is ephemeral (ADR in the Phase 4 brief: "no new
// persisted interview entity"). Its only lasting output is the Codex entries
// it proposes, which flow through the existing SuggestionRef/CodexAdditionCard
// approval contract. To get the compiled answers from the renderer to the
// main-process World-Builder run without widening AgentGoal's schema
// (shared/schema/agent.ts + its zod mirror in shared/validation.ts), the
// answers are serialized into AgentGoal.scope.selectionText behind a marker
// prefix that a plain manuscript-selection string could never legitimately
// start with.

export type WorldBuilderGenreTemplateId =
  | 'fantasy-kingdom'
  | 'sci-fi-colony'
  | 'space-opera-setting'
  | 'crime-city'
  | 'thriller-environment'
  | 'historical-setting'
  | 'contemporary-town'
  | 'custom'

export interface WorldBuilderGenreTemplate {
  id: WorldBuilderGenreTemplateId
  label: string
  blurb: string
}

// Spec §7.5's explicit template list, in order, "custom" last as the escape
// hatch.
export const WORLD_BUILDER_GENRE_TEMPLATES: WorldBuilderGenreTemplate[] = [
  { id: 'fantasy-kingdom', label: 'Fantasy kingdom', blurb: 'Thrones, magic systems, and old feuds.' },
  { id: 'sci-fi-colony', label: 'Sci-fi colony', blurb: 'A settlement scraping by on the edge of survival.' },
  { id: 'space-opera-setting', label: 'Space opera setting', blurb: 'Empires, factions, and starlanes spanning worlds.' },
  { id: 'crime-city', label: 'Crime city', blurb: 'A city run as much by its underworld as its law.' },
  { id: 'thriller-environment', label: 'Suspense / thriller environment', blurb: 'A world engineered to keep pressure on every page.' },
  { id: 'historical-setting', label: 'Historical setting', blurb: 'A real (or real-feeling) period grounded in research.' },
  { id: 'contemporary-town', label: 'Contemporary town', blurb: 'A recognizable, present-day place.' },
  { id: 'custom', label: 'Custom', blurb: 'Describe your world in your own terms — no template.' }
]

export function genreTemplateLabel(id: WorldBuilderGenreTemplateId): string {
  return WORLD_BUILDER_GENRE_TEMPLATES.find((t) => t.id === id)?.label ?? 'World'
}

// The six minimum interview topics spec §7.5 requires. `key` maps 1:1 onto
// WorldBuilderInterviewAnswers below so the wizard can iterate this array to
// render steps instead of hand-writing six near-identical step components.
export const WORLD_BUILDER_INTERVIEW_TOPICS: Array<{
  key: keyof Omit<WorldBuilderInterviewAnswers, 'genreTemplate'>
  question: string
  placeholder: string
}> = [
  {
    key: 'worldGrounding',
    question: 'What kind of world grounds this story?',
    placeholder: 'e.g. a coastal trade kingdom fracturing under a succession crisis…'
  },
  {
    key: 'sensoryDetail',
    question: 'What does the environment look, sound, smell, taste, and feel like?',
    placeholder: 'Salt air, market noise, the particular grey of harbor fog at dawn…'
  },
  {
    key: 'characterImpact',
    question: 'How does this world affect your characters?',
    placeholder: 'Who does it favor? Who does it grind down? What does it cost to live here?'
  },
  {
    key: 'plotPressure',
    question: 'What pressures does this world place on the plot?',
    placeholder: 'Deadlines, scarcity, law, custom, geography — what forces events forward?'
  },
  {
    key: 'consistencyFacts',
    question: 'What facts must remain consistent throughout the story?',
    placeholder: 'Names, dates, physical laws, political boundaries that can never contradict themselves…'
  },
  {
    key: 'flexibleRules',
    question: 'What world rules are flexible, tentative, or locked?',
    placeholder: 'What can still change as you draft? What is already locked canon?'
  }
]

export interface WorldBuilderInterviewAnswers {
  genreTemplate: WorldBuilderGenreTemplateId
  worldGrounding: string
  sensoryDetail: string
  characterImpact: string
  plotPressure: string
  consistencyFacts: string
  flexibleRules: string
}

export function emptyWorldBuilderInterviewAnswers(): WorldBuilderInterviewAnswers {
  return {
    genreTemplate: 'custom',
    worldGrounding: '',
    sensoryDetail: '',
    characterImpact: '',
    plotPressure: '',
    consistencyFacts: '',
    flexibleRules: ''
  }
}

// A plain manuscript selection can never start with this — it is not
// printable prose a writer would select — so decode() can tell the two
// apart unambiguously without a separate "kind" field on AgentGoal.
const INTERVIEW_MARKER = '@@atlas-world-builder-interview-v1@@'

export function encodeWorldBuilderInterview(answers: WorldBuilderInterviewAnswers): string {
  return `${INTERVIEW_MARKER}${JSON.stringify(answers)}`
}

function isValidGenreTemplateId(value: unknown): value is WorldBuilderGenreTemplateId {
  return typeof value === 'string' && WORLD_BUILDER_GENRE_TEMPLATES.some((t) => t.id === value)
}

// Returns null (rather than throwing) for anything that isn't a
// well-formed, marker-prefixed interview payload, so callers can treat a
// plain text selection and a malformed/foreign payload the same way: "not
// an interview, fall back to the regular single-selection flow."
export function decodeWorldBuilderInterview(selectionText: string): WorldBuilderInterviewAnswers | null {
  if (!selectionText.startsWith(INTERVIEW_MARKER)) return null

  try {
    const parsed = JSON.parse(selectionText.slice(INTERVIEW_MARKER.length)) as Partial<WorldBuilderInterviewAnswers>
    if (!parsed || typeof parsed !== 'object') return null
    if (!isValidGenreTemplateId(parsed.genreTemplate)) return null

    const stringFields: Array<keyof Omit<WorldBuilderInterviewAnswers, 'genreTemplate'>> = [
      'worldGrounding',
      'sensoryDetail',
      'characterImpact',
      'plotPressure',
      'consistencyFacts',
      'flexibleRules'
    ]
    for (const field of stringFields) {
      if (typeof parsed[field] !== 'string') return null
    }

    return parsed as WorldBuilderInterviewAnswers
  } catch {
    return null
  }
}
