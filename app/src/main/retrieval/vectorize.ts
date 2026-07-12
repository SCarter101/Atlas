// Deterministic hashing-trick bag-of-words vector — a placeholder for a real
// embedding model, in the same "clearly labeled simulation" style as
// main/agent/simulator.ts. Two texts sharing a hash bucket are not
// necessarily semantically related; this only supports the simulated
// retrieval flow, not real semantic search.

function djb2Hash(token: string): number {
  let hash = 5381
  for (let i = 0; i < token.length; i++) {
    hash = (hash * 33) ^ token.charCodeAt(i)
  }
  return hash >>> 0
}

export function vectorize(text: string, dimensions = 256): Float32Array {
  const vector = new Float32Array(dimensions)
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

  for (const token of tokens) {
    const bucket = djb2Hash(token) % dimensions
    vector[bucket] += 1
  }

  let magnitude = 0
  for (let i = 0; i < dimensions; i++) magnitude += vector[i] * vector[i]
  magnitude = Math.sqrt(magnitude)
  if (magnitude === 0) return vector

  for (let i = 0; i < dimensions; i++) vector[i] /= magnitude
  return vector
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length)
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  if (magA === 0 || magB === 0) return 0
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}
