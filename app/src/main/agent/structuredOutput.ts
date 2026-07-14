// Phase 8: shared parsing helper for roles that request JSON-mode output via
// ModelCallInput.responseFormat (see providers/types.ts). Real models routed
// through OpenRouter or a local LM Studio server frequently wrap JSON in a
// ```json fenced code block even when asked for raw JSON, so that's stripped
// before parsing. Never throws — every caller treats a parse failure the same
// way it treats "no real output at all": fall back to the existing simulated
// template path, matching this codebase's established "augment, never break
// the fallback" style (see simulator.ts's isReal branches).
const FENCED_JSON = /^```(?:json)?\s*([\s\S]*?)\s*```$/i

export function tryParseJson<T>(text: string): T | undefined {
  const trimmed = text.trim()
  const unfenced = FENCED_JSON.exec(trimmed)?.[1] ?? trimmed
  try {
    return JSON.parse(unfenced) as T
  } catch {
    return undefined
  }
}
