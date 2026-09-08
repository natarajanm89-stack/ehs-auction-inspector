import { describe, it, expect } from 'vitest'
import { can } from '../profile'

describe('can', () => {
  it('lets inspectors and admins write state', () => {
    expect(can('inspector', 'write_state')).toBe(true)
    expect(can('admin', 'write_state')).toBe(true)
  })
  it('does not let viewers write state', () => {
    expect(can('viewer', 'write_state')).toBe(false)
  })
  it('lets only admins write the catalog', () => {
    expect(can('admin', 'write_catalog')).toBe(true)
    expect(can('inspector', 'write_catalog')).toBe(false)
  })
  it('lets every role comment', () => {
    expect(can('viewer', 'comment')).toBe(true)
    expect(can('inspector', 'comment')).toBe(true)
    expect(can('admin', 'comment')).toBe(true)
  })
  it('denies everything without a role', () => {
    expect(can(null, 'write_state')).toBe(false)
    expect(can(null, 'comment')).toBe(false)
  })
})
