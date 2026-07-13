// Shared, dependency-free error helpers used on BOTH sides of the IPC
// boundary (main throws AtlasError from persistence code; the renderer
// normalizes any rejected window.atlas.* promise into something a toast can
// display). Keep this module free of Electron/DOM imports so it type-checks
// under tsconfig.node.json and tsconfig.web.json alike.

// A tagged error with an optional machine-readable code, so callers can
// distinguish "expected, explainable" failures (e.g. a corrupt manifest) from
// arbitrary thrown values. Electron serializes a thrown Error's `message`
// across IPC, so the human-facing message is what survives to the renderer.
export class AtlasError extends Error {
  code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'AtlasError'
    this.code = code
  }
}

// Turn anything thrown/rejected into a stable, displayable shape. Never
// throws — a normalizer that can itself throw defeats the purpose (it runs
// inside catch blocks and global error handlers).
export function normalizeError(err: unknown): { message: string; detail?: string } {
  if (err instanceof Error) {
    const message = err.message && err.message.trim().length > 0 ? err.message : err.name
    return { message, detail: err.stack }
  }
  if (typeof err === 'string') {
    return { message: err }
  }
  return { message: 'An unexpected error occurred.' }
}
