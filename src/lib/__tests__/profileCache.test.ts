import { beforeEach, describe, expect, it } from 'vitest'
import { cachedProfile, cacheProfile } from '../profile'
import type { Profile } from '../profile'

describe('profile cache', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('round-trips a valid profile', () => {
    const p: Profile = { id: 'abc123', display_name: 'Rakesh S.', role: 'inspector' }
    cacheProfile(p)
    expect(cachedProfile()).toEqual(p)
  })

  it('returns null when nothing is stored', () => {
    expect(cachedProfile()).toBeNull()
  })

  it('returns null for unparseable JSON', () => {
    localStorage.setItem('ehs-profile-v1', '{not json')
    expect(cachedProfile()).toBeNull()
  })

  it('returns null for a stored object with an invalid role', () => {
    localStorage.setItem(
      'ehs-profile-v1',
      JSON.stringify({ id: 'abc123', display_name: 'Rakesh S.', role: 'superuser' }),
    )
    expect(cachedProfile()).toBeNull()
  })

  it('returns null for a stored object missing fields', () => {
    localStorage.setItem('ehs-profile-v1', JSON.stringify({ id: 'abc123' }))
    expect(cachedProfile()).toBeNull()
  })

  it('cacheProfile(null) clears a previously stored profile', () => {
    const p: Profile = { id: 'abc123', display_name: 'Rakesh S.', role: 'viewer' }
    cacheProfile(p)
    cacheProfile(null)
    expect(cachedProfile()).toBeNull()
  })
})
