// Mirrors main/persistence/sceneStore.ts's countWords() logic, duplicated
// here rather than imported because that file pulls in node:fs/promises and
// isn't safe to bundle into the renderer. Kept dependency-free so both
// SprintTimer (live word-count delta) and the focus-mode word-count pill in
// ManuscriptWorkspace can use the same definition of "word count" as the
// persisted scene metadata.
export function countWords(prose: string): number {
  const trimmed = prose.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}
