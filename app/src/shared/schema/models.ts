// Minimal projection of an OpenRouter /api/v1/models catalog entry — just
// enough for pricing lookups and a Settings dropdown label. See
// main/agent/providers/openRouterCatalog.ts for the fetch + cache.
export interface OpenRouterCatalogEntry {
  id: string
  name: string
  pricing: {
    prompt: string
    completion: string
  }
}
