import { useCallback, useEffect, useRef, useState } from 'react'
import type { MachineState } from '../types'
import { blankState } from '../lib/calc'
import { machines } from '../data'
import { enqueue, getAllStates, isDirty, putState } from '../lib/db'
import { drainOutbox, pullAll, startSync } from '../lib/sync'
import type { FieldGroup } from '../lib/db'

function seed(partial: Record<number, MachineState>): Record<number, MachineState> {
  return Object.fromEntries(
    machines.map(m => [m.lot, partial[m.lot] ? { ...blankState(), ...partial[m.lot] } : blankState()])
  )
}

export function useAllMachineStates(canWrite: boolean) {
  const [states, setStates] = useState<Record<number, MachineState>>(() => seed({}))
  const [ready, setReady] = useState(false)
  const dirtyRef = useRef<Set<string>>(new Set())

  // Boot: local cache first (instant, works offline), then the server.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const local = await getAllStates()
      if (!cancelled) { setStates(seed(local)); setReady(true) }
      try {
        const remote = await pullAll()
        if (cancelled) return
        for (const [lot, state] of Object.entries(remote)) {
          // Never overwrite a lot with unsent local edits.
          if (dirtyRef.current.has(`${lot}:inspection`)) continue
          await putState(Number(lot), state)
        }
        setStates(seed({ ...(await getAllStates()) }))
      } catch { /* offline: the local cache stands */ }
    })()
    return () => { cancelled = true }
  }, [])

  // Realtime: apply inbound rows unless the lot is locally dirty.
  useEffect(() => startSync(async (lot, remote) => {
    const groups: FieldGroup[] = ['inspection', 'commercial', 'decision']
    const dirty = await Promise.all(groups.map(g => isDirty(lot, g)))
    if (dirty.some(Boolean)) return
    setStates(prev => ({ ...prev, [lot]: { ...blankState(), ...remote } }))
  }), [])

  const patchState = useCallback((lot: number, group: FieldGroup, fn: (s: MachineState) => MachineState) => {
    if (!canWrite) return
    const updatedAt = new Date().toISOString()

    setStates(prev => {
      const next = fn(prev[lot] ?? blankState())
      const payload =
        group === 'inspection' ? next.inspection :
        group === 'commercial' ? next.commercial :
        { decision: next.decision, shortlist: next.shortlist }

      dirtyRef.current.add(`${lot}:${group}`)
      // Fire-and-forget: the UI must not wait on storage or the network.
      // db.ts reports failures via onStorageError and re-throws, so these
      // catches only swallow the rejection - the user has already been told.
      void putState(lot, next).catch(() => { /* reported via onStorageError */ })
      void enqueue({ lot, group, payload, updatedAt })
        .then(() => { if (navigator.onLine) return drainOutbox() })
        .catch(() => { /* reported via onStorageError */ })
        .finally(() => { dirtyRef.current.delete(`${lot}:${group}`) })

      return { ...prev, [lot]: next }
    })
  }, [canWrite])

  return { states, ready, patchState }
}
