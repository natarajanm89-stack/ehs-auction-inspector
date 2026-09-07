import { describe, it, expect, beforeEach, vi } from 'vitest'

const { rpc, fromMock, channelHandlers } = vi.hoisted(() => ({
  rpc: vi.fn(),
  fromMock: vi.fn(),
  channelHandlers: [] as ((payload: any) => any)[],
}))
vi.mock('../supabase', () => ({
  supabase: {
    rpc,
    from: fromMock,
    channel: () => ({
      on: (_event: string, _filter: any, handler: (payload: any) => any) => {
        channelHandlers.push(handler)
        return { subscribe: () => ({}) }
      },
    }),
    removeChannel: vi.fn(),
  },
  ensureSession: vi.fn(async () => 'uid-1'),
}))

vi.mock('../db', async () => {
  const actual = await vi.importActual<typeof import('../db')>('../db')
  return { ...actual, isDirty: vi.fn(actual.isDirty), putState: vi.fn(actual.putState) }
})

import { clearAll, enqueue, listOutbox, isDirty, putState } from '../db'
import { drainOutbox, pullAll, pullLot, startSync } from '../sync'

beforeEach(() => {
  fromMock.mockReturnValue({ select: () => Promise.resolve({ data: [], error: null }) })
})

beforeEach(async () => { await clearAll(); rpc.mockReset() })

const entry = (lot: number, group: any, updatedAt: string) =>
  ({ lot, group, payload: {}, updatedAt })

describe('drainOutbox', () => {
  it('does nothing when the outbox is empty', async () => {
    expect(await drainOutbox()).toEqual({ pushed: 0, failed: 0 })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('pushes each queued entry once and clears it', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:00.000Z'))
    await enqueue(entry(413, 'commercial', '2026-09-07T10:00:01.000Z'))

    expect(await drainOutbox()).toEqual({ pushed: 2, failed: 0 })
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(await listOutbox()).toHaveLength(0)
  })

  it('calls sync_machine_state with the field group and client timestamp', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:00.000Z'))
    await drainOutbox()

    expect(rpc).toHaveBeenCalledWith('sync_machine_state', {
      p_lot: 412,
      p_group: 'inspection',
      p_payload: {},
      p_client_updated_at: '2026-09-07T10:00:00.000Z',
    })
  })

  it('keeps an entry queued when the push errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'network down' } })
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:00.000Z'))

    expect(await drainOutbox()).toEqual({ pushed: 0, failed: 1 })
    expect(await listOutbox()).toHaveLength(1)
  })

  it('clears the entry even when the server rejects the write as stale', async () => {
    // false means "a newer value already won" — retrying forever would be futile.
    rpc.mockResolvedValue({ data: false, error: null })
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:00.000Z'))

    expect(await drainOutbox()).toEqual({ pushed: 1, failed: 0 })
    expect(await listOutbox()).toHaveLength(0)
  })

  it('is safe to call twice with no double-push', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:00.000Z'))
    await drainOutbox()
    await drainOutbox()
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('pushes an entry enqueued during the same drain call, not the next one', async () => {
    let calls = 0
    rpc.mockImplementation(async () => {
      calls++
      // While the first entry is "in flight", a second edit gets queued.
      if (calls === 1) {
        await enqueue(entry(413, 'commercial', '2026-09-07T10:00:09.000Z'))
      }
      return { data: true, error: null }
    })
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:00.000Z'))

    const result = await drainOutbox()

    expect(result).toEqual({ pushed: 2, failed: 0 })
    expect(await listOutbox()).toHaveLength(0)
  })
})

describe('pullAll', () => {
  it('fills in default inspection and commercial fields for untouched lots', async () => {
    fromMock.mockReturnValue({
      select: () => Promise.resolve({
        data: [{ lot: 412, inspection: {}, commercial: {}, decision: 'UNASSESSED', shortlist: false }],
        error: null,
      }),
    })

    const states = await pullAll()

    expect(states[412].inspection.scores).toBeDefined()
    expect(states[412].inspection.critical).toBeDefined()
    expect(Object.keys(states[412].inspection.scores).length).toBeGreaterThan(0)
    expect(Object.keys(states[412].inspection.critical).length).toBeGreaterThan(0)
  })
})

describe('startSync realtime handler', () => {
  beforeEach(() => {
    channelHandlers.length = 0
    vi.mocked(isDirty).mockReset()
    vi.mocked(putState).mockClear()
  })

  const row = { lot: 412, inspection: {}, commercial: {}, decision: 'UNASSESSED', shortlist: false }

  it('does not overwrite the cache or notify the caller when the lot is dirty', async () => {
    vi.mocked(isDirty).mockResolvedValue(true)
    const onRemoteState = vi.fn()
    const cleanup = startSync(onRemoteState)

    await channelHandlers[0]({ new: row })

    expect(putState).not.toHaveBeenCalled()
    expect(onRemoteState).not.toHaveBeenCalled()
    cleanup()
  })

  it('applies the row and notifies the caller when the lot is clean', async () => {
    vi.mocked(isDirty).mockResolvedValue(false)
    const onRemoteState = vi.fn()
    const cleanup = startSync(onRemoteState)

    await channelHandlers[0]({ new: row })

    expect(putState).toHaveBeenCalledWith(412, expect.any(Object))
    expect(onRemoteState).toHaveBeenCalledWith(412, expect.any(Object))
    cleanup()
  })

  it('queues a dirty lot for reconciliation instead of dropping it', async () => {
    vi.mocked(isDirty).mockResolvedValue(true)
    const onRemoteState = vi.fn()
    const cleanup = startSync(onRemoteState)

    await channelHandlers[0]({ new: row })
    expect(onRemoteState).not.toHaveBeenCalled()

    // Now the lot is clean and the outbox is empty: draining should reconcile it.
    vi.mocked(isDirty).mockResolvedValue(false)
    fromMock.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: row, error: null }),
        }),
      }),
    })
    await drainOutbox()

    expect(putState).toHaveBeenCalledWith(412, expect.any(Object))
    expect(onRemoteState).toHaveBeenCalledWith(412, expect.any(Object))
    cleanup()
  })

  it('leaves a lot still dirty at reconcile time queued for the next attempt', async () => {
    vi.mocked(isDirty).mockResolvedValue(true)
    const onRemoteState = vi.fn()
    const cleanup = startSync(onRemoteState)

    await channelHandlers[0]({ new: row })
    await drainOutbox()

    expect(putState).not.toHaveBeenCalled()
    expect(onRemoteState).not.toHaveBeenCalled()
    cleanup()
  })
})
