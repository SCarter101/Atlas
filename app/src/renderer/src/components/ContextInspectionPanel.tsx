import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  AgentGoal,
  AgentStep,
  ContextSection,
  ContextSectionClass,
  ModelCallSummary,
  PermissionRequest,
  ToolCall
} from '@shared/schema/agent'
import type { CodexEntry } from '@shared/schema/codex'
import type { ChapterSummary, ContextWarning } from '@shared/schema/retrieval'

const SECTION_CLASS_LABEL: Record<ContextSectionClass, string> = {
  'chapter-summary': 'Chapter summaries',
  'scene-outline': 'Scene outlines',
  'codex-entry': 'Codex entries',
  'voice-profile': 'Voice profiles',
  'locked-world-rule': 'Locked world rules',
  'recent-excerpt': 'Recent manuscript excerpts',
  'full-text': 'Full text'
}

function groupSectionsByClass(sections: ContextSection[]): Array<[ContextSectionClass, ContextSection[]]> {
  const map = new Map<ContextSectionClass, ContextSection[]>()
  for (const section of sections) {
    const group = map.get(section.class)
    if (group) group.push(section)
    else map.set(section.class, [section])
  }
  return [...map.entries()]
}

// spec §9 Context Inspection — what was (or would be) sent to the model for
// this run. Codex entries and chapter summaries are now retrieved for real
// (main/retrieval, main/persistence/summaryStore.ts) and scoped to
// goal.scope.codexEntryIds / goal.scope.sceneIds; the "Included Codex
// entries" row uses the existing codex.list() IPC filtered to those ids
// rather than retrieval:search's vector search, since "included" here means
// an exact id lookup, not a similarity search — retrieval:search is fully
// wired up and exercised by the chapter-summary lookups below and by
// context.warnings(). Context warnings are computed for real via
// context:warnings and rendered as a list; when there are none, no warning
// box is shown at all.
export function ContextInspectionPanel({ goal, steps }: { goal: AgentGoal; steps: AgentStep[] }): JSX.Element {
  const toolCalls = steps.filter((s): s is AgentStep & { detail: ToolCall } => s.kind === 'tool-call')
  const permissionSteps = steps.filter((s): s is AgentStep & { detail: PermissionRequest } => s.kind === 'permission-request')
  const resultStep = steps.find((s) => s.kind === 'result')
  const modelCallSteps = steps.filter((s): s is AgentStep & { detail: ModelCallSummary } => s.kind === 'model-call')

  // Phase 7: assembleContext() (main/agent/context/assemble.ts) is the real
  // source of truth for what was actually sent to the model, but it's only
  // populated on model-call steps produced after that integration landed.
  // Take the most recent step that has it — earlier runs, or runs whose
  // model-call step predates the integration, simply won't have one, and the
  // goal-scope-based approximation rows above keep rendering unchanged.
  const assembledContext = [...modelCallSteps].reverse().find((s) => s.detail.assembledContext)?.detail
    .assembledContext

  const includedGroups = useMemo(
    () => (assembledContext ? groupSectionsByClass(assembledContext.sections.filter((s) => s.included)) : []),
    [assembledContext]
  )
  const excludedSections = useMemo(
    () => (assembledContext ? assembledContext.sections.filter((s) => !s.included) : []),
    [assembledContext]
  )

  const [codexEntries, setCodexEntries] = useState<CodexEntry[]>([])
  const [chapterSummaries, setChapterSummaries] = useState<ChapterSummary[]>([])
  const [warnings, setWarnings] = useState<ContextWarning[]>([])

  useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      const codexEntryIds = goal.scope.codexEntryIds ?? []
      const sceneIds = goal.scope.sceneIds ?? []

      const [allEntries, tree, contextWarnings] = await Promise.all([
        codexEntryIds.length > 0 ? window.atlas.codex.list() : Promise.resolve([]),
        sceneIds.length > 0 ? window.atlas.manuscript.tree() : Promise.resolve(null),
        window.atlas.context.warnings(goal)
      ])
      if (cancelled) return

      setCodexEntries(allEntries.filter((e) => codexEntryIds.includes(e.id)))
      setWarnings(contextWarnings)

      if (!tree) {
        setChapterSummaries([])
        return
      }
      const chapters = tree.books.flatMap((b) => b.parts.flatMap((p) => p.chapters))
      const chapterIds = [
        ...new Set(chapters.filter((c) => c.scenes.some((s) => sceneIds.includes(s.id))).map((c) => c.id))
      ]
      const summaries = await Promise.all(chapterIds.map((id) => window.atlas.summaries.getChapter(id)))
      if (!cancelled) setChapterSummaries(summaries)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [goal])

  return (
    <div style={{ marginTop: 32, maxWidth: 640 }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', marginBottom: 12 }}>
        Context inspection
      </div>

      <Row label="Included manuscript excerpt">{goal.scope.selectionText ? `"${goal.scope.selectionText}"` : '—'}</Row>
      <Row label="Included scene metadata">{goal.scope.sceneIds?.join(', ') ?? '—'}</Row>
      <Row label="Included Codex entries">
        {codexEntries.length > 0 ? codexEntries.map((e) => e.name).join(', ') : 'none in scope for this run'}
      </Row>
      <Row label="Included chapter summaries">
        {chapterSummaries.length > 0
          ? chapterSummaries.map((s) => s.summary).join(' / ')
          : 'none in scope for this run'}
      </Row>
      <Row label="Model settings">
        {goal.modelRef.modelId} via {goal.modelRef.provider} · max {goal.constraints.maxTurns} turns, {goal.constraints.maxTokens} tokens,{' '}
        {goal.constraints.maxToolCalls} tool calls, {(goal.constraints.maxElapsedMs / 1000).toFixed(0)}s
      </Row>
      <Row label="Run budget used">
        {steps.length} step{steps.length === 1 ? '' : 's'} of up to {goal.constraints.maxToolCalls} tool calls
      </Row>
      <Row label="Tools & skills selected">
        {toolCalls.length > 0 ? toolCalls.map((s) => s.detail.toolId).join(', ') : 'none yet'}
      </Row>
      <Row label="Permission decisions">
        {permissionSteps.length > 0
          ? permissionSteps.map((s) => `${s.detail.capabilityId}: ${s.detail.decision}`).join('; ')
          : 'none yet'}
      </Row>
      <Row label="Structured result">{resultStep ? (resultStep.detail as { summary: string }).summary : 'not finished yet'}</Row>

      {assembledContext && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', marginBottom: 12 }}>
            Assembled context (actual, most recent model call)
          </div>

          {includedGroups.length > 0 ? (
            includedGroups.map(([cls, sections]) => (
              <Row key={cls} label={`Included ${SECTION_CLASS_LABEL[cls].toLowerCase()}`}>
                {sections.map((s) => `${s.label} (~${s.tokensEstimate} tok)`).join(', ')}
              </Row>
            ))
          ) : (
            <Row label="Included context sections">none were included in this call</Row>
          )}

          <Row label="Excluded but potentially relevant">
            {excludedSections.length > 0
              ? excludedSections
                  .map((s) => `${s.label} (${SECTION_CLASS_LABEL[s.class]}) — ${s.excludedReason ?? 'excluded'}`)
                  .join('; ')
              : 'none'}
          </Row>

          <Row label="Context token budget used">
            {assembledContext.usedTokens.toLocaleString()} / {assembledContext.tokenBudget.toLocaleString()} tokens
            {assembledContext.tokenBudget > 0
              ? ` (${Math.round((assembledContext.usedTokens / assembledContext.tokenBudget) * 100)}%)`
              : ''}
          </Row>
        </div>
      )}

      {warnings.map((warning, i) => (
        <div
          key={i}
          style={{
            marginTop: i === 0 ? 16 : 8,
            padding: '12px 14px',
            borderRadius: 10,
            background: 'var(--c-amber-soft)',
            border: '1px solid var(--c-amber)',
            fontSize: 12.5,
            color: 'var(--c-ink)'
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Context warning</div>
          <div style={{ marginBottom: 4 }}>
            <strong>What's missing:</strong> {warning.what}
          </div>
          <div style={{ marginBottom: 4 }}>
            <strong>Why it matters:</strong> {warning.why}
          </div>
          <div>
            <strong>Suggested fix:</strong> {warning.suggestedFix}
          </div>
        </div>
      ))}
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10.5, color: 'var(--c-ink-faint)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 12.5, color: 'var(--c-ink)', lineHeight: 1.5 }}>{children}</div>
    </div>
  )
}
