import { createContext, Script } from 'node:vm'
import type { AgentError } from '@shared/schema/agent'

// A registry of actual JS functions (see seedTools.ts) keyed by capability
// id — NOT arbitrary user-submitted code loaded from disk (there is no
// code-authoring UI in this build). "Sandboxing" here means: a bound
// execution time, structured error capture, and no ambient access to
// require/fs/process/global from within the executed function body.
//
// ACCEPTED LIMITATION (documented, not fixed — see CLAUDE.md's Round 7
// precedent for "document rather than over-engineer an accepted-risk
// finding"): `vm.createContext({})` does NOT defend against the classic
// node:vm sandbox-escape vector, e.g. a function body that reaches
// `({}).constructor.constructor('return process')()` to walk the prototype
// chain back to the real `Function` constructor and compile/run arbitrary
// code with full ambient access, sidestepping the "no require/fs/process"
// property claimed above entirely. A hardened sandbox against that class of
// attack needs a fundamentally different primitive (e.g. `vm2` or
// `isolated-vm`, both real dependencies with their own maintenance/API
// surface) — deliberately out of scope for this pass. The threat model here
// doesn't call for it: every `SandboxedTool` is either a hardcoded seed tool
// shipped with the app (seedTools.ts) or, in a future capability-authoring
// UI, code the writer themselves typed in — not adversarial remote content
// an attacker controls. If Atlas ever imports/executes a *capability*
// authored by someone other than the app or its own user (e.g. a shared/
// downloaded capability marketplace), this limitation would need to be
// revisited before that lands.
export interface SandboxedTool {
  manifestId: string
  run: (input: unknown) => unknown
}

// vm.Script#runInContext's `timeout` option only bounds *synchronous*
// execution — if `tool.run` is (or ever becomes) async, `runInContext`
// returns almost immediately with a pending Promise, and everything the
// function does after its first `await` runs on Node's own microtask queue,
// completely outside the vm's timeout. Every seed tool in seedTools.ts is
// today a plain synchronous, pure function (no I/O — any I/O, e.g.
// ensureIndexed()/listCodexEntries(), happens in the calling code before
// entering the sandbox, with only the already-fetched data passed in as
// `input`), so this was previously safe in practice. It's still a real gap
// in the contract `SandboxedTool.run` exposes (nothing stops a future tool
// from being declared `async`), so below we explicitly race whatever comes
// back from the vm against a second, real timeout that actually rejects —
// a hung async tool can no longer block the caller indefinitely, even
// though (per the comment on `SandboxedTool` above) it also can't be force-
// killed mid-flight without a Worker-thread-based sandbox, which is out of
// scope here.
export async function runSandboxed(
  tool: SandboxedTool,
  input: unknown,
  timeoutMs = 2000
): Promise<{ output?: unknown; error?: AgentError }> {
  try {
    const context = createContext({})
    ;(context as Record<string, unknown>).__input__ = input
    const script = new Script(`(${tool.run.toString()})(__input__)`)
    const rawOutput = script.runInContext(context, { timeout: timeoutMs })
    const output = isThenable(rawOutput) ? await raceAgainstTimeout(rawOutput, timeoutMs) : rawOutput
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

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function'
}

// A real Promise.race against a timer that rejects — unlike
// `runInContext`'s own `timeout` option, this bounds *elapsed wall-clock
// time* regardless of whether the tool's promise is stuck on I/O, a timer,
// or anything else. The message deliberately matches the `/timed out/i`
// check above so an async-tool timeout is classified as `sandbox-timeout`
// the same way a synchronous-loop timeout already is.
function raceAgainstTimeout<T>(promise: PromiseLike<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Sandboxed tool timed out after ${timeoutMs}ms (async)`))
    }, timeoutMs)
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}
