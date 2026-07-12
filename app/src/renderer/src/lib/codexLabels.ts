import type { CodexEntryType } from '@shared/schema/codex'

// Extracted from routes/CodexView.tsx so components/CodexEntryForm.tsx can
// import it without a circular dependency (CodexView -> CodexEntryForm ->
// CodexView caused a TDZ crash: "Cannot access 'TYPE_LABEL' before
// initialization").
export const TYPE_LABEL: Record<CodexEntryType, string> = {
  character: 'Character',
  location: 'Location',
  faction: 'Faction',
  object: 'Object',
  event: 'Event',
  'world-rule': 'World Rule',
  'timeline-item': 'Timeline',
  relationship: 'Relationship',
  theme: 'Theme',
  motif: 'Motif',
  'research-note': 'Research Note',
  'historical-reference': 'Historical Reference',
  'scene-note': 'Scene Note',
  'private-author-note': 'Private Note'
}
