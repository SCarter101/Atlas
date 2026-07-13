import { describe, expect, it } from 'vitest'
import { describeProvider, isCloudModel } from './privacy'

describe('isCloudModel', () => {
  it('treats OpenRouter routing as cloud regardless of model id', () => {
    expect(isCloudModel({ modelId: 'llama-3.1', viaOpenRouter: true, provider: 'lm-studio' })).toBe(true)
  })

  it('classifies known cloud providers as cloud', () => {
    expect(isCloudModel({ modelId: 'gpt-4.1', viaOpenRouter: false, provider: 'openai' })).toBe(true)
    expect(isCloudModel({ modelId: 'gemini-1.5-pro', viaOpenRouter: false, provider: 'google' })).toBe(true)
    expect(isCloudModel({ modelId: 'claude-sonnet-4', viaOpenRouter: false, provider: 'anthropic-cloud' })).toBe(true)
  })

  it('classifies cloud-looking model ids conservatively', () => {
    expect(isCloudModel({ modelId: 'Claude Opus 4', viaOpenRouter: false, provider: 'anthropic' })).toBe(true)
    expect(isCloudModel({ modelId: 'Mistral-Large', viaOpenRouter: false })).toBe(true)
    expect(isCloudModel({ modelId: 'command-r-plus', viaOpenRouter: false })).toBe(true)
  })

  it('lets explicit local model ids win over provider defaults', () => {
    expect(isCloudModel({ modelId: 'Local (LM Studio)', viaOpenRouter: false, provider: 'anthropic' })).toBe(false)
    expect(isCloudModel({ modelId: 'llama.cpp qwen local', viaOpenRouter: false, provider: 'lm-studio' })).toBe(false)
  })
})

describe('describeProvider', () => {
  it('names routed and direct providers for modal copy', () => {
    expect(describeProvider({ modelId: 'Claude Sonnet 4', viaOpenRouter: true, provider: 'anthropic' })).toBe(
      'OpenRouter (Claude Sonnet 4)'
    )
    expect(describeProvider({ modelId: 'Local (LM Studio)', viaOpenRouter: false, provider: 'lm-studio' })).toBe(
      'LM Studio (Local (LM Studio))'
    )
  })
})
