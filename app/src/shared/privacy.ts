import type { ModelProvider } from './schema/agent'

export type PrivacyModelRef = {
  modelId: string
  viaOpenRouter: boolean
  provider?: ModelProvider | 'anthropic-cloud'
}

const LOCAL_KEYWORDS = ['lm-studio', 'local', 'llama.cpp']
const CLOUD_KEYWORDS = ['gpt', 'o1', 'o3', 'claude', 'sonnet', 'opus', 'haiku', 'gemini', 'mistral-large', 'command-r']
const CLOUD_PROVIDERS = ['openai', 'google', 'openrouter', 'anthropic-cloud']

// Heuristic only: the simulator does not transmit data in this build, but
// the UI still needs a conservative classifier for privacy gates and copy.
export function isCloudModel(modelRef: PrivacyModelRef): boolean {
  const provider = modelRef.provider?.toLowerCase()
  const modelId = modelRef.modelId.toLowerCase()

  if (LOCAL_KEYWORDS.some((keyword) => modelId.includes(keyword))) return false
  if (modelRef.viaOpenRouter) return true
  if (provider && CLOUD_PROVIDERS.includes(provider)) return true
  return CLOUD_KEYWORDS.some((keyword) => modelId.includes(keyword))
}

export function describeProvider(modelRef: PrivacyModelRef): string {
  if (modelRef.viaOpenRouter) return `OpenRouter (${modelRef.modelId})`
  if (modelRef.provider === 'openai') return `OpenAI (${modelRef.modelId})`
  if (modelRef.provider === 'google') return `Google (${modelRef.modelId})`
  if (modelRef.provider === 'openrouter') return `OpenRouter (${modelRef.modelId})`
  if (modelRef.provider === 'lm-studio') return `LM Studio (${modelRef.modelId})`
  if (modelRef.provider === 'anthropic-cloud') return `Anthropic (${modelRef.modelId})`
  if (modelRef.modelId.toLowerCase().includes('claude')) return `Anthropic (${modelRef.modelId})`
  return modelRef.modelId
}
