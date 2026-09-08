import { describe, it, expect } from 'vitest'

describe('test harness', () => {
  it('provides IndexedDB in the test environment', () => {
    expect(typeof indexedDB).toBe('object')
    expect(indexedDB).not.toBeNull()
  })
})
