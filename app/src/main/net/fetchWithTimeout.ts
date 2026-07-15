// Round 10 / Phase 9 Track C (performance): a bare `fetch(...)` to a local
// LM Studio port has no timeout at all, so when nothing is listening there
// the connection attempt can hang for a long time before the runtime gives
// up and rejects — observed at 20+ seconds on Windows for `fetch()` against
// an unlistened localhost port (a real E2E finding, not a guess: Windows
// doesn't always deliver an instant RST/ECONNREFUSED the way POSIX loopback
// stacks typically do). Every LM Studio call (chat completions in
// agent/providers/lmStudioAdapter.ts, embeddings in
// retrieval/embeddings/lmStudioEmbeddingAdapter.ts) sits directly in the
// critical path of an agent run or a summary/embedding pass via
// assembleContext() -> search()/summaryStore.ts, so one un-timed-out probe
// can stall a writer-facing action for many seconds even though "LM Studio
// isn't running" is the overwhelmingly common case (no configurability UI
// exists yet, so every install probes the same hardcoded port whether or
// not the writer uses LM Studio at all).
//
// This wraps `fetch` with an AbortController-driven timeout and normalizes
// an abort into the same thrown shape as any other network failure, so
// existing `catch { ... }` blocks in both adapters (which already treat any
// thrown fetch as "unreachable") don't need to special-case abort errors.
export async function fetchWithTimeout(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
