import type { CodexEntry } from '@shared/schema/codex'
import type { SceneMeta } from '@shared/schema/manuscript'
import type { ContextWarning } from '@shared/schema/retrieval'

// A handful of heuristics flagging ways an agent run's retrieved context
// might be thinner than the writer expects — the what/why/fix shape spec §9
// calls for. Not exhaustive by design.
//
// `codexEntries` is the full Codex (or whatever candidate set the caller
// passes), not just what's in scope for this run — "in scope" is derived
// from `scene.povCharacterId` and `scene.continuity.relatedCodexIds`, the
// existing fields SceneMeta already uses to record which Codex entries a
// scene is tied to.
export function computeContextWarnings(params: {
  scene?: SceneMeta
  codexEntries: CodexEntry[]
  hasChapterSummary: boolean
}): ContextWarning[] {
  const warnings: ContextWarning[] = []
  const { scene, codexEntries, hasChapterSummary } = params

  if (scene?.povCharacterId && !codexEntries.some((e) => e.id === scene.povCharacterId)) {
    warnings.push({
      what: 'POV character not found in Codex',
      why: "the agent can't ground this scene's POV in an established character",
      suggestedFix: 'add a Character entry for this POV, or link the existing one'
    })
  }

  if (!hasChapterSummary) {
    warnings.push({
      what: 'No chapter summary retrieved',
      why: 'the agent has no rolled-up context for what already happened earlier in this chapter',
      suggestedFix: 'generate a chapter summary, or widen the run scope to include the preceding scenes'
    })
  }

  if (scene) {
    const scopedIds = new Set<string>([
      ...(scene.povCharacterId ? [scene.povCharacterId] : []),
      ...(scene.continuity?.relatedCodexIds ?? [])
    ])
    const omittedLocked = codexEntries.filter((e) => e.locked && !scopedIds.has(e.id))
    if (omittedLocked.length > 0) {
      warnings.push({
        what: `${omittedLocked.length} locked world rule${omittedLocked.length === 1 ? '' : 's'} not retrieved (${omittedLocked.map((e) => e.name).join(', ')})`,
        why: 'a locked Codex entry marks a hard canon constraint the agent should never contradict, and it falls outside this run\'s included scope',
        suggestedFix: "link the entry under this scene's related Codex entries, or widen the run scope to include it"
      })
    }
  }

  return warnings
}
