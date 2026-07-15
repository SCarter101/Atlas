import { app } from 'electron'
import { mkdir, readFile, rename, rm, stat, writeFile, appendFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import JSZip from 'jszip'
import type {
  AgentResult,
  AgentRole,
  AgentRunRecord,
  AgentRunStatus,
  AgentStep,
  AgentStepKind,
  ModelCallSummary,
  PermissionRequest,
  SkillInvocation,
  ToolCall
} from '@shared/schema/agent'

// Round 10 / Phase 9, Track E — LOCAL-ONLY crash reporting, opt-in local
// telemetry, and an in-app feedback channel. There is no external
// crash-reporting or telemetry service wired up anywhere in this build (no
// Sentry-alike, no analytics backend) — every function in this module reads
// and writes plain files under this OS user's Electron `userData` directory
// and NEVER makes a network call. This mirrors the "honest placeholder"
// convention `shared/mcp.ts` established (illustrative/not connected,
// clearly labeled) rather than inventing a fake endpoint to post to. A
// writer who wants to actually report a problem uses "Save feedback
// bundle…" in Settings and attaches the resulting zip to an email or a
// GitHub issue themselves.

/** Bounded local debug logs, not a long-term audit trail — a single rotation is enough to keep them from growing unbounded. */
const MAX_LOG_BYTES = 2 * 1024 * 1024 // 2 MB

/** Cap on stack-trace length recorded per crash entry — avoids one pathological error blowing through the rotation cap in a single write. */
const MAX_STACK_CHARS = 4000

/** Cap on how many recent agent runs get folded into a feedback bundle, so a long-lived, very active project doesn't balloon the export. */
const MAX_RUN_TRACES = 20

function telemetryRootDir(): string {
  return join(app.getPath('userData'), 'atlas', 'telemetry')
}

function logsDir(): string {
  return join(app.getPath('userData'), 'atlas', 'logs')
}

export function crashLogPath(): string {
  return join(logsDir(), 'crash.log')
}

export function eventLogPath(): string {
  return join(telemetryRootDir(), 'events.log')
}

function telemetrySettingsPath(): string {
  return join(telemetryRootDir(), 'settings.json')
}

interface TelemetrySettings {
  enabled: boolean
}

async function appendToRotatingLog(filePath: string, line: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  try {
    const stats = await stat(filePath)
    if (stats.size > MAX_LOG_BYTES) {
      // Keep exactly one previous rotation (crash.log -> crash.log.1),
      // overwriting any older one — this is a bounded local debug log, not
      // an archive, so unbounded history isn't the goal here.
      await rm(`${filePath}.1`, { force: true }).catch(() => undefined)
      await rename(filePath, `${filePath}.1`)
    }
  } catch {
    // File doesn't exist yet — nothing to rotate on the first write.
  }
  await appendFile(filePath, line, 'utf-8')
}

async function readLogFileSafe(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined
}

/**
 * Appends one crash entry to the local, rotating `crash.log`. Called
 * directly from main/index.ts's `process.on('uncaughtException'/
 * 'unhandledRejection', ...)` handlers, which must never throw or block —
 * this is fire-and-forget by design (the caller does not await it) and
 * swallows its own write failures rather than risking a second unhandled
 * rejection inside an error handler.
 */
export function recordCrash(source: 'uncaughtException' | 'unhandledRejection', error: unknown): void {
  const entry = {
    timestamp: new Date().toISOString(),
    source,
    message: errorMessage(error),
    stack: errorStack(error)?.slice(0, MAX_STACK_CHARS)
  }
  void appendToRotatingLog(crashLogPath(), `${JSON.stringify(entry)}\n`).catch((writeErr) => {
    console.error('[telemetry] failed to write crash log', writeErr)
  })
}

/** Off by default — this is opt-in local telemetry, never on unless the writer explicitly turns it on in Settings. */
export async function getTelemetryEnabled(): Promise<boolean> {
  try {
    const raw = await readFile(telemetrySettingsPath(), 'utf-8')
    const parsed = JSON.parse(raw) as TelemetrySettings
    return parsed.enabled === true
  } catch {
    return false
  }
}

export async function setTelemetryEnabled(enabled: boolean): Promise<void> {
  await mkdir(telemetryRootDir(), { recursive: true })
  const settings: TelemetrySettings = { enabled }
  await writeFile(telemetrySettingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
}

/**
 * Records one structured local event to `events.log`, but only when the
 * writer has opted in (see getTelemetryEnabled/setTelemetryEnabled) — a
 * no-op otherwise. NOT connected to any real backend: this is a local file
 * write only, exactly like recordCrash above, never a network call. `data`
 * is caller-supplied and must never include manuscript prose or other
 * project content — every call site in this codebase only ever passes
 * small structural facts (e.g. "a feedback bundle was exported").
 */
export async function recordEvent(name: string, data?: Record<string, unknown>): Promise<void> {
  if (!(await getTelemetryEnabled())) return
  const entry = { timestamp: new Date().toISOString(), name, data: data ?? {} }
  await appendToRotatingLog(eventLogPath(), `${JSON.stringify(entry)}\n`)
}

// --- Sanitized agent-run traces for the feedback bundle -------------------
//
// AgentRunRecord (shared/schema/agent.ts) routinely carries real manuscript
// prose: ModelCallSummary.outputText is a model's actual completion,
// AgentResult.proposedManuscriptChanges[].payload can hold generated prose
// or tracked-change text, and AgentGoal.scope.selectionText / userIntent can
// quote the writer's own selection. None of that belongs in a bundle meant
// to be attached to an email or a public GitHub issue. sanitizeRunTrace()
// keeps only structural metadata — timestamps, agent role, run status,
// token/cost counts, error codes/booleans, and counts of proposed
// changes — and deliberately drops every field capable of holding prose.

export interface SanitizedStep {
  stepIndex: number
  kind: AgentStepKind
  timestamp: string
  meta: Record<string, unknown>
}

export interface SanitizedRunTrace {
  runId: string
  agentRole: AgentRole
  status: AgentRunStatus
  startedAt: string
  endedAt?: string
  steps: SanitizedStep[]
}

function sanitizeStepDetail(step: AgentStep): Record<string, unknown> {
  switch (step.kind) {
    case 'tool-call': {
      const detail = step.detail as ToolCall
      return { toolId: detail.toolId, hasError: Boolean(detail.error), errorCode: detail.error?.code }
    }
    case 'skill-invoke': {
      const detail = step.detail as SkillInvocation
      return { skillId: detail.skillId }
    }
    case 'permission-request': {
      const detail = step.detail as PermissionRequest
      return { capabilityId: detail.capabilityId, actionType: detail.actionType, decision: detail.decision }
    }
    case 'model-call': {
      const detail = step.detail as ModelCallSummary
      // Deliberately omits outputText and assembledContext — both can
      // contain real manuscript prose or Codex content.
      return {
        provider: detail.modelRef.provider,
        modelId: detail.modelRef.modelId,
        inputTokens: detail.inputTokens,
        outputTokens: detail.outputTokens,
        estimatedCostUsd: detail.estimatedCostUsd
      }
    }
    case 'result': {
      const detail = step.detail as AgentResult
      // Deliberately omits summary, nextSteps, citations text, and every
      // suggestion payload — those routinely contain manuscript prose.
      return {
        manuscriptChangeCount: detail.proposedManuscriptChanges?.length ?? 0,
        codexChangeCount: detail.proposedCodexChanges?.length ?? 0,
        citationCount: detail.citations?.length ?? 0,
        warningCount: detail.warnings?.length ?? 0
      }
    }
    case 'plan':
    default:
      return {}
  }
}

export function sanitizeRunTrace(record: AgentRunRecord): SanitizedRunTrace {
  return {
    runId: record.goal.runId,
    agentRole: record.goal.agentRole,
    status: record.status,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    steps: record.steps.map((step) => ({
      stepIndex: step.stepIndex,
      kind: step.kind,
      timestamp: step.timestamp,
      meta: sanitizeStepDetail(step)
    }))
  }
}

/** Caller-side cap helper — keeps the "most recent N runs" decision out of this module's own responsibility (file I/O + sanitizing), matching how the caller in main/ipc/handlers.ts already has the run index in hand. */
export function capRunTraces(traces: SanitizedRunTrace[]): SanitizedRunTrace[] {
  return traces.slice(0, MAX_RUN_TRACES)
}

// --- Feedback bundle -------------------------------------------------------

export interface FeedbackBundleInput {
  appVersion: string
  electronVersion: string
  platform: string
  osRelease: string
  telemetryEnabled: boolean
  runTraces: SanitizedRunTrace[]
}

const FEEDBACK_README = `This zip was generated locally by Atlas — nothing in this build has ever transmitted
it anywhere. It contains:

  - app-info.json     App/OS/Electron version info and your local telemetry opt-in state.
  - run-traces.json   Sanitized metadata for your most recent agent runs (timestamps, agent
                       role, run status, token/cost counts, error codes). Manuscript prose,
                       model output text, and suggestion content are deliberately excluded.
  - crash.log         Local crash log (error message + stack trace only, no manuscript text;
                       file paths and anything resembling an API key are redacted).
  - events.log        Local usage-event log, only present if you opted in under Settings ->
                       Telemetry & feedback. Structural events only, no manuscript text.

To actually report a problem, attach this zip to an email or a GitHub issue yourself —
Atlas has no external service to submit it to automatically.
`

// Codex adversarial-review finding (Round 10/Phase 9 closing pass):
// sanitizeRunTrace() carefully strips manuscript prose and model output from
// run traces, but recordCrash() stores arbitrary error messages/stacks
// verbatim, and buildFeedbackBundle() previously zipped crash.log/crash.log.1
// unchanged. An uncaught exception's message or stack can legitimately
// contain an absolute path with the OS username (e.g. "C:\Users\Alice\..."),
// or — if a failed network request's error message echoes back part of the
// request — text that resembles an API key/bearer token. This can't be made
// airtight for genuinely free-form error text, but the two concretely
// identifiable, common patterns are redacted before the log ever leaves the
// machine via the feedback bundle. The local crash.log file itself is left
// unredacted (it's only ever read locally, never transmitted automatically —
// see the module comment), so a writer's own troubleshooting isn't degraded.
function redactSensitiveText(text: string): string {
  // crash.log stores one JSON.stringify()'d entry per line (see
  // recordCrash() below), so every real single backslash in an original
  // Windows path is doubled in the file's raw text ("C:\Users\name" is
  // stored as the literal characters "C:\\Users\\name"). Match 1-2
  // backslashes so this works whether redaction ever runs against raw
  // in-memory text or the JSON-escaped on-disk form.
  return text
    .replace(/([A-Za-z]:\\{1,2}Users\\{1,2})[^"\\]+/g, '$1[redacted-user]')
    .replace(/(\/(?:home|Users)\/)[^/"]+/g, '$1[redacted-user]')
    .replace(/\b(sk-[A-Za-z0-9_-]{10,}|Bearer\s+[A-Za-z0-9._-]{10,}|[A-Za-z0-9_-]{32,})\b/g, '[redacted-token]')
}

export async function buildFeedbackBundle(input: FeedbackBundleInput): Promise<Buffer> {
  const zip = new JSZip()

  zip.file(
    'app-info.json',
    JSON.stringify(
      {
        appVersion: input.appVersion,
        electronVersion: input.electronVersion,
        platform: input.platform,
        osRelease: input.osRelease,
        telemetryEnabled: input.telemetryEnabled,
        generatedAt: new Date().toISOString()
      },
      null,
      2
    )
  )

  zip.file('run-traces.json', JSON.stringify(capRunTraces(input.runTraces), null, 2))
  zip.file('README.txt', FEEDBACK_README)

  const crashLog = await readLogFileSafe(crashLogPath())
  if (crashLog) zip.file('crash.log', redactSensitiveText(crashLog))
  const rotatedCrashLog = await readLogFileSafe(`${crashLogPath()}.1`)
  if (rotatedCrashLog) zip.file('crash.log.1', redactSensitiveText(rotatedCrashLog))

  const eventLog = await readLogFileSafe(eventLogPath())
  if (eventLog) zip.file('events.log', eventLog)

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

export function defaultFeedbackFileName(date: Date = new Date()): string {
  return `atlas-feedback-${date.toISOString().replace(/[:.]/g, '-')}.zip`
}
