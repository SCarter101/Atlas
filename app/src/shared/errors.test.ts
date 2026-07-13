import { describe, expect, it } from 'vitest'
import { AtlasError, normalizeError } from './errors'

describe('AtlasError', () => {
  it('sets name and message, and defaults code to undefined', () => {
    const err = new AtlasError('boom')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('AtlasError')
    expect(err.message).toBe('boom')
    expect(err.code).toBeUndefined()
  })

  it('carries an optional code', () => {
    const err = new AtlasError('unreadable', 'MANIFEST_UNREADABLE')
    expect(err.code).toBe('MANIFEST_UNREADABLE')
  })
})

describe('normalizeError', () => {
  it('extracts message and stack from an Error', () => {
    const err = new Error('something failed')
    const result = normalizeError(err)
    expect(result.message).toBe('something failed')
    expect(result.detail).toBe(err.stack)
  })

  it('handles an AtlasError (with code) like any other Error', () => {
    const err = new AtlasError('manifest corrupt', 'MANIFEST_UNREADABLE')
    const result = normalizeError(err)
    expect(result.message).toBe('manifest corrupt')
    expect(result.detail).toBe(err.stack)
  })

  it('falls back to the error name when the message is empty', () => {
    const err = new Error('')
    const result = normalizeError(err)
    expect(result.message).toBe('Error')
  })

  it('returns a string input unchanged', () => {
    expect(normalizeError('plain string failure')).toEqual({ message: 'plain string failure' })
  })

  it('returns a generic message for null', () => {
    expect(normalizeError(null)).toEqual({ message: 'An unexpected error occurred.' })
  })

  it('returns a generic message for undefined', () => {
    expect(normalizeError(undefined)).toEqual({ message: 'An unexpected error occurred.' })
  })

  it('returns a generic message for a non-Error object', () => {
    expect(normalizeError({ weird: true })).toEqual({ message: 'An unexpected error occurred.' })
  })
})
