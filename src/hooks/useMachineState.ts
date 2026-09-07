import { useCallback, useEffect, useRef, useState } from 'react'
import type { MachineState } from '../types'
import { blankState } from '../lib/calc'
import { machines } from '../data'
import { enqueue, getAllStates, isDirty, putState } from '../lib/db'
import { drainOutbox, pullAll, refreshPending, startSync } from '../lib/sync'
import type { FieldGroup } from '../lib/db'

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

  // Boot: local cache first (instant, works offline), then the server.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const local = await getAllStates()
      if (!cancelled) { setStates(seed(local)); setReady(true) }
      try {
        const remote = await pullAll()
        if (cancelled) return
        // The outbox is the durable record of unsynced work - dirtyRef would
        // be empty after a reload, and pulling would then overwrite an
        // inspector's offline edits.
        for (const [lotKey, state] of Object.entries(remote)) {
          const lot = Number(lotKey)
          const dirty = await Promise.all(GROUPS.map(g => isDirty(lot, g)))
          if (dirty.some(Boolean)) continue
          await putState(lot, state)
        }
        setStates(seed({ ...(await getAllStates()) }))
      } catch { /* offline: the local cache stands */ }
    })()
    return () => { cancelled = true }
  }, [])

  // Realtime: sync.ts already guards against overwriting a dirty lot, so this
  // callback just applies whatever it is handed.
  useEffect(() => startSync((lot, remote) => {
    setStates(prev => ({ ...prev, [lot]: { ...blankState(), ...remote } }))
  }), [])

  const patchState = useCallback((lot: number, group: FieldGroup, fn: (s: MachineState) => MachineState) => {
    if (!canWrite) return
    const updatedAt = new Date().toISOString()
    const next = fn(statesRef.current[lot] ?? blankState())
    const payload =
      group === 'inspection' ? next.inspection :
      group === 'commercial' ? next.commercial :
      { decision: next.decision, shortlist: next.shortlist }

    setStates(prev => ({ ...prev, [lot]: next }))

    // Fire-and-forget: the UI must never wait on storage or the network.
    // db.ts reports failures via onStorageError, so these catches only swallow.
    void putState(lot, next).catch(() => {})
    void enqueue({ lot, group, payload, updatedAt })
      .then(() => refreshPending())
      .then(() => { if (navigator.onLine) return drainOutbox() })
      .catch(() => {})
  }, [canWrite])

  return { states, ready, patchState }
}
