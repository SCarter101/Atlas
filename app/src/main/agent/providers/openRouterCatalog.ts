import type { OpenRouterCatalogEntry } from '@shared/schema/models'

// GET https://openrouter.ai/api/v1/models is a public, unauthenticated
// endpoint (verified directly against the live endpoint while building this
// module — no API key required for a GET). Response shape:
//   { data: [ { id, name, pricing: { prompt, completion, ... }, ... } ] }
// `pricing.prompt` / `pricing.completion` are per-token USD strings (e.g.
// "0.000001"), NOT per-1K or per-1M — see costEstimate.ts for the
// conversion this feeds.
const CATALOG_URL = 'https://openrouter.ai/api/v1/models'
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

let cachedCatalog: OpenRouterCatalogEntry[] | null = null
let cachedAt = 0

interface RawOpenRouterModel {
  id?: unknown
  name?: unknown
  pricing?: { prompt?: unknown; completion?: unknown }
}

function normalizeEntry(raw: RawOpenRouterModel): OpenRouterCatalogEntry | null {
  if (typeof raw.id !== 'string') return null
  return {
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name : raw.id,
    pricing: {
      prompt: typeof raw.pricing?.prompt === 'string' ? raw.pricing.prompt : '0',
      completion: typeof raw.pricing?.completion === 'string' ? raw.pricing.completion : '0'
    }
  }
}

// The catalog is a nice-to-have for pricing/dropdown population, not a hard
// requirement — Settings must not crash if this fails offline or the
// endpoint's shape changes, so every failure path degrades to an empty
// array rather than throwing.
export async function fetchOpenRouterCatalog(): Promise<OpenRouterCatalogEntry[]> {
  const now = Date.now()
  if (cachedCatalog && now - cachedAt < CACHE_TTL_MS) return cachedCatalog

  try {
    const response = await fetch(CATALOG_URL)
    if (!response.ok) return cachedCatalog ?? []

    const body = (await response.json()) as { data?: unknown }
    if (!Array.isArray(body.data)) return cachedCatalog ?? []

    const entries = (body.data as RawOpenRouterModel[])
      .map(normalizeEntry)
      .filter((entry): entry is OpenRouterCatalogEntry => entry !== null)

    cachedCatalog = entries
    cachedAt = now
    return entries
  } catch {
    // Offline, DNS failure, malformed JSON, etc. — fall back to whatever
    // was last cached (even if stale) rather than an empty list, so a
    // transient blip doesn't wipe out previously-loaded catalog data.
    return cachedCatalog ?? []
  }
}
