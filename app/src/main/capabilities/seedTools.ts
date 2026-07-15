import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CapabilityManifest } from '@shared/schema/capability'
import type { CodexEntry } from '@shared/schema/codex'
import { writeManifestTo } from '../persistence/capabilityStore'
import { globalCapabilitiesDir } from './registry'
import type { SandboxedTool } from './sandbox'

export const wordCountTool: SandboxedTool = {
  manifestId: 'global.tools.word-count',
  run: (input: unknown) => {
    const { text } = input as { text: string }
    const trimmed = text.trim()
    return { wordCount: trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length }
  }
}

// Mirrors shared/codexLogic.ts's detectContradictions, reimplemented inline
// rather than imported: runSandboxed() compiles this function via
// `.toString()` into a standalone vm.Script with no access to this module's
// imports or closures (see sandbox.ts), so a sandboxed tool has to be fully
// self-contained. seedTools.test.ts asserts this stays behaviorally
// identical to the real detectContradictions on a shared fixture, so drift
// between the two would be caught.
export const codexContradictionCheckTool: SandboxedTool = {
  manifestId: 'global.tools.codex-contradiction-check',
  run: (input: unknown) => {
    const { entries } = input as { entries: CodexEntry[] }
    const reasons = new Map<string, string[]>()
    const addReason = (id: string, reason: string): void => {
      const existing = reasons.get(id)
      if (existing) existing.push(reason)
      else reasons.set(id, [reason])
    }
    const isNonEmpty = (value: unknown): boolean => value !== undefined && value !== null && value !== ''

    const byId = new Map(entries.map((e) => [e.id, e]))
    for (const entry of entries) {
      for (const rel of entry.relationships) {
        if (rel.kind !== 'contradicts') continue
        const target = byId.get(rel.targetEntryId)
        if (!target) continue
        addReason(entry.id, `Marked as contradicting "${target.name}"`)
        addReason(target.id, `Marked as contradicted by "${entry.name}"`)
      }
    }

    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i]
        const b = entries[j]
        if (a.type !== b.type) continue
        if (a.name.trim().toLowerCase() !== b.name.trim().toLowerCase()) continue

        const bodyKeys = new Set([...Object.keys(a.body), ...Object.keys(b.body)])
        for (const key of bodyKeys) {
          const av = a.body[key]
          const bv = b.body[key]
          if (!isNonEmpty(av) || !isNonEmpty(bv)) continue
          if (JSON.stringify(av) === JSON.stringify(bv)) continue
          addReason(a.id, `Conflicts with "${b.name}" on "${key}"`)
          addReason(b.id, `Conflicts with "${a.name}" on "${key}"`)
        }
      }
    }

    return { contradictions: [...reasons.entries()] }
  }
}

export const seedSandboxedTools: SandboxedTool[] = [wordCountTool, codexContradictionCheckTool]

export function getSeedTool(manifestId: string): SandboxedTool | undefined {
  return seedSandboxedTools.find((t) => t.manifestId === manifestId)
}

// codex-search is discoverable/invocable through the registry like the other
// two, but its manifest has no matching SandboxedTool: search() needs a live
// AtlasDb (a sql.js handle), which isn't something the vm.Script(toString())
// sandbox model here can accept safely (any object reference exposed to the
// sandboxed context isn't actually isolated — it just moves the "is this
// safe" question rather than answering it). Rather than force a
// leaky abstraction, the caller (simulator.ts, or any future caller) is
// expected to call ensureIndexed()/search() from retrieval/search.ts
// directly and skip runSandboxed() for this one capability — documented
// here so the gap is visible next to where it's decided.
function buildSeedManifests(now: string): CapabilityManifest[] {
  const base = (
    partial: Pick<
      CapabilityManifest,
      'id' | 'name' | 'description' | 'sideEffects' | 'compatibleAgentRoles' | 'inputSchema' | 'outputSchema'
    > & {
      // Round 12: additive overrides for a real network tool (Brave Search)
      // whose defaults genuinely differ from every prior seed tool's — every
      // pre-Round-12 caller omits both, preserving the exact defaults below.
      localOnly?: boolean
      permissionCategory?: string
    }
  ): CapabilityManifest => ({
    schemaVersion: 1,
    id: partial.id,
    name: partial.name,
    description: partial.description,
    type: 'tool',
    scope: 'global',
    owner: 'Atlas default',
    version: '1.0.0',
    inputSchema: partial.inputSchema,
    outputSchema: partial.outputSchema,
    requiredContext: [],
    dependsOn: [],
    compatibleAgentRoles: partial.compatibleAgentRoles,
    compatibleModelCapabilities: ['tool-calling'],
    sideEffects: partial.sideEffects,
    permissionCategory: partial.permissionCategory ?? (partial.sideEffects === 'none' ? 'none' : 'read-manuscript'),
    localOnly: partial.localOnly ?? true,
    costCharacteristics: { estTimeMs: 50 },
    validationStatus: 'passed',
    lifecycleState: 'enabled',
    createdBy: 'agent-generated',
    history: [{ versionId: 'seed-v1', changedAt: now, note: 'Installed as a Phase 3 development-mode seed capability.' }]
  })

  return [
    base({
      id: 'global.tools.word-count',
      name: 'Word Count',
      description: 'Counts words in a passage of text.',
      sideEffects: 'none',
      compatibleAgentRoles: ['Generator', 'Dev-Editor', 'Line-Editor', 'Dialoguer', 'World-Builder'],
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      outputSchema: { type: 'object', properties: { wordCount: { type: 'number' } } }
    }),
    base({
      id: 'global.tools.codex-contradiction-check',
      name: 'Codex Contradiction Check',
      description: 'Scans Codex entries for marked or inferred contradictions.',
      sideEffects: 'reads-project',
      // World-Builder also runs this (see checkWorldBuilderContradictions in
      // main/agent/simulator.ts) against its own proposed new entries plus
      // the existing Codex, to catch a proposed fact conflicting with
      // something already tracked before the writer ever reviews it.
      compatibleAgentRoles: ['Dev-Editor', 'World-Builder'],
      inputSchema: {
        type: 'object',
        properties: { entries: { type: 'array', items: { type: 'object' } } },
        required: ['entries']
      },
      outputSchema: { type: 'object', properties: { contradictions: { type: 'array', items: { type: 'array' } } } }
    }),
    base({
      id: 'global.tools.codex-search',
      name: 'Codex Search',
      description:
        'Semantic search over indexed Codex entries and manuscript scenes. Not sandboxed — requires a live project database handle (see the comment above buildSeedManifests in seedTools.ts).',
      sideEffects: 'reads-project',
      compatibleAgentRoles: ['Generator', 'Dev-Editor', 'Line-Editor', 'Dialoguer', 'World-Builder'],
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      outputSchema: { type: 'object', properties: { results: { type: 'array', items: { type: 'object' } } } }
    }),
    // Round 12: World Builder's real web-research tool, backed by
    // main/mcp/braveSearchAdapter.ts's real Brave Search MCP connection. Not
    // sandboxed — same reasoning as codex-search above (a real network call
    // and a spawned child process aren't something the vm.Script(toString())
    // sandbox model can safely accept); the caller (runWorldBuilder) invokes
    // runBraveWebSearch() directly rather than going through runSandboxed().
    // A distinct id from seedSampleProject.ts's illustrative, never-executed
    // 'global.tools.web-search' demo manifest (project-scoped, never
    // installed as a real capability) — colliding ids would risk a real/
    // illustrative mixup since lookups match by id without distinguishing
    // scope.
    base({
      id: 'global.tools.web-search-brave',
      name: 'Web Search (Brave)',
      description: 'Real web search via a Brave Search MCP server, for World Builder research.',
      sideEffects: 'network',
      compatibleAgentRoles: ['World-Builder'],
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      outputSchema: {
        type: 'object',
        properties: { results: { type: 'array', items: { type: 'object' } } }
      },
      localOnly: false,
      permissionCategory: 'external-network-access'
    })
  ]
}

// Spec §7 Phase 3: "Development-mode automatic generation and installation
// for simple seed capabilities." Idempotent via an existsSync check per tool
// id, so re-running the app doesn't clobber a manifest a user may have since
// edited via Library.tsx's new capability editor.
export async function installSeedCapabilities(): Promise<void> {
  const dir = globalCapabilitiesDir()
  const manifests = buildSeedManifests(new Date().toISOString())
  for (const manifest of manifests) {
    const manifestPath = join(dir, 'tools', manifest.id, 'manifest.json')
    if (existsSync(manifestPath)) continue
    await writeManifestTo(dir, manifest)
  }
}
