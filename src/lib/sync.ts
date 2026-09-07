import { supabase } from './supabase'
import { dequeue, listOutbox, putState, type FieldGroup } from './db'
import { blankState } from './calc'
import type { MachineState } from '../types'

export type SyncStatus = 'synced' | 'pending' | 'offline' | 'error'

export interface SyncSnapshot {
  status: SyncStatus
  pending: number
  lastSyncedAt: string | null
}

let snapshot: SyncSnapshot = { status: 'synced', pending: 0, lastSyncedAt: null }
const listeners = new Set<(s: SyncSnapshot) => void>()
let draining = false

export function subscribeStatus(fn: (s: SyncSnapshot) => void): () => void {
  listeners.add(fn)
  fn(snapshot)
  return () => { listeners.delete(fn) }
}

function emit(patch: Partial<SyncSnapshot>) {
  snapshot = { ...snapshot, ...patch }
  listeners.forEach(fn => fn(snapshot))
}

export async function refreshPending(): Promise<void> {
  const pending = (await listOutbox()).length
  const status: SyncStatus = !navigator.onLine ? 'offline' : pending ? 'pending' : 'synced'
  emit({ pending, status })
}

/** Pushes every queued field-group. Safe to call repeatedly. */
export async function drainOutbox(): Promise<{ pushed: number; failed: number }> {
  if (draining) return { pushed: 0, failed: 0 }
  draining = true
  let pushed = 0, failed = 0

  try {
    // Re-check after each pass: edits made while a push was in flight would
    // otherwise wait for the next interval tick, and the badge would read
    // "synced" while an entry was still queued.
    for (;;) {
      const batch = await listOutbox()
      if (batch.length === 0) break
      let progressed = false

      for (const e of batch) {
        const { data, error } = await supabase.rpc('sync_machine_state', {
          p_lot: e.lot,
          p_group: e.group,
          p_payload: e.payload,
          p_client_updated_at: e.updatedAt,
        })

        if (error) { failed++; continue }   // stays queued, retried later
        // data === false means the server already holds a newer value.
        // Our copy is stale; clearing it is correct, retrying is not.
        await dequeue(e.lot, e.group as FieldGroup, e.updatedAt)
        pushed++
        progressed = true
        void data
      }

      if (!progressed) break   // every remaining entry failed; retry later
    }
  } finally {
    draining = false
  }

  await refreshPending()
  if (pushed && !failed) emit({ lastSyncedAt: new Date().toISOString() })
  if (failed) emit({ status: navigator.onLine ? 'error' : 'offline' })
  return { pushed, failed }
}

// The server stores {} for untouched lots' inspection/commercial columns, so
// defaults must be merged in here rather than left to every consumer - a
// shallow merge downstream (`{ ...blankState(), ...pulled }`) would replace
// the whole default inspection object and drop `scores`/`critical`.
function rowToState(row: any): MachineState {
  const base = blankState()
  return {
    inspection: { ...base.inspection, ...(row.inspection ?? {}) },
    commercial: { ...base.commercial, ...(row.commercial ?? {}) },
    decision:   row.decision  ?? base.decision,
    shortlist:  row.shortlist ?? base.shortlist,
  }
}

export async function pullAll(): Promise<Record<number, MachineState>> {
  const { data, error } = await supabase.from('machine_states').select('*')
  if (error) throw error
  const out: Record<number, MachineState> = {}
  for (const row of data ?? []) out[row.lot] = rowToState(row)
  return out
}

/**
 * Starts background sync: drains on reconnect and on an interval, and applies
 * inbound realtime rows. Returns a cleanup function.
 */
export function startSync(onRemoteState: (lot: number, state: MachineState) => void): () => void {
  const online  = () => { void refreshPending().then(() => drainOutbox()) }
  const offline = () => emit({ status: 'offline' })

  window.addEventListener('online', online)
  window.addEventListener('offline', offline)

  const timer = window.setInterval(() => { if (navigator.onLine) void drainOutbox() }, 15_000)

  const channel = supabase
    .channel('machine_states_stream')
    .on('postgres_changes',
        { event: '*', schema: 'ehs', table: 'machine_states' },
        async (payload: any) => {
          const row: any = payload.new
          if (!row?.lot) return
          const state = rowToState(row)
          await putState(row.lot, state)
          onRemoteState(row.lot, state)
        })
    .subscribe()

  void refreshPending().then(() => { if (navigator.onLine) return drainOutbox() })

  return () => {
    window.removeEventListener('online', online)
    window.removeEventListener('offline', offline)
    window.clearInterval(timer)
    void supabase.removeChannel(channel)
  }
}
