import { describe, it, expect, beforeEach } from 'vitest'
import { blankState } from '../calc'
import {
  clearAll, getState, putState, getAllStates,
  enqueue, listOutbox, dequeue, isDirty,
} from '../db'

beforeEach(async () => { await clearAll() })

describe('state cache', () => {
  it('returns null for an unknown lot', async () => {
    expect(await getState(999)).toBeNull()
  })

  it('round-trips a state', async () => {
    const s = blankState()
    s.inspection.notes = 'hydraulic weep at boom pivot'
    await putState(412, s)
    expect((await getState(412))?.inspection.notes).toBe('hydraulic weep at boom pivot')
  })

  it('returns every cached state keyed by lot', async () => {
    await putState(1, blankState())
    await putState(2, blankState())
    expect(Object.keys(await getAllStates()).sort()).toEqual(['1', '2'])
  })
})

describe('outbox', () => {
  const entry = (lot: number, group: any, updatedAt: string, payload: any = {}) =>
    ({ lot, group, payload, updatedAt })

  it('starts empty', async () => {
    expect(await listOutbox()).toEqual([])
  })

  it('queues an entry', async () => {
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:00.000Z'))
    expect(await listOutbox()).toHaveLength(1)
  })

  it('collapses repeated edits to the same lot and group', async () => {
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:00.000Z', { n: 1 }))
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:05.000Z', { n: 2 }))
    const out = await listOutbox()
    expect(out).toHaveLength(1)
    expect((out[0].payload as any).n).toBe(2)
  })

  it('keeps different field groups on the same lot separate', async () => {
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:00.000Z'))
    await enqueue(entry(412, 'commercial', '2026-09-07T10:00:01.000Z'))
    expect(await listOutbox()).toHaveLength(2)
  })

  it('never replaces a newer queued edit with an older one', async () => {
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:05.000Z', { n: 'new' }))
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:00.000Z', { n: 'old' }))
    expect(((await listOutbox())[0].payload as any).n).toBe('new')
  })

  it('reports dirty state per lot and group', async () => {
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:00.000Z'))
    expect(await isDirty(412, 'inspection')).toBe(true)
    expect(await isDirty(412, 'commercial')).toBe(false)
    expect(await isDirty(999, 'inspection')).toBe(false)
  })

  it('dequeues only when the timestamp still matches', async () => {
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:00.000Z'))
    await dequeue(412, 'inspection', '2026-09-07T10:00:00.000Z')
    expect(await listOutbox()).toHaveLength(0)
  })

  it('keeps an edit made while its push was in flight', async () => {
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:00.000Z'))
    // user edits again mid-flight
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:09.000Z'))
    // the in-flight push completes and tries to clear the old version
    await dequeue(412, 'inspection', '2026-09-07T10:00:00.000Z')
    expect(await listOutbox()).toHaveLength(1)
  })
})
