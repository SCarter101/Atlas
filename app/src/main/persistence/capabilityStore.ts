import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CapabilityManifest, CapabilityType } from '@shared/schema/capability'
import { migrateRecord } from './migrations'
import { projectPaths } from './paths'

const TYPE_DIR: Record<CapabilityType, string> = { tool: 'tools', skill: 'skills' }

// Global vs. project scope is tracked on the manifest itself
// (CapabilityManifest.scope). This module still only knows about the
// project-scoped capabilities/ folder — the real global user-data directory
// is main/capabilities/registry.ts's concern (see data-contracts §8) — but
// its directory-walking/writing logic is factored out below (listManifestsFrom/
// writeManifestTo) so registry.ts can reuse it against an arbitrary
// capabilities directory (a project's, or the real global one) instead of
// duplicating the walk — see registry.ts's listCapabilities().
export async function listManifestsFrom(capabilitiesDir: string): Promise<CapabilityManifest[]> {
  const manifests: CapabilityManifest[] = []

  for (const typeDir of Object.values(TYPE_DIR)) {
    const dirPath = join(capabilitiesDir, typeDir)
    const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const manifestPath = join(dirPath, entry.name, 'manifest.json')
      const raw = await readFile(manifestPath, 'utf-8').catch(() => null)
      if (raw) manifests.push(migrateRecord('CapabilityManifest', JSON.parse(raw) as CapabilityManifest))
    }
  }

  return manifests
}

export async function listCapabilityManifests(projectRoot: string): Promise<CapabilityManifest[]> {
  const manifests = await listManifestsFrom(projectPaths(projectRoot).capabilitiesDir)
  return manifests.sort((a, b) => a.name.localeCompare(b.name))
}

// Write-side counterpart to listManifestsFrom() — factored out for the same
// reason (registry.ts writes into the global directory too).
export async function writeManifestTo(capabilitiesDir: string, manifest: CapabilityManifest): Promise<void> {
  const dirPath = join(capabilitiesDir, TYPE_DIR[manifest.type], manifest.id)
  await mkdir(dirPath, { recursive: true })
  await writeFile(join(dirPath, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
}

export async function writeCapabilityManifest(projectRoot: string, manifest: CapabilityManifest): Promise<void> {
  await writeManifestTo(projectPaths(projectRoot).capabilitiesDir, manifest)
}
