import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentRunRecord } from '@shared/schema/agent'

// telemetryStore.ts calls electron's app.getPath('userData') to locate the
// local telemetry/logs directories — outside a running Electron process
// (i.e. under vitest) the 'electron' package doesn't provide { app }, so
// it's mocked the same way main/persistence/promptStore.test.ts mocks it for
// the same reason. vi.mock calls are hoisted above imports by vitest, so the
// static import of ./telemetryStore below picks up this mock.
let userDataDir = ''
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return userDataDir
      throw new Error(`unexpected app.getPath(${name}) in test`)
    }
  }
}))

const {
  buildFeedbackBundle,
  crashLogPath,
  eventLogPath,
  getTelemetryEnabled,
  recordCrash,
  recordEvent,
  sanitizeRunTrace,
  setTelemetryEnabled
} = await import('./telemetryStore')

// A tiny helper mirroring simulator.ts's real await-the-async-write pattern:
// recordCrash() is intentionally fire-and-forget (called from a
// process.on(...) handler that must never await), so tests give its promise
// a tick to land before asserting on the file it wrote.
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10))
}

function buildRunRecordFixture(): AgentRunRecord {
  return {
    schemaVersion: 1,
    status: 'completed',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:01:00.000Z',
    goal: {
      runId: 'run-1',
      agentRole: 'Generator',
      modelRef: { provider: 'openrouter', modelId: 'test-model', viaOpenRouter: true },
      userIntent: 'SECRET_MANUSCRIPT_TEXT should never leave this scope',
      scope: { sceneIds: ['scene-1'], selectionText: 'SECRET_MANUSCRIPT_TEXT the writer selected' },
      constraints: { maxTurns: 5, maxTokens: 1000, maxToolCalls: 3, maxElapsedMs: 60000, allowedCapabilityCategories: [] }
    },
    steps: [
      {
        stepIndex: 0,
        kind: 'model-call',
        timestamp: '2026-01-01T00:00:10.000Z',
        detail: {
          modelRef: { provider: 'openrouter', modelId: 'test-model', viaOpenRouter: true },
          inputTokens: 120,
          outputTokens: 45,
          estimatedCostUsd: 0.002,
          outputText: 'SECRET_MANUSCRIPT_TEXT the model actually wrote'
        }
      },
      {
        stepIndex: 1,
        kind: 'result',
        timestamp: '2026-01-01T00:00:55.000Z',
        detail: {
          summary: 'SECRET_MANUSCRIPT_TEXT appears in the free-form summary too',
          proposedManuscriptChanges: [
            {
              id: 'sugg-1',
              agentRole: 'Generator',
              kind: 'insertion',
              targetSceneId: 'scene-1',
              payload: { text: 'SECRET_MANUSCRIPT_TEXT inserted prose' },
              provenance: { runId: 'run-1' },
              state: 'pending'
            }
          ],
          warnings: ['SECRET_MANUSCRIPT_TEXT warning text']
        }
      }
    ]
  }
}

describe('telemetryStore', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'atlas-telemetry-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  describe('crash log', () => {
    it('appends a JSON-lines crash entry with message and stack', async () => {
      recordCrash('uncaughtException', new Error('boom'))
      await flush()

      expect(existsSync(crashLogPath())).toBe(true)
      const raw = await readFile(crashLogPath(), 'utf-8')
      const lines = raw.trim().split('\n')
      expect(lines).toHaveLength(1)
      const entry = JSON.parse(lines[0])
      expect(entry.source).toBe('uncaughtException')
      expect(entry.message).toBe('boom')
      expect(entry.stack).toContain('Error: boom')
    })

    it('handles non-Error rejection reasons without throwing', async () => {
      recordCrash('unhandledRejection', 'a plain string rejection')
      await flush()

      const raw = await readFile(crashLogPath(), 'utf-8')
      const entry = JSON.parse(raw.trim().split('\n')[0])
      expect(entry.message).toBe('a plain string rejection')
      expect(entry.stack).toBeUndefined()
    })

    it('rotates crash.log to crash.log.1 once the file exceeds the size cap', async () => {
      // Seed an oversized existing log directly so the test doesn't need to
      // make thousands of real recordCrash() calls.
      const oversized = 'x'.repeat(2 * 1024 * 1024 + 1)
      await mkdir(dirname(crashLogPath()), { recursive: true })
      await writeFile(crashLogPath(), oversized, 'utf-8')

      recordCrash('uncaughtException', new Error('after rotation'))
      await flush()

      expect(existsSync(`${crashLogPath()}.1`)).toBe(true)
      const rotated = await readFile(`${crashLogPath()}.1`, 'utf-8')
      expect(rotated).toBe(oversized)

      const current = await readFile(crashLogPath(), 'utf-8')
      const entry = JSON.parse(current.trim())
      expect(entry.message).toBe('after rotation')

      const currentStat = await stat(crashLogPath())
      expect(currentStat.size).toBeLessThan(oversized.length)
    })
  })

  describe('telemetry opt-in flag', () => {
    it('defaults to disabled when no settings file exists yet', async () => {
      expect(await getTelemetryEnabled()).toBe(false)
    })

    it('persists enabling and disabling', async () => {
      await setTelemetryEnabled(true)
      expect(await getTelemetryEnabled()).toBe(true)

      await setTelemetryEnabled(false)
      expect(await getTelemetryEnabled()).toBe(false)
    })
  })

  describe('opt-in event log', () => {
    it('does not write anything when telemetry is disabled', async () => {
      await recordEvent('some_event', { count: 1 })
      expect(existsSync(eventLogPath())).toBe(false)
    })

    it('writes a structured event once telemetry is enabled', async () => {
      await setTelemetryEnabled(true)
      await recordEvent('feedback_bundle_exported')

      const raw = await readFile(eventLogPath(), 'utf-8')
      const entry = JSON.parse(raw.trim().split('\n')[0])
      expect(entry.name).toBe('feedback_bundle_exported')
      expect(typeof entry.timestamp).toBe('string')
    })
  })

  describe('sanitizeRunTrace', () => {
    it('keeps only structural metadata and drops every field capable of holding manuscript prose', () => {
      const sanitized = sanitizeRunTrace(buildRunRecordFixture())
      const serialized = JSON.stringify(sanitized)

      expect(serialized).not.toContain('SECRET_MANUSCRIPT_TEXT')
      expect(sanitized.runId).toBe('run-1')
      expect(sanitized.agentRole).toBe('Generator')
      expect(sanitized.status).toBe('completed')

      const modelCallStep = sanitized.steps.find((s) => s.kind === 'model-call')
      expect(modelCallStep?.meta).toEqual({
        provider: 'openrouter',
        modelId: 'test-model',
        inputTokens: 120,
        outputTokens: 45,
        estimatedCostUsd: 0.002
      })

      const resultStep = sanitized.steps.find((s) => s.kind === 'result')
      expect(resultStep?.meta).toEqual({
        manuscriptChangeCount: 1,
        codexChangeCount: 0,
        citationCount: 0,
        warningCount: 1
      })
    })
  })

  describe('buildFeedbackBundle', () => {
    it('produces a real zip with app info, run traces, and no manuscript prose anywhere inside', async () => {
      recordCrash('uncaughtException', new Error('a real crash, no prose in it'))
      await flush()
      await setTelemetryEnabled(true)
      await recordEvent('app_launched')

      const sanitizedTrace = sanitizeRunTrace(buildRunRecordFixture())
      const buffer = await buildFeedbackBundle({
        appVersion: '0.1.0',
        electronVersion: '33.2.1',
        platform: 'win32',
        osRelease: '10.0.26200',
        telemetryEnabled: true,
        runTraces: [sanitizedTrace]
      })

      // Real zip, not a stub — verify via the actual PK magic bytes.
      expect(buffer.subarray(0, 2).toString('utf-8')).toBe('PK')

      const zip = await JSZip.loadAsync(buffer)
      expect(zip.file('app-info.json')).not.toBeNull()
      expect(zip.file('run-traces.json')).not.toBeNull()
      expect(zip.file('README.txt')).not.toBeNull()
      expect(zip.file('crash.log')).not.toBeNull()
      expect(zip.file('events.log')).not.toBeNull()

      const appInfo = JSON.parse(await zip.file('app-info.json')!.async('string'))
      expect(appInfo.appVersion).toBe('0.1.0')
      expect(appInfo.telemetryEnabled).toBe(true)

      // Concatenate every file's contents and assert the redaction marker
      // never appears anywhere in the whole bundle, not just run-traces.json.
      const allFileNames = Object.keys(zip.files)
      const allContents = await Promise.all(allFileNames.map((name) => zip.file(name)!.async('string')))
      expect(allContents.join('\n')).not.toContain('SECRET_MANUSCRIPT_TEXT')
    })

    it('omits log files entirely when nothing has been written yet', async () => {
      const buffer = await buildFeedbackBundle({
        appVersion: '0.1.0',
        electronVersion: '33.2.1',
        platform: 'win32',
        osRelease: '10.0.26200',
        telemetryEnabled: false,
        runTraces: []
      })

      const zip = await JSZip.loadAsync(buffer)
      expect(zip.file('crash.log')).toBeNull()
      expect(zip.file('events.log')).toBeNull()
      expect(zip.file('app-info.json')).not.toBeNull()
    })
  })
})
