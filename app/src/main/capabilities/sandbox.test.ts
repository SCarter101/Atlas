import { describe, expect, it } from 'vitest'
import { runSandboxed, type SandboxedTool } from './sandbox'

describe('runSandboxed', () => {
  it('runs a passing tool and returns its output', async () => {
    const tool: SandboxedTool = {
      manifestId: 'test.double',
      run: (input: unknown) => ({ doubled: (input as { n: number }).n * 2 })
    }

    const { output, error } = await runSandboxed(tool, { n: 21 })
    expect(error).toBeUndefined()
    expect(output).toEqual({ doubled: 42 })
  })

  it('captures a synchronous throw as a structured sandbox-error', async () => {
    const tool: SandboxedTool = {
      manifestId: 'test.throws',
      run: () => {
        throw new Error('boom')
      }
    }

    const { output, error } = await runSandboxed(tool, {})
    expect(output).toBeUndefined()
    expect(error).toBeDefined()
    expect(error!.code).toBe('sandbox-error')
    expect(error!.message).toContain('boom')
    expect(error!.recoverable).toBe(true)
  })

  it('kills a genuinely infinite synchronous loop via the timeout', async () => {
    const tool: SandboxedTool = {
      manifestId: 'test.infinite-loop',
      run: () => {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          // spin forever — proves runInContext's timeout actually bounds
          // execution rather than just compiling.
        }
      }
    }

    const { output, error } = await runSandboxed(tool, {}, 200)
    expect(output).toBeUndefined()
    expect(error).toBeDefined()
    expect(error!.code).toBe('sandbox-timeout')
    expect(error!.recoverable).toBe(true)
  }, 5000)

  it('gives the sandboxed function no ambient access to require/process', async () => {
    const tool: SandboxedTool = {
      manifestId: 'test.ambient-access',
      run: () => {
        // Probing for ambient globals that must not exist inside the vm
        // context — `typeof` on an unbound identifier is safe (no throw).
        return { hasRequire: typeof require !== 'undefined', hasProcess: typeof process !== 'undefined' }
      }
    }

    const { output, error } = await runSandboxed(tool, {})
    expect(error).toBeUndefined()
    expect(output).toEqual({ hasRequire: false, hasProcess: false })
  })
})
