import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { AtlasError } from '@shared/errors'
import { projectsRootDir } from '../persistence/projectStore'

// Codex adversarial-review finding (Round 10/Phase 9 closing pass): resolve()
// only does lexical path normalization — it never follows symlinks or
// Windows junctions. A junction living *inside* Atlas Projects but pointing
// *outside* it (e.g. "<Documents>\Atlas Projects\linked.atlas" -> some other
// writable directory) passed the old lexical-only check while every real
// filesystem operation on that path (including ProjectDelete's recursive
// removal) would actually operate through the link, outside the intended
// root. Walk up to the deepest existing ancestor and realpath *that* before
// comparing — realpathSync throws ENOENT on a path that doesn't exist yet
// (e.g. ProjectCreate's brand-new project folder), so the candidate itself
// can't always be realpath'd directly; rejoining the not-yet-existing tail
// onto the resolved ancestor still defeats a link on any *existing* segment
// of the path, which is the only way a junction/symlink could be present.
function resolveRealAsFarAsPossible(path: string): string {
  let current = resolve(path)
  const tailSegments: string[] = []
  for (;;) {
    try {
      const real = realpathSync(current)
      return tailSegments.length > 0 ? join(real, ...tailSegments.reverse()) : real
    } catch {
      const parent = dirname(current)
      if (parent === current) return resolve(path) // hit the filesystem root; nothing on this path exists
      tailSegments.push(basename(current))
      current = parent
    }
  }
}

// Atlas is single-user and local-only, and every caller of the IPC handlers
// this guards (ProjectOpen/ProjectCreate/ProjectDelete in handlers.ts) is
// this app's own first-party renderer — not remote or adversarial content.
// This guard exists as a defense against a *bug* (e.g. some future code
// path constructing/forwarding a wrong or malformed path), not an
// adversarial-user threat model. The highest-value case is ProjectDelete's
// recursive rm() in handlers.ts, which would otherwise happily delete
// whatever folder it's handed. Resolves both sides so `..`-relative
// traversal and trailing-slash/case differences can't slip past a naive
// string comparison, and deliberately treats the root directory itself
// (rel === '') as OUTSIDE — a path guard whose only job is "don't touch
// anything outside the Atlas Projects folder" shouldn't also bless deleting
// the Atlas Projects folder itself.
export function assertWithinProjectsRoot(candidatePath: string): void {
  const root = resolveRealAsFarAsPossible(projectsRootDir())
  const resolved = resolveRealAsFarAsPossible(candidatePath)
  const rel = relative(root, resolved)
  const isInsideRoot = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  if (!isInsideRoot) {
    throw new AtlasError(
      `Refusing to operate on a project path outside the Atlas Projects folder: ${candidatePath}`,
      'PATH_OUTSIDE_PROJECTS_ROOT'
    )
  }
}
