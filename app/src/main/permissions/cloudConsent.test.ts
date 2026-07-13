import { describe, expect, it } from 'vitest'
import { CloudConsentSessionStore } from './cloudConsent'

describe('CloudConsentSessionStore', () => {
  it('has no consent before any grant', () => {
    const store = new CloudConsentSessionStore()
    expect(store.hasConsent('run-1')).toBe(false)
  })

  it('grantOnce only grants consent for that specific runId, not others', () => {
    const store = new CloudConsentSessionStore()
    store.grantOnce('run-1')
    expect(store.hasConsent('run-1')).toBe(true)
    expect(store.hasConsent('run-2')).toBe(false)
  })

  it('grantSession grants consent for any runId, including ones not yet seen', () => {
    const store = new CloudConsentSessionStore()
    store.grantSession()
    expect(store.hasConsent('run-1')).toBe(true)
    expect(store.hasConsent('run-2')).toBe(true)
    expect(store.hasConsent('anything')).toBe(true)
  })

  it('defaults requireCloudAuth to true, matching the renderer PrivacySettings default', () => {
    const store = new CloudConsentSessionStore()
    expect(store.requireCloudAuth).toBe(true)
  })

  it('setRequireCloudAuth(false) is reflected in the requireCloudAuth getter', () => {
    const store = new CloudConsentSessionStore()
    store.setRequireCloudAuth(false)
    expect(store.requireCloudAuth).toBe(false)
    store.setRequireCloudAuth(true)
    expect(store.requireCloudAuth).toBe(true)
  })
})
