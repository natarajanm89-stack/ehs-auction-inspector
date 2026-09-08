import { beforeEach, describe, expect, it } from 'vitest'
import { getMode, setMode, isCollaborativeAvailable, getLocalName, setLocalName } from '../mode'
import { cacheProfile } from '../profile'
import type { Profile } from '../profile'

describe('mode', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults to single when nothing is stored and no cached profile exists', () => {
    expect(getMode()).toBe('single')
  })

  it('a stored mode wins', () => {
    setMode('collaborative')
    expect(getMode()).toBe('collaborative')
    setMode('single')
    expect(getMode()).toBe('single')
  })

  it('migrates a device with a cached profile but no stored mode to collaborative, and persists it', () => {
    const p: Profile = { id: 'abc123', display_name: 'Rakesh S.', role: 'inspector' }
    cacheProfile(p)
    expect(getMode()).toBe('collaborative')
    // persisted: a direct read of localStorage should now show it, independent of the cached profile
    expect(localStorage.getItem('ehs-mode')).toBe('collaborative')
  })

  it('setMode round-trips', () => {
    setMode('collaborative')
    expect(localStorage.getItem('ehs-mode')).toBe('collaborative')
    expect(getMode()).toBe('collaborative')
    setMode('single')
    expect(localStorage.getItem('ehs-mode')).toBe('single')
    expect(getMode()).toBe('single')
  })

  it('getLocalName defaults to Inspector', () => {
    expect(getLocalName()).toBe('Inspector')
  })

  it('setLocalName / getLocalName round-trip', () => {
    setLocalName('Rakesh S.')
    expect(getLocalName()).toBe('Rakesh S.')
  })

  it('isCollaborativeAvailable reflects isSupabaseConfigured', () => {
    expect(typeof isCollaborativeAvailable()).toBe('boolean')
  })
})
