// Phase 9 "Continuity validators" (Timeline "Continuity Checks" tab) — pure,
// dependency-free functions in the same style as shared/codexLogic.ts's
// detectContradictions/getManuscriptReadingOrder: only import schema types
// (no node:fs/node:crypto), take already-loaded CodexEntry[]/ManuscriptTree,
// and return findings for the caller to render. No new IPC — the renderer
// already has both inputs via codex.list()/manuscript.tree().
import type { CodexEntry } from './schema/codex'
import type { ManuscriptTree, SceneMeta } from './schema/manuscript'
import { getManuscriptReadingOrder } from './codexLogic'

export type ContinuityCheckKind = 'age' | 'timeline' | 'injury' | 'travel' | 'season'
export type ContinuityFindingSeverity = 'low' | 'medium' | 'high'

export interface ContinuityFinding {
  id: string
  kind: ContinuityCheckKind
  severity: ContinuityFindingSeverity
  message: string
  relatedSceneIds: string[]
  relatedCodexEntryIds: string[]
}

function flattenScenesInOrder(tree: ManuscriptTree): SceneMeta[] {
  const scenes: SceneMeta[] = []
  for (const book of tree.books) {
    for (const part of book.parts) {
      for (const chapter of part.chapters) {
        for (const scene of chapter.scenes) {
          scenes.push(scene)
        }
      }
    }
  }
  return scenes
}

function daysBetween(earlierIso: string, laterIso: string): number {
  const msPerDay = 24 * 60 * 60 * 1000
  return Math.round((Date.parse(laterIso) - Date.parse(earlierIso)) / msPerDay)
}

// ---------------------------------------------------------------------------
// 1. Timeline monotonicity
// ---------------------------------------------------------------------------

// Walks scenes in manuscript reading order and flags any scene whose
// storyDate is earlier than the latest storyDate seen at any earlier point
// in the manuscript, unless that scene is explicitly flagged isFlashback.
// Tracking a running "latest seen" (rather than only comparing to the
// immediately-preceding scene) is what catches "any earlier-in-reading-order
// scene," per spec, not just the adjacent one.
export function checkTimelineMonotonicity(entries: CodexEntry[], tree: ManuscriptTree): ContinuityFinding[] {
  void entries // not needed for this check; kept for a consistent (entries, tree) signature across all 5 checks
  const findings: ContinuityFinding[] = []
  const scenes = flattenScenesInOrder(tree)

  let runningLatestDate: string | undefined
  let runningLatestSceneTitle: string | undefined

  for (const scene of scenes) {
    const storyDate = scene.continuity?.storyDate
    if (!storyDate) continue

    if (runningLatestDate !== undefined && storyDate < runningLatestDate && !scene.continuity?.isFlashback) {
      findings.push({
        id: `timeline-${scene.id}`,
        kind: 'timeline',
        severity: 'medium',
        message: `"${scene.title}" is dated ${storyDate}, earlier than "${runningLatestSceneTitle}"'s ${runningLatestDate} despite appearing later in the manuscript. Mark it as a flashback if this is intentional.`,
        relatedSceneIds: [scene.id],
        relatedCodexEntryIds: []
      })
    }

    if (runningLatestDate === undefined || storyDate > runningLatestDate) {
      runningLatestDate = storyDate
      runningLatestSceneTitle = scene.title
    }
  }

  return findings
}

// ---------------------------------------------------------------------------
// 2. Injury continuity
// ---------------------------------------------------------------------------

export function checkInjuryContinuity(entries: CodexEntry[], tree: ManuscriptTree): ContinuityFinding[] {
  const findings: ContinuityFinding[] = []
  const order = getManuscriptReadingOrder(tree)

  for (const entry of entries) {
    if (entry.type !== 'character') continue
    for (const injury of entry.continuityProfile?.injuries ?? []) {
      const occurredOrdinal = injury.occurredSceneId ? order.get(injury.occurredSceneId) : undefined
      const healedOrdinal = injury.healedSceneId ? order.get(injury.healedSceneId) : undefined

      if (occurredOrdinal !== undefined && healedOrdinal !== undefined && occurredOrdinal > healedOrdinal) {
        findings.push({
          id: `injury-order-${entry.id}-${injury.id}`,
          kind: 'injury',
          severity: 'high',
          message: `${entry.name}'s injury "${injury.description}" is marked healed in a scene that appears earlier in the manuscript than the scene it occurred in.`,
          relatedSceneIds: [injury.occurredSceneId, injury.healedSceneId].filter((v): v is string => Boolean(v)),
          relatedCodexEntryIds: [entry.id]
        })
      }

      if (injury.occurredDate && injury.healedDate && injury.healedDate < injury.occurredDate) {
        findings.push({
          id: `injury-date-${entry.id}-${injury.id}`,
          kind: 'injury',
          severity: 'high',
          message: `${entry.name}'s injury "${injury.description}" has a healed date (${injury.healedDate}) earlier than its occurred date (${injury.occurredDate}).`,
          relatedSceneIds: [injury.occurredSceneId, injury.healedSceneId].filter((v): v is string => Boolean(v)),
          relatedCodexEntryIds: [entry.id]
        })
      }
    }
  }

  return findings
}

// ---------------------------------------------------------------------------
// 3. Travel time
// ---------------------------------------------------------------------------

export function checkTravelTime(entries: CodexEntry[], tree: ManuscriptTree): ContinuityFinding[] {
  const findings: ContinuityFinding[] = []
  const characters = entries.filter((e) => e.type === 'character')
  const locationsById = new Map(entries.filter((e) => e.type === 'location').map((e) => [e.id, e]))
  const scenes = flattenScenesInOrder(tree)

  function travelDaysBetween(locationIdA: string, locationIdB: string): number | undefined {
    if (locationIdA === locationIdB) return 0
    const viaA = locationsById.get(locationIdA)?.travelLinks?.find((l) => l.locationId === locationIdB)
    if (viaA) return viaA.days
    const viaB = locationsById.get(locationIdB)?.travelLinks?.find((l) => l.locationId === locationIdA)
    if (viaB) return viaB.days
    return undefined
  }

  for (const character of characters) {
    const charScenes = scenes
      .filter((s) => s.povCharacterId === character.id || (s.presentCharacterIds ?? []).includes(character.id))
      .filter((s): s is SceneMeta & { locationId: string } => Boolean(s.continuity?.storyDate && s.locationId))
      .sort((a, b) => {
        const dateA = a.continuity!.storyDate!
        const dateB = b.continuity!.storyDate!
        return dateA < dateB ? -1 : dateA > dateB ? 1 : 0
      })

    for (let i = 1; i < charScenes.length; i++) {
      const prev = charScenes[i - 1]
      const curr = charScenes[i]
      if (prev.locationId === curr.locationId) continue

      const requiredDays = travelDaysBetween(prev.locationId, curr.locationId)
      if (requiredDays === undefined) continue

      const gapDays = daysBetween(prev.continuity!.storyDate!, curr.continuity!.storyDate!)
      if (gapDays < requiredDays) {
        const prevLocName = locationsById.get(prev.locationId)?.name ?? prev.locationId
        const currLocName = locationsById.get(curr.locationId)?.name ?? curr.locationId
        findings.push({
          id: `travel-${character.id}-${prev.id}-${curr.id}`,
          kind: 'travel',
          severity: 'medium',
          message: `${character.name} travels from "${prevLocName}" to "${currLocName}" in ${gapDays} day(s), but that trip is recorded as taking ${requiredDays} day(s).`,
          relatedSceneIds: [prev.id, curr.id],
          relatedCodexEntryIds: [character.id, prev.locationId, curr.locationId]
        })
      }
    }
  }

  return findings
}

// ---------------------------------------------------------------------------
// 4. Season consistency
// ---------------------------------------------------------------------------

// Fixed Northern-Hemisphere month->season mapping (Mar-May spring, Jun-Aug
// summer, Sep-Nov autumn, Dec-Feb winter) — a documented simplification, not
// a hemisphere-aware inference. A Southern-Hemisphere-set manuscript will see
// false positives here; there's no per-project hemisphere setting today.
const MONTH_TO_SEASON: Record<number, NonNullable<import('./schema/manuscript').SceneContinuityMeta['season']>> = {
  0: 'winter',
  1: 'winter',
  2: 'spring',
  3: 'spring',
  4: 'spring',
  5: 'summer',
  6: 'summer',
  7: 'summer',
  8: 'autumn',
  9: 'autumn',
  10: 'autumn',
  11: 'winter'
}

export function checkSeasonConsistency(tree: ManuscriptTree): ContinuityFinding[] {
  const findings: ContinuityFinding[] = []
  const scenes = flattenScenesInOrder(tree)

  for (const scene of scenes) {
    const storyDate = scene.continuity?.storyDate
    const season = scene.continuity?.season
    if (!storyDate || !season) continue

    const month = new Date(`${storyDate}T00:00:00Z`).getUTCMonth()
    const expected = MONTH_TO_SEASON[month]
    if (expected !== season) {
      findings.push({
        id: `season-${scene.id}`,
        kind: 'season',
        severity: 'low',
        message: `"${scene.title}" is dated ${storyDate} (${expected}) but tagged as ${season}.`,
        relatedSceneIds: [scene.id],
        relatedCodexEntryIds: []
      })
    }
  }

  return findings
}

// ---------------------------------------------------------------------------
// 5. Stated-age consistency (heuristic text scan cross-checked against real data)
// ---------------------------------------------------------------------------

const AGE_MENTION_PATTERN = /\b(\d{1,3})\s*(?:years?\s*old|y\.?o\.?)\b/gi

function extractStatedAges(text: string): number[] {
  const ages: number[] = []
  const regex = new RegExp(AGE_MENTION_PATTERN)
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    ages.push(parseInt(match[1], 10))
  }
  return ages
}

function expectedAgeOn(birthDate: string, atDate: string): number {
  const birth = new Date(`${birthDate}T00:00:00Z`)
  const at = new Date(`${atDate}T00:00:00Z`)
  let age = at.getUTCFullYear() - birth.getUTCFullYear()
  const hadBirthdayThisYear =
    at.getUTCMonth() > birth.getUTCMonth() ||
    (at.getUTCMonth() === birth.getUTCMonth() && at.getUTCDate() >= birth.getUTCDate())
  if (!hadBirthdayThisYear) age -= 1
  return age
}

// Heuristic, text-scan-based — same honest-placeholder tone as
// detectContradictions in shared/codexLogic.ts: this never claims to
// understand the prose, it just regex-scans for an explicit "N years
// old"/"N y.o." mention and cross-checks it against the real, structured
// birthDate/storyDate fields. A missed or oddly-phrased age mention simply
// produces no finding rather than a false one; only a *found* mention that
// disagrees with the structured data by more than a year is flagged.
export function checkStatedAgeConsistency(entries: CodexEntry[], tree: ManuscriptTree): ContinuityFinding[] {
  const findings: ContinuityFinding[] = []
  const scenes = flattenScenesInOrder(tree)

  for (const entry of entries) {
    if (entry.type !== 'character') continue
    const birthDate = entry.continuityProfile?.birthDate
    if (!birthDate) continue

    for (const scene of scenes) {
      const present = scene.povCharacterId === entry.id || (scene.presentCharacterIds ?? []).includes(entry.id)
      if (!present) continue
      const storyDate = scene.continuity?.storyDate
      const notes = scene.continuity?.continuityNotes
      if (!storyDate || !notes) continue

      for (const statedAge of extractStatedAges(notes)) {
        const expected = expectedAgeOn(birthDate, storyDate)
        if (Math.abs(expected - statedAge) > 1) {
          findings.push({
            id: `age-scene-${entry.id}-${scene.id}-${statedAge}`,
            kind: 'age',
            severity: 'medium',
            message: `"${scene.title}" states ${entry.name} is ${statedAge}, but their birth date (${birthDate}) implies age ${expected} on ${storyDate}.`,
            relatedSceneIds: [scene.id],
            relatedCodexEntryIds: [entry.id]
          })
        }
      }
    }

    // The character's own Codex body/relationship notes have no scene of
    // their own to date against — cross-check against the first
    // manuscript-linked scene's storyDate, if any.
    const linkedSceneId = entry.manuscriptLinks[0]?.sceneId
    const linkedScene = linkedSceneId ? scenes.find((s) => s.id === linkedSceneId) : undefined
    const linkedStoryDate = linkedScene?.continuity?.storyDate
    if (!linkedStoryDate) continue

    const textsToScan = [
      ...Object.values(entry.body).filter((v): v is string => typeof v === 'string'),
      ...entry.relationships.map((r) => r.notes).filter((v): v is string => typeof v === 'string')
    ]
    for (const text of textsToScan) {
      for (const statedAge of extractStatedAges(text)) {
        const expected = expectedAgeOn(birthDate, linkedStoryDate)
        if (Math.abs(expected - statedAge) > 1) {
          findings.push({
            id: `age-codex-${entry.id}-${statedAge}-${linkedSceneId}`,
            kind: 'age',
            severity: 'low',
            message: `${entry.name}'s Codex entry states an age of ${statedAge}, but their birth date (${birthDate}) implies age ${expected} as of the linked scene's date (${linkedStoryDate}).`,
            relatedSceneIds: linkedSceneId ? [linkedSceneId] : [],
            relatedCodexEntryIds: [entry.id]
          })
        }
      }
    }
  }

  return findings
}

// ---------------------------------------------------------------------------
// Convenience: run all 5 checks and concatenate their findings, for a single
// call site like Timeline.tsx's "Continuity Checks" tab.
// ---------------------------------------------------------------------------

export function runAllContinuityChecks(entries: CodexEntry[], tree: ManuscriptTree): ContinuityFinding[] {
  return [
    ...checkTimelineMonotonicity(entries, tree),
    ...checkInjuryContinuity(entries, tree),
    ...checkTravelTime(entries, tree),
    ...checkSeasonConsistency(tree),
    ...checkStatedAgeConsistency(entries, tree)
  ]
}
