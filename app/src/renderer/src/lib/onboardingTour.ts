// Pure step data + step-sequencing helpers for the product-tour overlay
// (components/ProductTour.tsx). Kept dependency-free (no React, no
// localStorage) so the sequencing logic is trivially unit-testable without
// mounting a component — matching the house pattern in
// shared/suggestionReview.ts.
//
// Copy here is written to match the app's real Round 6-9 state, not
// prototype-era placeholder text: the Agent Rail step is explicit that real
// model calls require a configured OpenRouter/LM Studio connection in
// Settings, and that Atlas otherwise falls back to its built-in simulator —
// this is the same "honest placeholder" framing CLAUDE.md documents for
// every other still-partially-simulated surface in the app. Nothing here
// claims capabilities (e.g. real web research) that the app doesn't have.
export interface TourStep {
  id: string
  title: string
  body: string
  // Route to navigate to when this step becomes active. Omitted when a step
  // doesn't need to change the screen (e.g. two steps in a row both
  // describing different parts of the Manuscript workspace).
  route?: string
  // CSS selector for a highlight box drawn around an existing, already-
  // stable element — never a selector this tour invents inside a sibling
  // track's file. NavLink `to` values in AppShell.tsx render as real <a
  // href> attributes, so `a[href="/x"]` is safe to depend on without
  // touching any other component.
  highlightSelector?: string
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'start',
    title: 'Welcome to Atlas',
    body: 'Atlas is a writing companion for the long haul of a novel: draft, revise, track continuity, and export, all from one desk. This short tour points out where things live. Skip anytime, and replay it later from Help.'
  },
  {
    id: 'foundations',
    title: 'Starting a project',
    body: 'Every project begins on the Landing screen. Open the sample project to explore a finished draft, or start a new one, new projects walk through a Story Foundations interview that seeds your Codex with characters, locations, and world rules before you write a word.'
  },
  {
    id: 'manuscript',
    title: 'The manuscript editor',
    body: 'This is where you draft. Chapters and scenes sit in the left outline, the editor autosaves as you type, and the status bar tracks word count and an estimated token cost for the current scene.',
    route: '/manuscript',
    highlightSelector: 'a[href="/manuscript"]'
  },
  {
    id: 'agent-rail',
    title: 'The Agent Rail',
    body: "On the right, five specialized agents, Generator, Story Editor, Line Editor, Dialogue Editor, and World Builder, read your manuscript and Codex before responding. Connect OpenRouter or LM Studio in Settings for real model calls; without one configured, Atlas falls back to a built-in simulator so you can still try the workflow.",
    route: '/manuscript'
  },
  {
    id: 'review',
    title: 'Reviewing suggestions',
    body: 'Suggestions show up as cards below the editor. Press J or K to move between them, A to accept or R to reject the focused one, or use a section\'s "Accept all" button. Not happy with a result? Every card has a Refine box that sends your follow-up instruction back to the same agent.',
    route: '/manuscript'
  },
  {
    id: 'codex',
    title: 'Codex — your story bible',
    body: 'Characters, locations, and world rules live here, with version history and contradiction warnings when two entries disagree. A spoiler-aware view lets you see the Codex as it stood at any earlier scene, so you never read ahead of yourself.',
    route: '/codex',
    highlightSelector: 'a[href="/codex"]'
  },
  {
    id: 'export',
    title: "Export when you're ready",
    body: "Export the manuscript as Markdown, plain text, PDF, DOCX, or EPUB, and the Codex as a shareable series bible. That's the tour, press Esc or Done to close it, and find it again anytime from Help.",
    route: '/export',
    highlightSelector: 'a[href="/export"]'
  }
]

export function isFirstTourStep(current: number): boolean {
  return current <= 0
}

export function isLastTourStep(current: number, length: number): boolean {
  return length <= 0 || current >= length - 1
}

// Next/previous do NOT wrap (unlike suggestionReview's J/K traversal) —
// a linear tour shouldn't loop from the last step back to the first, since
// "Next" on the final step is meant to end the tour instead.
export function nextTourStepIndex(current: number, length: number): number {
  if (length <= 0) return 0
  return Math.min(current + 1, length - 1)
}

export function prevTourStepIndex(current: number, length: number): number {
  if (length <= 0) return 0
  return Math.max(current - 1, 0)
}

export function clampTourStepIndex(index: number, length: number): number {
  if (length <= 0) return 0
  if (index < 0) return 0
  if (index >= length) return length - 1
  return index
}
