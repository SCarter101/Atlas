// Dependency-free prompt builders for the rolling/derived summary generators
// (main/persistence/summaryStore.ts, main/persistence/derivedSummaryStore.ts).
// Same house style as shared/codexLogic.ts / shared/diffText.ts: no imports
// beyond other shared/ types, so it type-checks and is importable from both
// main (the only real caller today) and the renderer, should a future round
// want to preview a prompt client-side.
//
// Each builder returns only {systemPrompt, userIntent} — the ModelCallInput
// shape's third field, `contextText`, is deliberately NOT produced here.
// Assembling contextText means walking the manuscript tree / Codex / scene
// metadata, which needs node:fs-backed persistence reads these pure
// functions must not depend on; the callers in main/persistence/*Store.ts
// gather that data and pass it straight through to the adapter.

export interface SummaryPromptPair {
  systemPrompt: string
  userIntent: string
}

const COMMON_SYSTEM_PREFIX =
  'You are a concise, factual summarization assistant helping a novelist keep track of their own manuscript. ' +
  'Only summarize what is actually present in the supplied text — never invent details, characters, or events that ' +
  "aren't there. Do not add praise, commentary, or writing advice. Write plain prose, no headings or bullet points."

export function buildSceneSummaryPrompt(): SummaryPromptPair {
  return {
    systemPrompt: `${COMMON_SYSTEM_PREFIX} You are summarizing a single manuscript scene.`,
    userIntent:
      'Summarize the following scene in 2-3 sentences: what happens, who is present, and any turning point or ' +
      'revelation. This summary will be reused as rolling context for other tools, so keep it tight and concrete.'
  }
}

export function buildChapterSummaryPrompt(): SummaryPromptPair {
  return {
    systemPrompt: `${COMMON_SYSTEM_PREFIX} You are summarizing a full manuscript chapter from its scene-by-scene summaries.`,
    userIntent:
      'Summarize the following chapter in 3-4 sentences, covering its overall arc across the scenes listed and any ' +
      'notable turning point. Do not simply restate each scene summary in a list — synthesize them into one narrative.'
  }
}

export function buildCharacterArcSummaryPrompt(characterName: string): SummaryPromptPair {
  return {
    systemPrompt: `${COMMON_SYSTEM_PREFIX} You are summarizing one character's arc across the manuscript so far.`,
    userIntent:
      `Based on the manuscript appearances and story-craft notes below, summarize ${characterName}'s arc so far in ` +
      '3-5 sentences: how they change, what they want, and any turning points reached. If little or no material is ' +
      'given, say plainly that the arc is not established yet rather than guessing.'
  }
}

export function buildTimelineSummaryPrompt(): SummaryPromptPair {
  return {
    systemPrompt: `${COMMON_SYSTEM_PREFIX} You are summarizing the story's chronological timeline.`,
    userIntent:
      'Based on the Codex timeline/event entries and scene timeline placements below, write a short chronological ' +
      "summary of the story's timeline so far, in the order things actually happen in-world (not manuscript reading " +
      'order, when the two differ). Note any ambiguous or conflicting placements briefly.'
  }
}

export function buildWorldStateSummaryPrompt(): SummaryPromptPair {
  return {
    systemPrompt: `${COMMON_SYSTEM_PREFIX} You are summarizing the current state of the story's world/setting.`,
    userIntent:
      'Based on the Codex locations, factions, world rules, and objects below, summarize the current state of the ' +
      'world in 3-5 sentences: key places, factions and their standing, and any world rules a writer should keep ' +
      'in mind while drafting.'
  }
}

export function buildOpenPromisesSummaryPrompt(): SummaryPromptPair {
  return {
    systemPrompt: `${COMMON_SYSTEM_PREFIX} You are tracking narrative setups that have not yet paid off (open promises/Chekhov's guns).`,
    userIntent:
      'Based on the plot-thread setup/payoff data below, summarize which narrative threads are still open — set up ' +
      'but not yet paid off — in a few sentences. If everything tracked has been paid off, say so plainly.'
  }
}

export function buildPayoffStatusSummaryPrompt(): SummaryPromptPair {
  return {
    systemPrompt: `${COMMON_SYSTEM_PREFIX} You are reporting on the resolution status of tracked plot threads.`,
    userIntent:
      'Based on the plot-thread setup/payoff data below, report which threads are fully resolved (both set up and ' +
      'paid off), which are still pending, and which have no scenes linked yet. Keep it to a few sentences.'
  }
}
