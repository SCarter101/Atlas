import { rmSync } from 'node:fs'

// Test cleanup for a temp project/userData directory, retrying past a real
// (not hypothetical) race: several persistence stores (usageStore,
// promptStore, revisionStore, sessionStore, ...) do fire-and-forget or
// otherwise timing-sensitive fs writes as part of normal operation. A test
// that awaits its own operation and immediately tears down its temp dir can
// still race a write still in flight underneath it: Node's recursive
// `rmSync` snapshots a directory's entries via readdir, deletes each one,
// then rmdirs it, so a file created after the snapshot (or mid-delete)
// causes an ENOTEMPTY on Windows. This was previously seen as an occasional
// flake in local runs of one file; a slower/more-contended CI Windows
// runner hits it far more reliably, across every test file that does real
// fs-backed work. Retrying with a short backoff is simpler and less invasive
// than adding a synchronization point to each store's own write path.
export function cleanupTestDir(path: string, attempts = 5): void {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      rmSync(path, { recursive: true, force: true })
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (attempt === attempts || (code !== 'ENOTEMPTY' && code !== 'EBUSY' && code !== 'EPERM')) {
        throw err
      }
      const deadline = Date.now() + 25 * attempt
      while (Date.now() < deadline) {
        // Deliberately synchronous busy-wait: this runs inside a
        // (non-async) afterEach/afterAll hook in most call sites, so an
        // async delay would require converting every hook to async just
        // for a ~25-125ms total backoff window.
      }
    }
  }
}
