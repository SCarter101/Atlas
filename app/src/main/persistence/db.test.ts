import { describe, expect, it, vi } from 'vitest'
import { withBatchedPersist, type AtlasDb } from './db'

// withBatchedPersist doesn't touch `db` at all — only `.persist` — so a
// minimal fake satisfies every real call site's needs for this test.
function fakeAtlasDb(): AtlasDb {
  let calls = 0
  const persist = vi.fn(() => {
    calls += 1
  })
  return { db: {} as AtlasDb['db'], persist } as AtlasDb & { persist: typeof persist }
}

describe('withBatchedPersist', () => {
  it('calls persist exactly once for a single batch that wrote something', async () => {
    const atlasDb = fakeAtlasDb()
    const realPersist = atlasDb.persist
    await withBatchedPersist(atlasDb, () => {
      atlasDb.persist() // simulates an upsert* helper calling persist mid-batch
    })
    expect(realPersist).toHaveBeenCalledTimes(1)
    expect(atlasDb.persist).toBe(realPersist)
  })

  it('does not call persist at all if nothing was written in the batch', async () => {
    const atlasDb = fakeAtlasDb()
    const realPersist = atlasDb.persist
    await withBatchedPersist(atlasDb, () => {
      // no writes
    })
    expect(realPersist).not.toHaveBeenCalled()
  })

  // Codex adversarial-review finding (Round 10/Phase 9 closing pass): the
  // original implementation captured/restored atlasDb.persist directly,
  // which corrupted state across overlapping batches on the same AtlasDb —
  // this reproduces exactly the interleaving Codex described (batch A
  // starts, batch B starts before A finishes, A finishes first, then B) and
  // asserts the real persist function survives intact afterward, and that a
  // write made only during the *outer* batch's window still gets persisted.
  it('survives overlapping batches on the same AtlasDb without permanently disabling persist', async () => {
    const atlasDb = fakeAtlasDb()
    const realPersist = atlasDb.persist

    let resolveAFirstStep: () => void
    const aFirstStepDone = new Promise<void>((resolve) => {
      resolveAFirstStep = resolve
    })
    let resolveBStarted: () => void
    const bStarted = new Promise<void>((resolve) => {
      resolveBStarted = resolve
    })

    const batchA = withBatchedPersist(atlasDb, async () => {
      atlasDb.persist() // A writes something
      resolveAFirstStep()
      await bStarted // wait until B has installed its own wrapper
      // A finishes here, before B does
    })

    await aFirstStepDone
    const batchB = withBatchedPersist(atlasDb, async () => {
      atlasDb.persist() // B writes something
      resolveBStarted()
      // let A's finally run before B's
      await new Promise((r) => setTimeout(r, 10))
    })

    await Promise.all([batchA, batchB])

    // The real persist function must be restored exactly once real
    // (not left as some inner batch's no-op), and both writes must have
    // resulted in exactly one real flush (both batches together stay
    // reentrant, so only the outermost restores/flushes).
    expect(atlasDb.persist).toBe(realPersist)
    expect(realPersist).toHaveBeenCalledTimes(1)

    // Prove persist is genuinely live again, not permanently stuck as a
    // no-op — a subsequent ordinary (non-batched) call must reach the real
    // function.
    atlasDb.persist()
    expect(realPersist).toHaveBeenCalledTimes(2)
  })
})
