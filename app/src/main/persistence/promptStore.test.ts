import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// promptStore.ts calls electron's app.getPath('userData') to locate the
// global prompts directory — outside a running Electron process (i.e. under
// vitest) the 'electron' package doesn't provide { app }, so it's mocked
// here the same way main/capabilities/registry.test.ts mocks it for the
// same reason. vi.mock calls are hoisted above imports by vitest, so the
// static import of ./promptStore below picks up this mock.
let userDataDir = ''
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return userDataDir
      throw new Error(`unexpected app.getPath(${name}) in test`)
    }
  }
}))

const { getActivePrompt, listPromptHistory, resetPrompt, setPrompt } = await import('./promptStore')

describe('promptStore', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'atlas-prompt-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('returns the seed default when no record exists yet on disk', async () => {
    const result = await getActivePrompt('Generator')
    expect(result.version).toBe('1.2')
    expect(result.text).toContain('You are Generator')
  })

  it('persists a new version on setPrompt and returns it from getActivePrompt afterward', async () => {
    const setResult = await setPrompt('Line-Editor', 'Custom line-editor prompt.')
    expect(setResult.version).toBe('1.4') // default Line-Editor version is 1.3

    const getResult = await getActivePrompt('Line-Editor')
    expect(getResult.text).toBe('Custom line-editor prompt.')
    expect(getResult.version).toBe('1.4')
  })

  it('appends the overwritten version to history on setPrompt', async () => {
    await setPrompt('Dialoguer', 'First edit.')
    await setPrompt('Dialoguer', 'Second edit.')

    const history = await listPromptHistory('Dialoguer')
    expect(history).toHaveLength(2)
    expect(history[0].version).toBe('1.1') // original default (Phase 8 bump)
    expect(history[0].text).toContain('You are Dialogue Editor')
    expect(history[1].version).toBe('1.2')
    expect(history[1].text).toBe('First edit.')
  })

  it('resetPrompt restores the seed default and logs the overwritten version to history', async () => {
    await setPrompt('World-Builder', 'A custom world-builder prompt.')
    const resetResult = await resetPrompt('World-Builder')

    expect(resetResult.version).toBe('1.2') // default World-Builder version (Phase 8 bump)
    expect(resetResult.text).toContain('You are World Builder')

    const getResult = await getActivePrompt('World-Builder')
    expect(getResult.text).toBe(resetResult.text)
    expect(getResult.version).toBe(resetResult.version)

    const history = await listPromptHistory('World-Builder')
    expect(history).toHaveLength(2)
    expect(history[1].version).toBe('1.3') // the custom edit's version, overwritten by reset
    expect(history[1].text).toBe('A custom world-builder prompt.')
  })

  it('keeps per-role records independent', async () => {
    await setPrompt('Generator', 'Generator override.')
    const devEditorResult = await getActivePrompt('Dev-Editor')
    expect(devEditorResult.text).toContain('You are Story Editor')
    expect(devEditorResult.version).toBe('1.0')
  })
})
