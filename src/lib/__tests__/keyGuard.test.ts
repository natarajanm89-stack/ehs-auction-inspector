import { describe, expect, it } from 'vitest'
import { assertNotServiceRole } from '../keyGuard'

const jwt = (claims: object) => {
  const b64 = (o: object) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`
}

describe('assertNotServiceRole', () => {
  it('throws in prod for a service_role key, mentioning the anon key', () => {
    const key = jwt({ role: 'service_role' })
    expect(() => assertNotServiceRole(key, true)).toThrow(/anon/i)
  })

  it('returns a warning message (does not throw) in dev for a service_role key', () => {
    const key = jwt({ role: 'service_role' })
    const result = assertNotServiceRole(key, false)
    expect(result).toMatch(/service_role/i)
  })

  it('returns null for an anon-role key in dev', () => {
    const key = jwt({ role: 'anon' })
    expect(assertNotServiceRole(key, false)).toBeNull()
  })

  it('returns null for an anon-role key in prod', () => {
    const key = jwt({ role: 'anon' })
    expect(assertNotServiceRole(key, true)).toBeNull()
  })

  it('returns null for a non-JWT publishable key', () => {
    expect(assertNotServiceRole('sb_publishable_abc123', true)).toBeNull()
  })

  it('returns null for a malformed key with too few segments', () => {
    expect(assertNotServiceRole('not.a.jwt', true)).toBeNull()
  })

  it('returns null for a key whose payload is invalid base64', () => {
    expect(assertNotServiceRole('a.!!!not-base64!!!.c', true)).toBeNull()
  })

  it('returns null for a key whose payload is invalid JSON', () => {
    const badPayload = btoa('not json').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(assertNotServiceRole(`a.${badPayload}.c`, true)).toBeNull()
  })

  it('returns null for a JWT with no role claim', () => {
    const key = jwt({ sub: 'user123' })
    expect(assertNotServiceRole(key, true)).toBeNull()
  })
})
