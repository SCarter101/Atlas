// Concise in-app craft explainers, per spec Phase 4 (~line 847): Story
// Editor findings should link to short reference material for concepts like
// hooks, scene turns, causality, etc. so a finding is clarified without the
// interface turning into a writing course — each explainer is deliberately
// one short paragraph, not a lesson. Pattern mirrors codexLabels.ts: a small,
// dependency-free lookup module a component can import directly.
export interface CraftConcept {
  id: string
  label: string
  explainer: string
}

export const CRAFT_CONCEPTS: Record<string, CraftConcept> = {
  hooks: {
    id: 'hooks',
    label: 'Hooks',
    explainer:
      'A hook is whatever makes a reader want the next sentence — a question raised, a threat implied, a detail that doesn\'t fit yet. It works by creating a small gap between what the reader knows and what they want to know, not by volume or shock value alone.'
  },
  'scene-turns': {
    id: 'scene-turns',
    label: 'Scene turns',
    explainer:
      'A scene turn is the moment a scene\'s value shifts — a character enters wanting one thing and leaves with the situation changed, for better or worse. Scenes without a turn tend to read as static or interchangeable, even if the prose itself is polished.'
  },
  causality: {
    id: 'causality',
    label: 'Causality',
    explainer:
      'Causality is the "therefore/but" chain that links events, as opposed to a flat "and then" sequence. Readers track story logically as much as chronologically, so each scene should follow from a consequence of the last rather than simply happening next.'
  },
  stakes: {
    id: 'stakes',
    label: 'Stakes',
    explainer:
      'Stakes are what the point-of-view character stands to gain or lose in a scene, and they are what make a reader keep reading rather than skim. Stakes don\'t have to be life-or-death — they have to matter to the character in a way the reader can feel.'
  },
  'setup-and-payoff': {
    id: 'setup-and-payoff',
    label: 'Setup and payoff',
    explainer:
      'A setup plants information, an object, or a promise early so that its later payoff feels earned rather than arbitrary. The gap between the two is what gives a payoff its charge — too little setup reads as a coincidence, too much telegraphs the payoff before it lands.'
  },
  'point-of-view': {
    id: 'point-of-view',
    label: 'Point of view',
    explainer:
      'Point of view is whose vantage the scene is filtered through, and consistency matters more than which mode is chosen. A scene that drifts into another character\'s knowledge or interiority without a clear break tends to disorient the reader even when each individual sentence reads fine.'
  },
  pacing: {
    id: 'pacing',
    label: 'Pacing',
    explainer:
      'Pacing is the felt speed of a scene, shaped by sentence length, scene length, and the ratio of action to reflection — not by how much time passes in-story. A scene can cover a single minute and still feel slow, or cover a decade and feel fast, depending on how it\'s rendered on the page.'
  }
}

export function getCraftConcept(id: string): CraftConcept | undefined {
  return CRAFT_CONCEPTS[id]
}
