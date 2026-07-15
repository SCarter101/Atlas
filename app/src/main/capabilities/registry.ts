import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { app } from 'electron'
import { join } from 'node:path'
import type { ToolCall } from '@shared/schema/agent'
import type {
  CapabilityManifest,
  CapabilityScope,
  CapabilityTestResult,
  CapabilityUsageMetric,
  LifecycleState
} from '@shared/schema/capability'
import { listManifestsFrom, writeManifestTo } from '../persistence/capabilityStore'
import { listAgentRuns, loadAgentRun } from '../persistence/agentRunStore'
import type { AtlasDb } from '../persistence/db'
import { projectPaths } from '../persistence/paths'
import { getSeedTool } from './seedTools'
import { runSandboxed } from './sandbox'

// The real global capability store, per-OS-user rather than per-project —
// see data-contracts §8. capabilityStore.ts's project-scoped
// listCapabilityManifests()/writeCapabilityManifest() predate this and are
// left as-is for their existing project-only callers; this module is the
// Phase 3+ merge point that also knows about the global directory.
export function globalCapabilitiesDir(): string {
  return join(app.getPath('userData'), 'atlas', 'capabilities')
}

export async function listCapabilities(projectRoot: string): Promise<CapabilityManifest[]> {
  const [globalManifests, projectManifests] = await Promise.all([
    listManifestsFrom(globalCapabilitiesDir()),
    listManifestsFrom(projectPaths(projectRoot).capabilitiesDir)
  ])
  return [...globalManifests, ...projectManifests].sort((a, b) => a.name.localeCompare(b.name))
}

export async function getCapability(projectRoot: string, id: string): Promise<CapabilityManifest | undefined> {
  const manifests = await listCapabilities(projectRoot)
  return manifests.find((m) => m.id === id)
}

function targetDirFor(projectRoot: string, manifest: CapabilityManifest): string {
  return manifest.scope === 'global' ? globalCapabilitiesDir() : projectPaths(projectRoot).capabilitiesDir
}

export async function createCapability(projectRoot: string, manifest: CapabilityManifest): Promise<void> {
  await writeManifestTo(targetDirFor(projectRoot, manifest), manifest)
}

// Mirrors the history-append pattern codexStore.ts's upsertCodexEntry() uses
// for CodexEntry.history — diffed against the on-disk previous version
// server-side, rather than trusting whatever history array the renderer sent.
function buildDiffNote(previous: CapabilityManifest, next: CapabilityManifest): string {
  const parts: string[] = []
  if (previous.name !== next.name) parts.push(`name: ${previous.name} → ${next.name}`)
  if (previous.description !== next.description) parts.push('description changed')
  if (previous.lifecycleState !== next.lifecycleState) {
    parts.push(`lifecycleState: ${previous.lifecycleState} → ${next.lifecycleState}`)
  }
  if (previous.sideEffects !== next.sideEffects) parts.push(`sideEffects: ${previous.sideEffects} → ${next.sideEffects}`)
  if (previous.permissionCategory !== next.permissionCategory) {
    parts.push(`permissionCategory: ${previous.permissionCategory} → ${next.permissionCategory}`)
  }
  return parts.length > 0 ? parts.join('; ') : 'no changes detected'
}

// Storing `previous` verbatim as a history entry's snapshot would nest
// snapshot-inside-snapshot across repeated edits (previous.history already
// contains earlier entries' own snapshots), growing roughly with the square
// of the edit count. rollbackCapability only ever needs a snapshot's
// top-level fields (the full manifest state at that point) to restore
// anything — nested history entries' own snapshots aren't needed for that —
// so they're stripped before storing.
function snapshotOf(manifest: CapabilityManifest): CapabilityManifest {
  return {
    ...manifest,
    history: manifest.history.map(({ snapshot: _nestedSnapshot, ...rest }) => rest)
  }
}

export async function updateCapability(projectRoot: string, manifest: CapabilityManifest): Promise<void> {
  const previous = await getCapability(projectRoot, manifest.id)
  const versionEntry = {
    versionId: randomUUID(),
    changedAt: new Date().toISOString(),
    note: previous ? buildDiffNote(previous, manifest) : 'Initial version.',
    snapshot: previous ? snapshotOf(previous) : undefined
  }
  const next: CapabilityManifest = { ...manifest, history: [...manifest.history, versionEntry] }
  await writeManifestTo(targetDirFor(projectRoot, next), next)
}

export async function setLifecycleState(projectRoot: string, id: string, state: LifecycleState): Promise<void> {
  const manifest = await getCapability(projectRoot, id)
  if (!manifest) throw new Error(`Capability ${id} not found`)
  await updateCapability(projectRoot, { ...manifest, lifecycleState: state })
}

// Rollback is itself just another audited update — it restores the
// snapshot's fields but keeps the *current* manifest's full history array
// (not the snapshot's own, shorter one) so updateCapability's append doesn't
// truncate everything that happened since the snapshot was taken; the
// rollback's own diff note + fresh snapshot get appended on top, same as any
// other edit.
export async function rollbackCapability(projectRoot: string, id: string, versionId: string): Promise<void> {
  const manifest = await getCapability(projectRoot, id)
  if (!manifest) throw new Error(`Capability ${id} not found`)

  const entry = manifest.history.find((h) => h.versionId === versionId)
  if (!entry) throw new Error(`No history entry with versionId "${versionId}" found for capability ${id}`)
  if (!entry.snapshot) {
    throw new Error('This version predates snapshot support and cannot be restored.')
  }

  const restored: CapabilityManifest = { ...entry.snapshot, history: manifest.history }
  await updateCapability(projectRoot, restored)
}

// Mirrors capabilityStore.ts's private TYPE_DIR mapping (tool -> 'tools',
// skill -> 'skills') without importing/exporting it from that module — this
// track's file scope deliberately doesn't extend to capabilityStore.ts, and
// the mapping is small enough to duplicate here for the one place
// (promoteCapability) that needs to remove a manifest's *old* on-disk
// location after writing it to the new one.
function manifestDirIn(capabilitiesDir: string, manifest: CapabilityManifest): string {
  return join(capabilitiesDir, manifest.type === 'tool' ? 'tools' : 'skills', manifest.id)
}

function scopeDir(projectRoot: string, scope: CapabilityScope): string {
  return scope === 'global' ? globalCapabilitiesDir() : projectPaths(projectRoot).capabilitiesDir
}

// Moves a capability's manifest file from its current scope's directory to
// targetScope's directory, updating `scope` on the manifest itself. Guards
// against an id collision already existing in the target scope rather than
// silently overwriting an unrelated capability that happens to share an id.
export async function promoteCapability(projectRoot: string, id: string, targetScope: CapabilityScope): Promise<void> {
  const manifest = await getCapability(projectRoot, id)
  if (!manifest) throw new Error(`Capability ${id} not found`)
  if (manifest.scope === targetScope) {
    throw new Error(`Capability ${id} is already scoped to ${targetScope}`)
  }

  const targetDir = scopeDir(projectRoot, targetScope)
  const existingInTarget = await listManifestsFrom(targetDir)
  if (existingInTarget.some((m) => m.id === id)) {
    throw new Error(`A capability with id "${id}" already exists in the ${targetScope} scope`)
  }

  const sourceDir = scopeDir(projectRoot, manifest.scope)
  const now = new Date().toISOString()
  const promoted: CapabilityManifest = {
    ...manifest,
    scope: targetScope,
    history: [
      ...manifest.history,
      { versionId: randomUUID(), changedAt: now, note: `Promoted from ${manifest.scope} to ${targetScope} scope.`, snapshot: snapshotOf(manifest) }
    ]
  }
  await writeManifestTo(targetDir, promoted)
  await rm(manifestDirIn(sourceDir, manifest), { recursive: true, force: true })
}

// Copies a capability under a new id into targetScope, resetting it to a
// fresh draft lineage (lifecycleState 'draft', a single history entry citing
// the fork's source) — does not touch or remove the original.
export async function forkCapability(
  projectRoot: string,
  id: string,
  newId: string,
  targetScope: CapabilityScope
): Promise<void> {
  const source = await getCapability(projectRoot, id)
  if (!source) throw new Error(`Capability ${id} not found`)

  const existing = await getCapability(projectRoot, newId)
  if (existing) throw new Error(`A capability with id "${newId}" already exists`)

  const now = new Date().toISOString()
  const forked: CapabilityManifest = {
    ...source,
    id: newId,
    scope: targetScope,
    lifecycleState: 'draft',
    history: [{ versionId: randomUUID(), changedAt: now, note: `Forked from ${id}.`, snapshot: snapshotOf(source) }]
  }
  await writeManifestTo(scopeDir(projectRoot, targetScope), forked)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Structural fallback used by testCapability() when no real SandboxedTool is
// registered for a manifest (see seedTools.ts's getSeedTool — true for
// codex-search and for every writer-authored draft manifest, since there's
// no capability-authoring code UI in this app). This does NOT execute
// anything: it only checks that sampleInput is object-shaped JSON and that
// every field name in inputSchema.required is present as a key.
function checkStructuralInput(manifest: CapabilityManifest, sampleInput: unknown): { ok: boolean; output?: unknown; error?: string } {
  if (!isPlainObject(sampleInput)) {
    return { ok: false, error: 'Sample input must be a JSON object.' }
  }
  const required = manifest.inputSchema.required ?? []
  const missing = required.filter((key) => !(key in sampleInput))
  if (missing.length > 0) {
    return { ok: false, error: `Missing required field(s): ${missing.join(', ')}` }
  }
  return {
    ok: true,
    output: { note: 'Structural check only: required fields present. No real execution occurred.', checkedFields: required }
  }
}

// Tests a manifest against sampleInput. When a real SandboxedTool is
// registered for manifest.id, actually runs it via runSandboxed() (mode:
// 'sandboxed') — a genuine execution test. Otherwise falls back to a
// structural shape check (mode: 'structural') — the common case for
// codex-search (needs a live DB handle the vm sandbox can't accept, see
// seedTools.ts) and for any writer-authored draft. Either way, persists the
// resulting validationStatus via updateCapability so Library.tsx's
// validation badge reflects the outcome; the caller/UI must display which
// mode ran rather than implying a full execution test happened in both cases.
//
// Codex adversarial-review fix (Round 11): the caller-supplied `manifest`
// (the renderer's local `selected` state, which can be a render or two
// behind the real IPC round-trip) is used ONLY to pick a seed tool and check
// the sample input's shape — never to persist. Persistence re-fetches the
// current on-disk manifest via getCapability() first, matching every other
// mutator in this file (updateCapability itself re-fetches `previous` rather
// than trusting a caller's copy). Persisting the stale `manifest` object
// directly would silently revert any fields (e.g. lifecycleState) changed
// since the renderer last fetched, and — since updateCapability appends onto
// `manifest.history` verbatim — could drop history entries written on disk
// after the renderer's copy was taken.
export async function testCapability(
  projectRoot: string,
  manifest: CapabilityManifest,
  sampleInput: unknown
): Promise<CapabilityTestResult> {
  const seedTool = getSeedTool(manifest.id)
  const current = (await getCapability(projectRoot, manifest.id)) ?? manifest

  if (seedTool) {
    const result = await runSandboxed(seedTool, sampleInput)
    const ok = !result.error
    await updateCapability(projectRoot, { ...current, validationStatus: ok ? 'passed' : 'failed' })
    return { ok, output: result.output, error: result.error?.message, mode: 'sandboxed' }
  }

  const structural = checkStructuralInput(manifest, sampleInput)
  await updateCapability(projectRoot, { ...current, validationStatus: structural.ok ? 'passed' : 'failed' })
  return { ...structural, mode: 'structural' }
}

// ESTIMATE ONLY — see CapabilityUsageMetric's doc comment in
// shared/schema/capability.ts. Scans up to the 200 most recent agent runs'
// tool-call steps, aggregates by toolId, and multiplies invocation counts by
// each capability's own self-declared costCharacteristics. There is no real
// "would have cost more without this tool" measurement happening here.
export async function getCapabilityUsageMetrics(projectRoot: string, db: AtlasDb): Promise<CapabilityUsageMetric[]> {
  const index = listAgentRuns(projectRoot, db)
  const recent = [...index].sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0)).slice(0, 200)

  const records = await Promise.all(recent.map((r) => loadAgentRun(projectRoot, r.runId).catch(() => undefined)))

  const byToolId = new Map<string, { invocations: number; successCount: number; failureCount: number }>()
  for (const record of records) {
    if (!record) continue
    for (const step of record.steps) {
      if (step.kind !== 'tool-call') continue
      const detail = step.detail as ToolCall
      const bucket = byToolId.get(detail.toolId) ?? { invocations: 0, successCount: 0, failureCount: 0 }
      bucket.invocations += 1
      if (detail.error) bucket.failureCount += 1
      else bucket.successCount += 1
      byToolId.set(detail.toolId, bucket)
    }
  }

  const results: CapabilityUsageMetric[] = []
  for (const [toolId, counts] of byToolId) {
    // Recorded tool-call ids are sometimes versioned pseudo-ids
    // (`global.tools.foo@1.0.0`, see Round 5's maybeRecommendCapability fix)
    // that match no installed manifest by exact string — strip the version
    // suffix before the manifest lookup so cost characteristics still
    // resolve for those.
    const manifest = await getCapability(projectRoot, toolId.split('@')[0])
    const estTokens = manifest?.costCharacteristics.estTokens ?? 0
    const estCostUsd = manifest?.costCharacteristics.estCostUsd ?? 0
    results.push({
      toolId,
      invocations: counts.invocations,
      successCount: counts.successCount,
      failureCount: counts.failureCount,
      estimatedTokensSaved: counts.invocations * estTokens,
      estimatedCostSavedUsd: counts.invocations * estCostUsd
    })
  }
  return results.sort((a, b) => b.invocations - a.invocations)
}
