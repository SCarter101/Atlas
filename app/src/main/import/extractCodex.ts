import type { CodexCandidate } from '@shared/schema/import'

interface CandidateStats {
  name: string
  count: number
  dialogueHits: number
  locationHits: number
}

const STOPWORDS = new Set([
  'A',
  'After',
  'All',
  'And',
  'As',
  'At',
  'Before',
  'But',
  'Chapter',
  'For',
  'From',
  'He',
  'Her',
  'His',
  'I',
  'If',
  'In',
  'It',
  'No',
  'On',
  'Part',
  'She',
  'So',
  'The',
  'Then',
  'They',
  'This',
  'To',
  'We',
  'When',
  'With',
  'You'
])

// Approximate placeholder extraction, not NLP. It ranks repeated capitalized
// names and recurring prepositional proper nouns, then asks the writer to
// approve before anything becomes canonical Codex data.
export function extractCodexCandidates(text: string): CodexCandidate[] {
  const stats = new Map<string, CandidateStats>()
  const properNouns = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g) ?? []

  for (const name of properNouns) {
    if (shouldSkipName(name)) continue
    bump(stats, name, 'count')
  }

  for (const match of text.matchAll(/\b(?:said|asked|replied|whispered|shouted)\s+([A-Z][a-z]+)\b/g)) {
    if (!shouldSkipName(match[1])) bump(stats, match[1], 'dialogueHits')
  }

  for (const match of text.matchAll(/\b([A-Z][a-z]+)\s+(?:said|asked|replied|whispered|shouted)\b/g)) {
    if (!shouldSkipName(match[1])) bump(stats, match[1], 'dialogueHits')
  }

  for (const match of text.matchAll(/\b(?:in|at|to|from|toward|near)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g)) {
    if (!shouldSkipName(match[1])) bump(stats, match[1], 'locationHits')
  }

  const characterCandidates = [...stats.values()]
    .filter((candidate) => candidate.count >= 3 || candidate.dialogueHits > 0)
    .sort((a, b) => b.count + b.dialogueHits * 2 - (a.count + a.dialogueHits * 2))
    .slice(0, 8)
    .map<CodexCandidate>((candidate) => ({
      type: 'character',
      name: candidate.name,
      summary: `Mentioned ${candidate.count} times${candidate.dialogueHits > 0 ? '; appears near dialogue' : ''}`,
      confidence: candidate.count >= 3 && candidate.dialogueHits > 0 ? 'medium' : 'low'
    }))

  const usedNames = new Set(characterCandidates.map((candidate) => candidate.name.toLowerCase()))
  const locationCandidates = [...stats.values()]
    .filter((candidate) => candidate.locationHits >= 2 && !usedNames.has(candidate.name.toLowerCase()))
    .sort((a, b) => b.locationHits - a.locationHits)
    .slice(0, 7)
    .map<CodexCandidate>((candidate) => ({
      type: 'location',
      name: candidate.name,
      summary: `Mentioned ${candidate.count} times; appears after location prepositions`,
      confidence: candidate.locationHits >= 3 ? 'medium' : 'low'
    }))

  return [...characterCandidates, ...locationCandidates].slice(0, 15)
}

function bump(stats: Map<string, CandidateStats>, rawName: string, field: keyof Omit<CandidateStats, 'name'>): void {
  const name = cleanName(rawName)
  const key = name.toLowerCase()
  const current = stats.get(key) ?? { name, count: 0, dialogueHits: 0, locationHits: 0 }
  current[field] += 1
  stats.set(key, current)
}

function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim()
}

function shouldSkipName(rawName: string): boolean {
  const name = cleanName(rawName)
  if (!name) return true
  return name.split(/\s+/).some((part) => STOPWORDS.has(part))
}
