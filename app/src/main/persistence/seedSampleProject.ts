import { randomUUID } from 'node:crypto'
import type { AtlasDb } from './db'
import { writeCapabilityManifest } from './capabilityStore'
import { upsertCodexEntry } from './codexStore'
import type { CapabilityManifest } from '@shared/schema/capability'
import type { CodexEntry } from '@shared/schema/codex'
import type { SceneMeta } from '@shared/schema/manuscript'
import { writeBookMeta, writeChapterMeta, writePartMeta } from './manuscriptStore'
import { createProject } from './projectStore'
import { writeScene } from './sceneStore'

// Ports the "Cottonmouth" sample project used throughout the Phase 1 HTML
// prototype (Atlas.dc.html) into real project files, so the production app
// opens on a populated demonstration project rather than an empty shell —
// per spec §2 Phase 1 Acceptance Criteria, carried forward into Phase 2.
//
// The five-chapter outline and both Chapter Three scene titles/purposes are
// taken directly from the prototype's outlineChapters data so the Dashboard
// and Outline views show the same shape the prototype demoed. Chapter Three
// Scene Two's prose is the prototype's actual sample text; every other
// scene's prose is new placeholder text written to match tone, since the
// prototype only ever specified purpose summaries for those scenes, not
// full drafts.
export async function seedCottonmouthProject(projectRoot: string, db: AtlasDb): Promise<void> {
  await createProject(projectRoot, {
    id: randomUUID(),
    title: 'Cottonmouth',
    genrePrimary: 'Southern crime noir',
    targetWordCount: 90000,
    writerDisplayName: 'Sam'
  })

  const bookId = 'book-01'
  const partId = 'part-01'
  await writeBookMeta(projectRoot, { id: bookId, projectId: '', title: 'Book One', order: 0 })
  await writePartMeta(projectRoot, bookId, { id: partId, bookId, title: 'Part One: Homecoming', order: 0 })

  interface ScenePlan {
    id: string
    title: string
    purpose: string
    status: SceneMeta['status']
    povCharacterId?: string
    locationId?: string
    timeOrDate?: string
    craft?: SceneMeta['craft']
    continuity?: SceneMeta['continuity']
    prose: string
  }

  interface ChapterPlan {
    id: string
    title: string
    order: number
    summary: string
    scenes: ScenePlan[]
  }

  const chapterPlans: ChapterPlan[] = [
    {
      id: 'chapter-001',
      title: 'Chapter One — Homecoming',
      order: 0,
      summary: 'Ray returns to Bellhaven for his brother’s funeral and finds the town, and the Duvalls, unchanged.',
      scenes: [
        {
          id: 'scene-001',
          title: 'Scene 1 — The Drive In',
          purpose: 'Ray arrives for the funeral; first sight of Bellhaven in a decade.',
          status: 'revised',
          povCharacterId: 'ray',
          locationId: 'bellhaven',
          timeOrDate: 'Late June 2003',
          prose:
            "The highway narrowed to two lanes past the county line, same as it always had, and the heat came up off the asphalt in sheets you could see if you looked at it right.\n\nRay hadn't looked at it right in eighteen years.\n\nBellhaven hadn't grown so much as settled, the way old houses settle, joints loosening in places nobody thought to check. The fish plant's smokestack still marked the skyline before the water tower did. Some things a town builds around outlast the reasons for building them."
        },
        {
          id: 'scene-002',
          title: 'Scene 2 — The Wake',
          purpose: 'Ray reconnects with family; tension with the Duvalls surfaces.',
          status: 'revised',
          povCharacterId: 'ray',
          timeOrDate: 'Late June 2003',
          continuity: { relatedCodexIds: ['duvalls'] },
          prose:
            "The wake was in the fellowship hall behind First Baptist, folding tables end to end under casserole dishes with masking-tape names on the lids. Ray shook hands he half-remembered and let people tell him how much Dale had loved him, which might even have been true.\n\nHe found his cousin Patsy by the coffee urn, watching the door the way people watch a door when they're waiting for someone they don't want to see. \"The Duvalls sent flowers,\" she said, like it was an accusation.\n\n\"They always do,\" Ray said."
        }
      ]
    },
    {
      id: 'chapter-002',
      title: 'Chapter Two — Blood Kin',
      order: 1,
      summary: 'Dale’s effects raise a question Ray can’t leave alone about his brother’s state of mind.',
      scenes: [
        {
          id: 'scene-001',
          title: 'Scene 1 — The Will',
          purpose: 'Dale’s effects raise a question about his state of mind.',
          status: 'revised',
          povCharacterId: 'ray',
          continuity: { relatedCodexIds: ['dale', 'fishhouse'] },
          prose:
            "Dale's lawyer had an office above the hardware store, and the stairs up to it still had the same worn green runner Ray remembered from settling their father's estate. The will was short. Dale hadn't had much to leave.\n\nWhat stopped Ray wasn't the will. It was the ledger tucked in behind it — a second set of numbers on the fish plant's books, in Dale's handwriting, that didn't match anything Dale should have had reason to know."
        }
      ]
    },
    {
      id: 'chapter-003',
      title: 'Chapter Three — The Fish House',
      order: 2,
      summary: 'Ray presses further into Bellhaven, forcing his first direct exchange with Tull Duvall since the funeral.',
      scenes: [
        {
          id: 'scene-001',
          title: 'Scene 1 — Cold Storage',
          purpose: 'Ray revisits the plant; sets up the confrontation.',
          status: 'drafted',
          povCharacterId: 'ray',
          locationId: 'fishhouse',
          timeOrDate: 'Late June 2003',
          prose:
            "The plant smelled the way it always had, brine and diesel and the mineral cold coming off the ice room. Ray badged himself in the way he used to badge into crime scenes, out of old habit, though nobody here would recognize a Memphis PD shield or much care.\n\nHe wanted five minutes alone with the delivery logs before he found Tull. He got three."
        },
        {
          id: 'scene-002',
          title: 'Scene 2 — The Fish House',
          purpose: 'Ray confronts Tull Duvall; leaves with a name to check.',
          status: 'drafted',
          povCharacterId: 'ray',
          locationId: 'fishhouse',
          timeOrDate: 'Late June 2003',
          craft: {
            characterDesire: "Answers about Dale's death",
            externalGoal: 'Get Tull to slip on the timeline',
            opposition: "Tull's practiced calm, the plant's noise",
            stakes: 'If he pushes too hard, doors close for good',
            turningPoint: 'Tull mentions the ice logs',
            outcome: 'Ray leaves with a name to check'
          },
          continuity: {
            timelinePlacement: 'Late June 2003, two days after the funeral',
            setupIds: ['ice-log-detail'],
            payoffIds: ['ch6-ice-log-payoff'],
            foreshadowingNotes: "Tull's calm hints at rehearsed deception",
            themeIds: ['guilt'],
            motifIds: ['river-as-memory'],
            relatedCodexIds: ['ray', 'tull', 'fishhouse']
          },
          prose:
            "Tull Duvall was standing on the loading dock same as he'd stood there thirty years ago, shouting orders at men half his age, sleeves rolled to the elbow. He saw Ray coming and didn't stop talking, just lifted two fingers off the clipboard in something that wasn't quite a wave.\n\n\"Didn't expect to see you out this way,\" Tull said, when Ray was close enough that shouting wasn't required anymore. \"Thought you'd have gone on back up to Memphis by now.\"\n\n\"Shame about Dale.\" Tull said it the way a man says grace before a meal he doesn't want. \"Good boy. Never did understand why he'd do a thing like that.\"\n\nRay let that sit a second, the ice machine behind Tull grinding through its cycle. \"Neither did I,\" he said."
        }
      ]
    },
    {
      id: 'chapter-004',
      title: 'Chapter Four — The Levee Road',
      order: 3,
      summary: 'Not started.',
      scenes: []
    },
    {
      id: 'chapter-005',
      title: 'Chapter Five — Low Water',
      order: 4,
      summary: 'Not started.',
      scenes: []
    }
  ]

  for (const chapter of chapterPlans) {
    await writeChapterMeta(projectRoot, bookId, partId, {
      id: chapter.id,
      partId,
      title: chapter.title,
      order: chapter.order,
      summary: chapter.summary,
      // Scene ids must be unique project-wide (they're the SQLite index's
      // primary key and the React list key) — the plan's scene.id is only
      // a local slug ("scene-001") reused per chapter to match the spec's
      // file-naming convention, so it's namespaced with the chapter id here.
      sceneIds: chapter.scenes.map((s) => `${chapter.id}-${s.id}`)
    })

    const relativeDir = `${bookId}/${partId}/${chapter.id}`
    for (const [index, scene] of chapter.scenes.entries()) {
      const globalId = `${chapter.id}-${scene.id}`
      await writeScene(
        projectRoot,
        db,
        globalId,
        {
          meta: {
            schemaVersion: 2,
            id: globalId,
            chapterId: chapter.id,
            order: index,
            title: scene.title,
            povCharacterId: scene.povCharacterId,
            locationId: scene.locationId,
            timeOrDate: scene.timeOrDate,
            purpose: scene.purpose,
            craft: scene.craft,
            continuity: scene.continuity,
            status: scene.status
          },
          prose: scene.prose
        },
        relativeDir,
        scene.id
      )
    }
  }

  const now = new Date().toISOString()
  const baseEntry = (
    partial: Pick<CodexEntry, 'id' | 'type' | 'name' | 'status' | 'body' | 'isPrivate'> &
      Partial<Pick<CodexEntry, 'source' | 'approvedAt'>>
  ): CodexEntry => ({
    schemaVersion: 1,
    localModelOnly: false,
    locked: false,
    source: 'author',
    relationships: [],
    manuscriptLinks: [],
    createdAt: now,
    updatedAt: now,
    history: [],
    ...partial
  })

  const entries: CodexEntry[] = [
    baseEntry({
      id: 'ray',
      type: 'character',
      name: 'Ray Chambliss',
      status: 'canon',
      isPrivate: false,
      body: {
        summary:
          "Protagonist. 41. Ex-Memphis PD homicide detective. Returned to Bellhaven after brother Dale's death was ruled a suicide he doesn't believe."
      }
    }),
    baseEntry({
      id: 'dale',
      type: 'character',
      name: 'Dale Chambliss',
      status: 'canon',
      isPrivate: false,
      body: { summary: "Ray's younger brother. Found dead June 14, 2003. Ruling: suicide. Ray disputes it." }
    }),
    baseEntry({
      id: 'tull',
      type: 'character',
      name: 'Sheriff Tull Duvall',
      status: 'canon',
      isPrivate: false,
      body: { summary: "Runs Bellhaven through the fish plant and county contracts. Old friend of Ray's late father." }
    }),
    baseEntry({
      id: 'bellhaven',
      type: 'location',
      name: 'Bellhaven, Mississippi',
      status: 'canon',
      isPrivate: false,
      body: { summary: 'Fictional Delta town, population 4,200. River town built around catfish processing and cotton money.' }
    }),
    baseEntry({
      id: 'fishhouse',
      type: 'location',
      name: 'Duvall Fish & Cold Storage',
      status: 'canon',
      isPrivate: false,
      body: { summary: "The Duvall family's processing plant on the river. Site of the Chapter Three confrontation." }
    }),
    baseEntry({
      id: 'duvalls',
      type: 'faction',
      name: 'The Duvall Family',
      status: 'canon',
      isPrivate: false,
      body: { summary: 'Political dynasty controlling county contracts and the fish plant for three generations.' }
    }),
    baseEntry({
      id: 'heat',
      type: 'world-rule',
      name: 'The Delta heat never breaks before September',
      status: 'tentative',
      isPrivate: false,
      body: { summary: 'Atmospheric constraint — keep summer scenes oppressive through August.' }
    }),
    // Timeline entries carry a display `date` string (the era/date isn't a
    // strict ISO date in a historical-fiction sense — "c. 1972" isn't
    // parseable) plus a numeric `order` for sorting, both in body since
    // CodexEntry.body is type-specific freeform data (see spec §6).
    baseEntry({
      id: 'father-duvall-plant',
      type: 'timeline-item',
      name: "Ray & Dale's father works the Duvall plant",
      status: 'canon',
      isPrivate: false,
      body: {
        date: 'c. 1972',
        order: 0,
        summary: "Backstory anchor — establishes the family's decades-long entanglement with the Duvalls."
      }
    }),
    baseEntry({
      id: 'daletimeline',
      type: 'timeline-item',
      name: 'Dale Chambliss found dead',
      status: 'canon',
      isPrivate: false,
      body: {
        date: 'June 14, 2003',
        order: 1,
        summary: 'Ruled a suicide. Ray disputes it. All present-day chapters resolve against this date.'
      }
    }),
    baseEntry({
      id: 'ray-returns-bellhaven',
      type: 'timeline-item',
      name: 'Ray returns to Bellhaven',
      status: 'canon',
      isPrivate: false,
      body: {
        date: 'June 2003, present',
        order: 2,
        summary: "Opens Chapter 1. Ray arrives for the funeral and doesn't leave."
      }
    }),
    baseEntry({
      id: 'ch3-fishhouse-confrontation',
      type: 'timeline-item',
      name: 'Ch.3 — The Fish House confrontation',
      status: 'canon',
      isPrivate: false,
      body: {
        date: 'Late June 2003',
        order: 3,
        summary: "Ray's first direct exchange with Tull Duvall since the funeral."
      }
    }),
    baseEntry({
      id: 'guilt',
      type: 'theme',
      name: 'Inherited guilt',
      status: 'tentative',
      isPrivate: false,
      body: { summary: 'Motif tracked across manuscript — sins of the fathers revisited on the sons.' }
    }),
    // Pending World Builder proposals — the same two examples shown in the
    // Phase 1 prototype's Codex, seeded as ai-proposed/unapproved so the
    // real Accept/Reject/Refine flow (spec §6) has something to act on.
    // World Builder itself isn't a wired agent yet; these are static demo
    // content, not the output of a live run.
    baseEntry({
      id: 'catfishboom',
      type: 'world-rule',
      name: 'Catfish farming boom, 1980s–90s',
      status: 'tentative',
      isPrivate: false,
      source: 'ai-proposed',
      body: {
        summary:
          "Mississippi's shift from cotton to farm-raised catfish reshaped Delta river towns economically — grounds Duvall Fish & Cold Storage's rise.",
        citationsSummary: '3 sources cited'
      }
    }),
    baseEntry({
      id: 'icehouselogistics',
      type: 'research-note',
      name: 'Ice-house cold-chain logistics',
      status: 'tentative',
      isPrivate: false,
      source: 'ai-proposed',
      body: {
        summary:
          'Processing plants of this era relied on on-site ice production for same-day shipping — explains the ice machine detail in Chapter Three.',
        citationsSummary: '1 source cited'
      }
    }),
    baseEntry({
      id: 'privatenote',
      type: 'private-author-note',
      name: "Ray's drinking",
      status: 'tentative',
      isPrivate: true,
      body: { summary: "Keep it a symptom, not a plot device. Don't let it resolve too neatly." }
    })
  ]

  for (const entry of entries) {
    await upsertCodexEntry(projectRoot, db, entry)
  }

  const baseManifest = (
    partial: Pick<
      CapabilityManifest,
      | 'id'
      | 'name'
      | 'description'
      | 'type'
      | 'scope'
      | 'compatibleAgentRoles'
      | 'sideEffects'
      | 'permissionCategory'
      | 'costCharacteristics'
      | 'inputSchema'
      | 'outputSchema'
    >
  ): CapabilityManifest => ({
    schemaVersion: 1,
    owner: 'Atlas default',
    version: '1.0.0',
    requiredContext: [],
    dependsOn: [],
    compatibleModelCapabilities: ['tool-calling'],
    localOnly: false,
    validationStatus: 'passed',
    lifecycleState: 'enabled',
    createdBy: 'author',
    history: [{ versionId: 'v1', changedAt: now, note: 'Initial sample manifest.' }],
    ...partial
  })

  // Read-only sample Tool & Skill Library — spec §15 Phase 2 scope. These
  // are demo manifests illustrating the capability schema (spec §8), not
  // capabilities any wired agent actually calls yet.
  const capabilities: CapabilityManifest[] = [
    {
      ...baseManifest({
        id: 'global.tools.web-search',
        name: 'Web Search',
        description: 'Searches the web for factual grounding and returns cited sources.',
        type: 'tool',
        scope: 'global',
        compatibleAgentRoles: ['World-Builder', 'Generator'],
        sideEffects: 'network',
        permissionCategory: 'external-network-access',
        costCharacteristics: { estCostUsd: 0.01 },
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        outputSchema: { type: 'object', properties: { sources: { type: 'array', items: { type: 'object' } } } }
      }),
      version: '1.3.0'
    },
    {
      ...baseManifest({
        id: 'global.skills.citation-formatter',
        name: 'Citation Formatter',
        description: "Formats research sources into Codex-ready citations with reliability ratings.",
        type: 'skill',
        scope: 'global',
        compatibleAgentRoles: ['World-Builder'],
        sideEffects: 'none',
        permissionCategory: 'none',
        costCharacteristics: { estTokens: 200 },
        inputSchema: { type: 'object', properties: { sourceUrl: { type: 'string' } } },
        outputSchema: { type: 'object', properties: { citation: { type: 'string' }, reliability: { type: 'string' } } }
      }),
      // Formatting a citation only makes sense once a web search has
      // returned a source — demonstrates spec §8's dependency views.
      dependsOn: ['global.tools.web-search@1.3.0']
    },
    baseManifest({
      id: 'global.tools.continuity-checker',
      name: 'Continuity Checker',
      description: 'Deterministic scan for timeline, POV, and naming inconsistencies across a manuscript scope.',
      type: 'tool',
      scope: 'global',
      compatibleAgentRoles: ['Dev-Editor'],
      sideEffects: 'reads-project',
      permissionCategory: 'read-manuscript',
      costCharacteristics: { estTimeMs: 4000 },
      inputSchema: { type: 'object', properties: { scope: { type: 'string' } } },
      outputSchema: { type: 'object', properties: { issues: { type: 'array', items: { type: 'object' } } } }
    }),
    baseManifest({
      id: 'global.skills.style-guide-enforcer',
      name: 'Style Guide Enforcer',
      description: 'Applies house style rules — filter words, adverb overuse, repeated structures — during a line pass.',
      type: 'skill',
      scope: 'global',
      compatibleAgentRoles: ['Line-Editor'],
      sideEffects: 'none',
      permissionCategory: 'none',
      costCharacteristics: { estTokens: 350 },
      inputSchema: { type: 'object', properties: { passage: { type: 'string' } } },
      outputSchema: { type: 'object', properties: { findings: { type: 'array', items: { type: 'object' } } } }
    }),
    {
      ...baseManifest({
        id: 'project.skills.delta-dialect',
        name: 'Delta Dialect Skill',
        description:
          "Voice rules for early-2000s rural Mississippi Delta speech patterns, tuned to Cottonmouth's cast.",
        type: 'skill',
        scope: 'project',
        compatibleAgentRoles: ['Dialoguer', 'Generator'],
        sideEffects: 'none',
        permissionCategory: 'none',
        costCharacteristics: { estTokens: 150 },
        inputSchema: { type: 'object', properties: { line: { type: 'string' }, characterId: { type: 'string' } } },
        outputSchema: { type: 'object', properties: { line: { type: 'string' } } }
      }),
      owner: 'Cottonmouth project',
      // Project-scope capability depending on a global-scope one — spec §8
      // explicitly calls out "project capabilities may depend on global
      // capabilities".
      dependsOn: ['global.skills.style-guide-enforcer@1.0.0']
    }
  ]

  for (const manifest of capabilities) {
    await writeCapabilityManifest(projectRoot, manifest)
  }
}
