import { createContext, Script } from 'node:vm'
import type { AgentError } from '@shared/schema/agent'

// A registry of actual JS functions (see seedTools.ts) keyed by capability
// id — NOT arbitrary user-submitted code loaded from disk (there is no
// code-authoring UI in this build). "Sandboxing" here means: a bound
// execution time, structured error capture, and no ambient access to
// require/fs/process/global from within the executed function body.
export interface SandboxedTool {
  manifestId: string
  run: (input: unknown) => unknown
}

// vm.Script#runInContext's `timeout` option only bounds *synchronous*
// execution — if `tool.run` were async, an awaited promise inside it would
// not be bounded by this timeout at all. Every seed tool in seedTools.ts is
// deliberately a plain synchronous, pure function (no I/O — any I/O, e.g.
// ensureIndexed()/listCodexEntries(), happens in the calling code before
// entering the sandbox, with only the already-fetched data passed in as
// `input`) so the timeout is actually meaningful here. A genuinely async
// tool would need a Worker-thread-based sandbox instead — out of scope.
export async function runSandboxed(
  tool: SandboxedTool,
  input: unknown,
  timeoutMs = 2000
): Promise<{ output?: unknown; error?: AgentError }> {
  try {
    const context = createContext({})
    ;(context as Record<string, unknown>).__input__ = input
    const script = new Script(`(${tool.run.toString()})(__input__)`)
    const output = script.runInContext(context, { timeout: timeoutMs })
    return { output }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const isTimeout = /timed out/i.test(message)
    return {
      error: {
        code: isTimeout ? 'sandbox-timeout' : 'sandbox-error',
        message,
        recoverable: true
      }
    }
  }
}
