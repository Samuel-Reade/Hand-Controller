import { describe, expect, it } from 'vitest'
import { resolveFlag } from '../src/config/flags'

describe('feature flags', () => {
  it('default: on in dev, off in a build', () => {
    expect(resolveFlag('eye', '', undefined, true)).toBe(true)
    expect(resolveFlag('eye', '', undefined, false)).toBe(false)
  })
  it('the build env overrides the default', () => {
    expect(resolveFlag('eye', '', '1', false)).toBe(true)
    expect(resolveFlag('eye', '', 'true', false)).toBe(true)
    expect(resolveFlag('eye', '', '0', true)).toBe(false)
  })
  it('the URL overrides both', () => {
    expect(resolveFlag('eye', '?feature=eye', '0', false)).toBe(true)
    expect(resolveFlag('eye', '?feature=-eye', '1', true)).toBe(false)
    expect(resolveFlag('eye', '?tune=0&feature=other,eye', undefined, false)).toBe(true)
    expect(resolveFlag('eye', '?feature=eyes', undefined, false)).toBe(false) // whole names only
  })
})
