// Pure field-level diff for CapabilityManifest version history — the
// registry.ts/Library.tsx analog of shared/codexLogic.ts's dependency-free
// pattern (see that file's header comment): kept free of node:fs/node:crypto
// so the renderer (contextIsolation/nodeIntegration disabled) can import it
// directly instead of needing a round-trip IPC call just to diff two
// manifests it already has in hand.
import type { CapabilityManifest } from './schema/capability'

export interface CapabilityFieldDiff {
  field: string
  before: unknown
  after: unknown
}

// A reasonable subset of "meaningful" fields — the ones a writer reviewing a
// rollback/promotion would actually care about, rather than every bookkeeping
// field (schemaVersion, history itself, timestamps that are never on this
// type, etc.).
const COMPARABLE_FIELDS: (keyof CapabilityManifest)[] = [
  'name',
  'description',
  'inputSchema',
  'outputSchema',
  'sideEffects',
  'permissionCategory',
  'lifecycleState',
  'dependsOn'
]

function fieldsDiffer(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b)
}

// Diffs a history entry's snapshot (the manifest's state right before that
// entry's change) against the current manifest. Both manifests are assumed
// already in hand by the caller (Library.tsx already fetched the full
// capability list) — no IPC channel exists for this on purpose.
export function compareCapabilityVersions(manifestNow: CapabilityManifest, versionId: string): CapabilityFieldDiff[] {
  const entry = manifestNow.history.find((h) => h.versionId === versionId)
  if (!entry) {
    throw new Error(`No history entry with versionId "${versionId}" found on capability "${manifestNow.id}".`)
  }
  if (!entry.snapshot) {
    throw new Error('This version predates snapshot support and cannot be compared.')
  }

  const snapshot = entry.snapshot
  const diffs: CapabilityFieldDiff[] = []
  for (const field of COMPARABLE_FIELDS) {
    const before = snapshot[field]
    const after = manifestNow[field]
    if (fieldsDiffer(before, after)) {
      diffs.push({ field, before, after })
    }
  }
  return diffs
}
