// Pure outline-framework heuristics — mirrors codexLogic.ts's house style:
// dependency-free (no node:fs/node:crypto import; ids come from the
// `crypto.randomUUID()` global, the same convention renderer/src/state/
// store.ts and friends already use, which resolves under both
// tsconfig.web.json's DOM lib and tsconfig.node.json's @types/node global)
// so both the renderer (routes/Outline.tsx) and the main process
// (agent/simulator.ts's runDevEditor) can import it directly.
import type { OutlineBeat, OutlineFramework, OutlineFrameworkKind } from './schema/outline'
import type { ManuscriptTree } from './schema/manuscript'

type TemplateBeatSeed = { label: string; description: string; role?: string }

// Real seed beat lists per spec §11. 'custom' intentionally has none — a
// custom framework starts as an empty beat list the writer builds by hand.
export const TEMPLATE_BEATS: Record<OutlineFrameworkKind, TemplateBeatSeed[]> = {
  'three-act': [
    { label: 'Setup', description: 'Establish the ordinary world, protagonist, and tone before anything disrupts it.' },
    { label: 'Inciting Incident', description: 'The event that sets the story in motion and disrupts the status quo.' },
    { label: 'Plot Point 1', description: 'The protagonist commits to the journey, ending Act One.' },
    { label: 'Rising Action', description: 'Escalating complications and obstacles as the protagonist pursues the goal.' },
    { label: 'Midpoint', description: 'A major shift — new information, a false victory/defeat, or raised stakes.' },
    { label: 'Plot Point 2', description: 'A low point or major setback that launches the final push, ending Act Two.' },
    { label: 'Climax', description: 'The final confrontation where the central conflict is decided.' },
    { label: 'Resolution', description: 'The new equilibrium and aftermath once the conflict is resolved.' }
  ],
  'save-the-cat': [
    { label: 'Opening Image', description: 'A snapshot of the protagonist and world before the story begins.' },
    { label: 'Theme Stated', description: "Someone states the story's thematic premise, usually to the protagonist." },
    { label: 'Set-Up', description: "Introduce the protagonist's world, flaws, and what needs to change." },
    { label: 'Catalyst', description: 'The inciting incident that upends the status quo.' },
    { label: 'Debate', description: 'The protagonist hesitates — should they really go on this journey?' },
    { label: 'Break into Two', description: 'The protagonist commits and enters the new, upside-down world of Act Two.' },
    { label: 'B Story', description: 'A secondary storyline (often a relationship) begins, carrying the theme.' },
    { label: 'Fun and Games', description: "The story's premise is explored — often the trailer-friendly section." },
    { label: 'Midpoint', description: 'Stakes are raised — a false victory or false defeat changes everything.' },
    { label: 'Bad Guys Close In', description: 'Opposition regroups and tightens; internal and external pressure mounts.' },
    { label: 'All Is Lost', description: "The lowest point — often marked by a 'whiff of death'." },
    { label: 'Dark Night of the Soul', description: 'The protagonist processes the loss before finding a way forward.' },
    { label: 'Break into Three', description: 'A new idea or piece of the B Story shows the protagonist how to win.' },
    { label: 'Finale', description: 'The protagonist executes the plan and resolves the central conflict.' },
    { label: 'Final Image', description: "A snapshot mirroring/contrasting the Opening Image, proving change occurred." }
  ],
  'heros-journey': [
    { label: 'Ordinary World', description: "The hero's normal life before the adventure begins." },
    { label: 'Call to Adventure', description: 'A challenge or problem presents itself.' },
    { label: 'Refusal of the Call', description: 'The hero hesitates, fearing the unknown ahead.' },
    { label: 'Meeting the Mentor', description: 'The hero encounters someone who prepares them for the journey.' },
    { label: 'Crossing the Threshold', description: 'The hero commits and leaves the ordinary world behind.' },
    { label: 'Tests, Allies, Enemies', description: 'The hero faces trials and learns who can be trusted.' },
    { label: 'Approach to the Inmost Cave', description: 'The hero nears the central danger or goal, preparations mount.' },
    { label: 'Ordeal', description: "The hero's greatest fear or biggest challenge — a life-or-death crisis." },
    { label: 'Reward (Seizing the Sword)', description: 'Having survived, the hero takes possession of their goal.' },
    { label: 'The Road Back', description: 'The hero begins the journey home, consequences of the ordeal still unresolved.' },
    { label: 'Resurrection', description: 'A final, most dangerous test where the hero is transformed for good.' },
    { label: 'Return with the Elixir', description: 'The hero returns home changed, bringing something of value back.' }
  ],
  'mystery-clue-grid': [
    { label: 'Crime / Mystery Established', description: 'The central mystery is presented to the reader.' },
    { label: 'Suspect Introduced: A', description: 'A plausible suspect enters the story.', role: 'suspect' },
    { label: 'Clue Planted', description: 'A genuine clue is planted for attentive readers to notice.', role: 'clue' },
    { label: 'Suspect Introduced: B', description: 'A second plausible suspect enters the story.', role: 'suspect' },
    { label: 'Red Herring', description: 'A misleading clue or false lead sends the investigation astray.', role: 'red-herring' },
    { label: 'Clue Planted', description: 'A second genuine clue narrows down the real answer.', role: 'clue' },
    { label: 'Suspect Introduced: C', description: 'A third plausible suspect enters the story.', role: 'suspect' },
    { label: 'Reveal', description: 'The mystery is solved and the clues are shown to add up.', role: 'reveal' }
  ],
  'thriller-escalation': [
    { label: 'Inciting Threat', description: 'The danger that sets the thriller in motion is introduced.', role: 'escalation-1' },
    { label: 'First Confrontation', description: 'The protagonist directly encounters the threat for the first time.', role: 'escalation-2' },
    { label: 'Stakes Raised', description: 'The danger widens in scope — more is now at risk.', role: 'escalation-3' },
    { label: 'Point of No Return', description: 'The protagonist can no longer retreat to safety.', role: 'escalation-4' },
    { label: 'Near-Miss / Setback', description: 'A plan fails or the antagonist gains ground.', role: 'escalation-5' },
    { label: 'Final Confrontation Looms', description: 'All threads converge toward an unavoidable last stand.', role: 'escalation-6' },
    { label: 'Climactic Escalation', description: 'Stakes peak in the final confrontation.', role: 'escalation-7' },
    { label: 'Resolution / Stand-down', description: 'The threat is neutralized and the danger recedes.', role: 'escalation-8' }
  ],
  custom: []
}

export function createFrameworkFromTemplate(kind: OutlineFrameworkKind, name: string): OutlineFramework {
  const seeds = TEMPLATE_BEATS[kind]
  const beats: OutlineBeat[] = seeds.map((seed, index) => ({
    id: crypto.randomUUID(),
    label: seed.label,
    description: seed.description,
    order: index,
    role: seed.role
  }))

  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    kind,
    name,
    beats
  }
}

// Chapter -> reading-order-ordinal, mirroring codexLogic.ts's
// getManuscriptReadingOrder() but at chapter granularity (beats map to
// chapters, not scenes) — kept local rather than imported from codexLogic.ts
// so this module stays dependency-free on any sibling shared module, not
// just on node/main-process code.
function getChapterReadingOrder(tree: ManuscriptTree): Map<string, number> {
  const order = new Map<string, number>()
  let ordinal = 0
  for (const book of tree.books) {
    for (const part of book.parts) {
      for (const chapter of part.chapters) {
        order.set(chapter.id, ordinal++)
      }
    }
  }
  return order
}

export interface BeatStatus {
  beatId: string
  mapped: boolean
  orderViolation: boolean
}

// A beat is "mapped" once it has a targetChapterId. "orderViolation" flags a
// mapped beat whose target chapter comes *before* (in manuscript reading
// order) an earlier-order beat's already-mapped chapter — beats are expected
// to map onto non-decreasing manuscript position as the framework's own
// order progresses. Beats are walked in `order` order to build this running
// check, then the result is returned in the framework's own beats[] order.
export function getBeatStatus(framework: OutlineFramework, manuscriptTree: ManuscriptTree): BeatStatus[] {
  const chapterOrder = getChapterReadingOrder(manuscriptTree)
  const sortedBeats = [...framework.beats].sort((a, b) => a.order - b.order)

  const statusByBeatId = new Map<string, BeatStatus>()
  let maxSeenPosition = -Infinity
  for (const beat of sortedBeats) {
    const mapped = beat.targetChapterId !== undefined
    let orderViolation = false
    if (mapped && beat.targetChapterId) {
      const position = chapterOrder.get(beat.targetChapterId)
      if (position !== undefined) {
        if (position < maxSeenPosition) {
          orderViolation = true
        } else {
          maxSeenPosition = position
        }
      }
    }
    statusByBeatId.set(beat.id, { beatId: beat.id, mapped, orderViolation })
  }

  return framework.beats.map(
    (beat) => statusByBeatId.get(beat.id) ?? { beatId: beat.id, mapped: false, orderViolation: false }
  )
}

export interface GenreExpectationFinding {
  beatId: string
  label: string
  message: string
  severity: 'low' | 'medium' | 'high'
}

// Deterministic, model-free flags: (1) a beat in the framework's first half
// left unmapped despite the manuscript already having drafted content in
// most of its chapters, and (2) any orderViolation beat from getBeatStatus
// above. No model call, no randomness — safe to run on every Dev-Editor pass
// and to unit-test directly against a fixture manuscript tree.
export function getGenreExpectationFindings(
  framework: OutlineFramework,
  manuscriptTree: ManuscriptTree
): GenreExpectationFinding[] {
  const findings: GenreExpectationFinding[] = []
  if (framework.beats.length === 0) return findings

  const statuses = getBeatStatus(framework, manuscriptTree)
  const statusByBeatId = new Map(statuses.map((s) => [s.beatId, s]))

  const allChapters = manuscriptTree.books.flatMap((book) => book.parts.flatMap((part) => part.chapters))
  const totalChapters = allChapters.length
  const draftedChapters = allChapters.filter((chapter) =>
    chapter.scenes.some((scene) => scene.wordCount > 0 || scene.status !== 'outline')
  ).length
  const progressRatio = totalChapters > 0 ? draftedChapters / totalChapters : 0

  const orders = framework.beats.map((b) => b.order)
  const minOrder = Math.min(...orders)
  const maxOrder = Math.max(...orders)
  const midpoint = minOrder + (maxOrder - minOrder) / 2

  for (const beat of framework.beats) {
    const status = statusByBeatId.get(beat.id)
    if (!status) continue

    if (!status.mapped && beat.order <= midpoint && progressRatio > 0.7) {
      const pct = Math.round(progressRatio * 100)
      findings.push({
        beatId: beat.id,
        label: beat.label,
        message: `"${beat.label}" is an early-framework beat with no chapter assigned yet, but the manuscript already has drafted content in ${pct}% of its chapters.`,
        severity: progressRatio >= 0.9 ? 'high' : 'medium'
      })
    }

    if (status.orderViolation) {
      findings.push({
        beatId: beat.id,
        label: beat.label,
        message: `"${beat.label}" is mapped to a chapter that comes earlier in the manuscript than an earlier-order beat's chapter — check the beat mapping against the manuscript's actual chapter order.`,
        severity: 'medium'
      })
    }
  }

  return findings
}
