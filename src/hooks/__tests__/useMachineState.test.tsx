import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const { pullAllMock } = vi.hoisted(() => ({ pullAllMock: vi.fn() }))

vi.mock('../../lib/sync', () => ({
  pullAll: pullAllMock,
  startSync: () => () => {},
  drainOutbox: vi.fn(async () => ({ pushed: 0, failed: 0 })),
  refreshPending: vi.fn(async () => {}),
}))

import { clearAll, getAllStates } from '../../lib/db'
import { blankState } from '../../lib/calc'
import { writeBackup } from '../../lib/backup'
import { useAllMachineStates } from '../useMachineState'

beforeEach(async () => {
  await clearAll()
  localStorage.clear()
  pullAllMock.mockReset()
  pullAllMock.mockResolvedValue({})
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

describe('backup restore on boot', () => {
  it('restores from the localStorage backup when IndexedDB comes back empty', async () => {
    const backedUp = { ...blankState(), inspection: { ...blankState().inspection, notes: 'from backup' } }
    writeBackup({ 627: backedUp })

    const { result } = renderHook(() => useAllMachineStates(true))
    await waitFor(() => expect(result.current.ready).toBe(true))

    expect(result.current.states[627].inspection.notes).toBe('from backup')
    expect(result.current.recoveredCount).toBe(1)

    // The restored state is also written back into IndexedDB.
    const persisted = await getAllStates()
    expect(persisted[627].inspection.notes).toBe('from backup')
  })

  it('does not touch recoveredCount when IndexedDB already has data', async () => {
    const { putState } = await import('../../lib/db')
    await putState(1, blankState())

    const { result } = renderHook(() => useAllMachineStates(true))
    await waitFor(() => expect(result.current.ready).toBe(true))

    expect(result.current.recoveredCount).toBe(0)
  })
})
