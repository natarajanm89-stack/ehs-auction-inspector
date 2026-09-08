import { useCallback, useEffect, useRef, useState } from 'react'
import type { MachineState } from '../types'
import { blankState } from '../lib/calc'
import { machines } from '../data'
import { enqueue, getAllStates, isDirty, putState } from '../lib/db'
import { drainOutbox, pullAll, refreshPending, startSync } from '../lib/sync'
import type { FieldGroup } from '../lib/db'
import { getMode } from '../lib/mode'

const GROUPS: FieldGroup[] = ['inspection', 'commercial', 'decision']

function seed(partial: Record<number, MachineState>): Record<number, MachineState> {
  return Object.fromEntries(
    machines.map(m => [m.lot, partial[m.lot] ? { ...blankState(), ...partial[m.lot] } : blankState()])
  )
}

export function useAllMachineStates(canWrite: boolean) {
  const [states, setStates] = useState<Record<number, MachineState>>(() => seed({}))
  const [ready, setReady] = useState(false)
  const statesRef = useRef(states)
  useEffect(() => { statesRef.current = states }, [states])
  // Lots edited in this session - the boot pull must never overwrite one of
  // these regardless of what the outbox says at any given instant, since an
  // edit made between the isDirty check and the putState below would
  // otherwise be silently reverted.
  const touchedRef = useRef<Set<number>>(new Set())
  // Tracks the latest value written by patchState per lot, updated
  // synchronously. React applies functional setState updates during its own
  // render pass, not necessarily synchronously with the call, so two
  // patchState calls made in the same tick cannot rely on reading each
  // other's result back out of `states`/`statesRef` - this ref is the
  // synchronous source of truth instead.
  const draftRef = useRef<Record<number, MachineState>>({})

  // Boot: local cache first (instant, works offline), then the server.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const local = await getAllStates()
      if (!cancelled) { setStates(seed(local)); setReady(true) }
      if (getMode() === 'single') return   // no network at all in single mode
      try {
        const remote = await pullAll()
        if (cancelled) return
        // The outbox is the durable record of unsynced work - dirtyRef would
        // be empty after a reload, and pulling would then overwrite an
        // inspector's offline edits.
        for (const [lotKey, state] of Object.entries(remote)) {
          const lot = Number(lotKey)
          if (touchedRef.current.has(lot)) continue
          const dirty = await Promise.all(GROUPS.map(g => isDirty(lot, g)))
          if (dirty.some(Boolean)) continue
          // Narrow the window further: re-check immediately before the write
          // in case an edit landed while the first check was in flight.
          if (touchedRef.current.has(lot)) continue
          const stillDirty = await Promise.all(GROUPS.map(g => isDirty(lot, g)))
          if (stillDirty.some(Boolean)) continue
          await putState(lot, state)
        }
        const fresh = await getAllStates()
        setStates(prev => {
          const merged = seed(fresh)
          // A lot touched in this session must keep its in-memory value: the
          // edit may not have reached IndexedDB yet, and overwriting it here
          // would also poison statesRef for the next keystroke.
          for (const lot of touchedRef.current) {
            if (prev[lot]) merged[lot] = prev[lot]
          }
          return merged
        })
      } catch { /* offline: the local cache stands */ }
    })()
    return () => { cancelled = true }
  }, [])

  // Realtime: sync.ts already guards against overwriting a dirty lot, so this
  // callback just applies whatever it is handed. Skipped entirely in single
  // mode - there is no server to sync with.
  useEffect(() => {
    if (getMode() === 'single') return
    return startSync((lot, remote) => {
      setStates(prev => ({ ...prev, [lot]: { ...blankState(), ...remote } }))
    })
  }, [])

  const patchState = useCallback((lot: number, group: FieldGroup, fn: (s: MachineState) => MachineState) => {
    if (!canWrite) return
    touchedRef.current.add(lot)
    const updatedAt = new Date().toISOString()

    // Derive from draftRef (falling back to statesRef), not `prev` inside a
    // setStates updater: React may not run that updater synchronously, so a
    // second patchState call in the same tick could still read a stale base.
    const base = draftRef.current[lot] ?? statesRef.current[lot] ?? blankState()
    const next = fn(base)
    draftRef.current[lot] = next

    setStates(prev => ({ ...prev, [lot]: next }))

    const payload =
      group === 'inspection' ? next.inspection :
      group === 'commercial' ? next.commercial :
      { decision: next.decision, shortlist: next.shortlist }

    // Fire-and-forget: the UI must never wait on storage or the network.
    // db.ts reports failures via onStorageError, so these catches only swallow.
    void putState(lot, next).catch(() => {})
    // Still enqueued in single mode, even though nothing drains it here - if
    // the device is later switched to collaborative mode, the queued work
    // must still be there to push.
    void enqueue({ lot, group, payload, updatedAt })
      .then(() => refreshPending())
      .then(() => { if (getMode() !== 'single' && navigator.onLine) return drainOutbox() })
      .catch(() => {})
  }, [canWrite])

  return { states, ready, patchState }
}
