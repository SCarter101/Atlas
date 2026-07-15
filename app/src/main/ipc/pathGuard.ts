import { isAbsolute, relative, resolve } from 'node:path'
import { AtlasError } from '@shared/errors'
import { projectsRootDir } from '../persistence/projectStore'

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
  const root = resolve(projectsRootDir())
  const resolved = resolve(candidatePath)
  const rel = relative(root, resolved)
  const isInsideRoot = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  if (!isInsideRoot) {
    throw new AtlasError(
      `Refusing to operate on a project path outside the Atlas Projects folder: ${candidatePath}`,
      'PATH_OUTSIDE_PROJECTS_ROOT'
    )
  }
}
