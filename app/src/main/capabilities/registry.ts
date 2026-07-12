import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { join } from 'node:path'
import type { CapabilityManifest, LifecycleState } from '@shared/schema/capability'
import { listManifestsFrom, writeManifestTo } from '../persistence/capabilityStore'
import { projectPaths } from '../persistence/paths'

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

export async function updateCapability(projectRoot: string, manifest: CapabilityManifest): Promise<void> {
  const previous = await getCapability(projectRoot, manifest.id)
  const versionEntry = {
    versionId: randomUUID(),
    changedAt: new Date().toISOString(),
    note: previous ? buildDiffNote(previous, manifest) : 'Initial version.'
  }
  const next: CapabilityManifest = { ...manifest, history: [...manifest.history, versionEntry] }
  await writeManifestTo(targetDirFor(projectRoot, next), next)
}

export async function setLifecycleState(projectRoot: string, id: string, state: LifecycleState): Promise<void> {
  const manifest = await getCapability(projectRoot, id)
  if (!manifest) throw new Error(`Capability ${id} not found`)
  await updateCapability(projectRoot, { ...manifest, lifecycleState: state })
}
