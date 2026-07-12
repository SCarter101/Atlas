import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CapabilityManifest, CapabilityType } from '@shared/schema/capability'
import { projectPaths } from './paths'

const TYPE_DIR: Record<CapabilityType, string> = { tool: 'tools', skill: 'skills' }

// Read-only sample Tool & Skill Library — spec §15 Phase 2 scope. Global vs.
// project scope is tracked on the manifest itself (CapabilityManifest.scope);
// for this build both live under the project's capabilities/ folder rather
// than a separate global user-data store, since the distinction only needs
// to be visible in the UI right now, not enforced as a real storage
// boundary yet (that's a Phase 3+ concern — see data-contracts §8).
export async function listCapabilityManifests(projectRoot: string): Promise<CapabilityManifest[]> {
  const capabilitiesDir = projectPaths(projectRoot).capabilitiesDir
  const manifests: CapabilityManifest[] = []

  for (const typeDir of Object.values(TYPE_DIR)) {
    const dirPath = join(capabilitiesDir, typeDir)
    const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const manifestPath = join(dirPath, entry.name, 'manifest.json')
      const raw = await readFile(manifestPath, 'utf-8').catch(() => null)
      if (raw) manifests.push(JSON.parse(raw) as CapabilityManifest)
    }
  }

  return manifests.sort((a, b) => a.name.localeCompare(b.name))
}

export async function writeCapabilityManifest(projectRoot: string, manifest: CapabilityManifest): Promise<void> {
  const dirPath = join(projectPaths(projectRoot).capabilitiesDir, TYPE_DIR[manifest.type], manifest.id)
  await mkdir(dirPath, { recursive: true })
  await writeFile(join(dirPath, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
}
