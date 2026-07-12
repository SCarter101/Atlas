// Splits scene prose into sentences for ReadAloudControl. Each sentence
// becomes its own SpeechSynthesisUtterance spoken sequentially — simpler and
// more reliable across Chromium versions than driving sentence-level
// highlighting off a single utterance's `onboundary` charIndex, which is
// word-granularity in most Chromium builds, not sentence-granularity.
export function splitIntoSentences(prose: string): string[] {
  return prose
    .split(/\n{2,}/) // paragraph breaks first, so a highlight never spans them
    .flatMap((paragraph) => paragraph.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}
