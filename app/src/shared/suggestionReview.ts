// Pure, dependency-free helpers for the keyboard-first suggestion review UI
// (ManuscriptWorkspace.tsx) — spec §"Phase 4: Drafting and Revision Tools":
// J/K next/previous, A/R accept/reject, and batch acceptance by issue
// category. Kept dependency-free (no React) so this logic is trivially
// unit-testable without mounting a component, matching the house pattern in
// shared/codexLogic.ts.
import type { SuggestionRef } from './schema/agent'

// Fixed top-to-bottom order matching how ManuscriptWorkspace groups
// suggestion cards into "Comments & Tracked Changes" sections. Used both for
// keyboard J/K traversal order and for the batch-accept-by-category
// control's section order. Every kind that ManuscriptWorkspace renders a card
// for must appear here, or J/K/A/R review silently skips it — 'metadata-
// proposal' (MetadataProposalCard) and 'capability-recommendation'
// (CapabilityRecommendationCard) were added in later Phase 4 work and belong
// last, matching their render order after Codex Additions.
const KIND_ORDER: SuggestionRef['kind'][] = [
  'editorial-finding',
  'tracked-change',
  'insertion',
  'dialogue-alternative',
  'codex-addition',
  'metadata-proposal',
  'capability-recommendation'
]

export interface SuggestionKindGroup {
  kind: SuggestionRef['kind']
  items: SuggestionRef[]
}

// Groups suggestions by kind in the app's canonical display order, omitting
// empty groups so callers (e.g. a "batch accept" section header) don't have
// to filter separately.
export function groupSuggestionsByKind(suggestions: SuggestionRef[]): SuggestionKindGroup[] {
  const groups: SuggestionKindGroup[] = []
  for (const kind of KIND_ORDER) {
    const items = suggestions.filter((s) => s.kind === kind)
    if (items.length > 0) groups.push({ kind, items })
  }
  return groups
}

// Orders suggestions to match the visual top-to-bottom order of
// ManuscriptWorkspace's grouped sections, for J/K keyboard traversal.
export function orderSuggestionsForReview(suggestions: SuggestionRef[]): SuggestionRef[] {
  return groupSuggestionsByKind(suggestions).flatMap((g) => g.items)
}

// Suggestions that a J/K + A/R review pass can still act on. Rejected and
// (Story-Editor-only) fixed suggestions are terminal; accepted suggestions
// already applied their effect, so re-accepting is a no-op the UI shouldn't
// offer via the accept-all shortcut.
export function isReviewable(suggestion: SuggestionRef): boolean {
  return suggestion.state === 'pending' || suggestion.state === 'refining'
}

// Index-wrapping helpers for J (next) / K (previous) traversal. `current`
// of -1 (or out of range) means "nothing focused yet" — J starts at the
// first item, K starts at the last, matching common review-queue UX (e.g.
// Gmail's j/k).
export function nextReviewIndex(current: number, length: number): number {
  if (length <= 0) return -1
  if (current < 0 || current >= length) return 0
  return (current + 1) % length
}

export function prevReviewIndex(current: number, length: number): number {
  if (length <= 0) return -1
  if (current < 0 || current >= length) return length - 1
  return (current - 1 + length) % length
}
