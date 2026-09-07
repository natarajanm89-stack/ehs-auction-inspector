import { describe, it, expect, beforeEach, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../supabase', () => ({
  supabase: {
    rpc,
    from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: vi.fn(),
  },
  ensureSession: vi.fn(async () => 'uid-1'),
}))

import { clearAll, enqueue, listOutbox } from '../db'
import { drainOutbox } from '../sync'

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
})
