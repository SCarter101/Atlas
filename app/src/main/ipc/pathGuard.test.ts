import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// pathGuard.ts -> projectStore.ts calls electron's app.getPath('documents')
// to locate the "Atlas Projects" root — outside a running Electron process
// (i.e. under vitest) the 'electron' package doesn't provide { app }, so
// it's mocked here the same way promptStore.test.ts/registry.test.ts mock
// it for the same reason. vi.mock calls are hoisted above imports by
// vitest, so the static import of ./pathGuard below picks up this mock.
let documentsDir = ''
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'documents') return documentsDir
      throw new Error(`unexpected app.getPath(${name}) in test`)
    }
  }
}))

const { assertWithinProjectsRoot } = await import('./pathGuard')

describe('assertWithinProjectsRoot', () => {
  beforeEach(() => {
    documentsDir = join('C:', 'fake-documents-root')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('allows a real project path inside the Atlas Projects folder', () => {
    const projectPath = join(documentsDir, 'Atlas Projects', 'My Novel.atlas')
    expect(() => assertWithinProjectsRoot(projectPath)).not.toThrow()
  })

  it('allows a nested path inside the Atlas Projects folder', () => {
    const nestedPath = join(documentsDir, 'Atlas Projects', 'My Novel.atlas', 'manuscript', 'scene.md')
    expect(() => assertWithinProjectsRoot(nestedPath)).not.toThrow()
  })

  it('rejects a path outside the Atlas Projects folder (e.g. a bug-supplied sibling path)', () => {
    const outsidePath = join(documentsDir, 'Some Other Folder', 'not-a-project')
    expect(() => assertWithinProjectsRoot(outsidePath)).toThrow(/outside the Atlas Projects folder/i)
  })

  it('rejects a `..`-traversal attempt out of the Atlas Projects folder', () => {
    const traversalPath = join(documentsDir, 'Atlas Projects', '..', '..', 'Windows', 'System32')
    expect(() => assertWithinProjectsRoot(traversalPath)).toThrow(/outside the Atlas Projects folder/i)
  })

  it('rejects the Atlas Projects root folder itself, not just paths outside it', () => {
    const rootItself = join(documentsDir, 'Atlas Projects')
    expect(() => assertWithinProjectsRoot(rootItself)).toThrow(/outside the Atlas Projects folder/i)
  })

  it('rejects a junction inside Atlas Projects that actually points outside it (Codex adversarial-review finding, Round 10/Phase 9)', () => {
    // Real filesystem I/O, not the fake mocked documentsDir above — a
    // junction needs somewhere real to point through. Skips cleanly if
    // junction creation isn't permitted in this environment rather than
    // failing the whole suite over an environment limitation unrelated to
    // the guard logic itself.
    const realRoot = mkdtempSync(join(tmpdir(), 'atlas-pathguard-real-'))
    documentsDir = realRoot
    const projectsRoot = join(realRoot, 'Atlas Projects')
    mkdirSync(projectsRoot, { recursive: true })
    const outsideTarget = mkdtempSync(join(tmpdir(), 'atlas-pathguard-outside-'))
    const junctionPath = join(projectsRoot, 'linked.atlas')

    try {
      symlinkSync(outsideTarget, junctionPath, 'junction')
    } catch {
      rmSync(realRoot, { recursive: true, force: true })
      rmSync(outsideTarget, { recursive: true, force: true })
      return // junction creation unavailable in this environment — nothing to assert
    }

    try {
      expect(() => assertWithinProjectsRoot(junctionPath)).toThrow(/outside the Atlas Projects folder/i)
    } finally {
      rmSync(realRoot, { recursive: true, force: true })
      rmSync(outsideTarget, { recursive: true, force: true })
    }
  })

  it('throws an AtlasError with a machine-readable code for a rejected path', async () => {
    const { AtlasError } = await import('@shared/errors')
    const outsidePath = join(documentsDir, 'elsewhere')
    try {
      assertWithinProjectsRoot(outsidePath)
      expect.unreachable('expected assertWithinProjectsRoot to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(AtlasError)
      expect((err as InstanceType<typeof AtlasError>).code).toBe('PATH_OUTSIDE_PROJECTS_ROOT')
    }
  })
})
