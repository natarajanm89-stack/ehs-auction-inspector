import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const { pullAllMock } = vi.hoisted(() => ({ pullAllMock: vi.fn() }))

vi.mock('../../lib/sync', () => ({
  pullAll: pullAllMock,
  startSync: () => () => {},
  drainOutbox: vi.fn(async () => ({ pushed: 0, failed: 0 })),
  refreshPending: vi.fn(async () => {}),
}))

import { clearAll } from '../../lib/db'
import { blankState } from '../../lib/calc'
import { useAllMachineStates } from '../useMachineState'

beforeEach(async () => {
  await clearAll()
  pullAllMock.mockReset()
})

describe('boot pull merge', () => {
  it('preserves a lot touched in-session instead of reverting it to the pulled value', async () => {
    // The pull resolves with a stale/cached server value for lot 659.
    const serverState = { ...blankState(), inspection: { ...blankState().inspection, notes: 'server notes' } }
    let resolvePull: (v: any) => void
    pullAllMock.mockReturnValue(new Promise(res => { resolvePull = res }))

    const { result } = renderHook(() => useAllMachineStates(true))

    await waitFor(() => expect(result.current.ready).toBe(true))

    // The inspector types while the pull is still in flight.
    act(() => {
      result.current.patchState(659, 'inspection', s => ({
        ...s, inspection: { ...s.inspection, notes: 'inspector typed this' },
      }))
    })
    expect(result.current.states[659].inspection.notes).toBe('inspector typed this')

    // Now the slow pull resolves.
    await act(async () => {
      resolvePull!({ 659: serverState })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.states[659].inspection.notes).toBe('inspector typed this')
  })
})
