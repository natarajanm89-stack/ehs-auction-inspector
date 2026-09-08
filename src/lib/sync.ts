import { requireSupabase } from './supabase'
import { dequeue, isDirty, listOutbox, putState, type FieldGroup } from './db'
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

// Lots skipped by the realtime handler because they were dirty at the time -
// they need a follow-up pull once their outbox entries have cleared, since
// nothing else re-fetches them and pullAll only runs once at boot.
const pendingPull = new Set<number>()
const PENDING_PULL_LIMIT = 50
let currentOnRemoteState: ((lot: number, state: MachineState) => void) | null = null

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
  const supabase = requireSupabase()
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

  // Reconcile lots the realtime handler skipped while they were dirty. Only
  // once the outbox is fully drained (empty), otherwise a lot could still be
  // mid-push and we'd race with it.
  if ((await listOutbox()).length === 0 && pendingPull.size > 0) {
    await reconcilePending()
  }

  return { pushed, failed }
}

async function reconcilePending(): Promise<void> {
  if (pendingPull.size > PENDING_PULL_LIMIT) {
    // Cheaper to just refetch everything than track hundreds of rows.
    const lots = [...pendingPull]
    pendingPull.clear()
    try {
      const remote = await pullAll()
      for (const lot of lots) {
        const state = remote[lot]
        if (!state) continue
        await putState(lot, state)
        currentOnRemoteState?.(lot, state)
      }
    } catch { /* offline: try again on the next drain */ }
    return
  }

  for (const lot of [...pendingPull]) {
    const groups: FieldGroup[] = ['inspection', 'commercial', 'decision']
    const dirty = await Promise.all(groups.map(g => isDirty(lot, g)))
    if (dirty.some(Boolean)) continue // still dirty: leave queued, retry next time

    const state = await pullLot(lot)
    pendingPull.delete(lot)
    if (!state) continue
    await putState(lot, state)
    currentOnRemoteState?.(lot, state)
  }
}

export async function pullLot(lot: number): Promise<MachineState | null> {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('machine_states')
    .select('*')
    .eq('lot', lot)
    .maybeSingle()
  if (error || !data) return null
  return rowToState(data)
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
  const supabase = requireSupabase()
  const { data, error } = await supabase.from('machine_states').select('*')
  if (error) throw error
  const out: Record<number, MachineState> = {}
  for (const row of data ?? []) out[row.lot] = rowToState(row)
  return out
}

/**
 * Starts background sync: drains on reconnect and on an interval, and applies
 * inbound realtime rows. Returns a cleanup function.
 *
 * The dirty check lives here, not with the caller: the outbox is the durable
 * record of unsynced local edits (it survives reloads, unlike any in-memory
 * flag), and both the cache write (putState) and the caller's callback must
 * be gated on it - a dirty lot's local cache must never be clobbered even if
 * the caller only guards its own copy.
 */
export function startSync(onRemoteState: (lot: number, state: MachineState) => void): () => void {
  const supabase = requireSupabase()
  currentOnRemoteState = onRemoteState
  const online  = () => { void refreshPending().then(() => drainOutbox()); scheduleBackfill() }
  const offline = () => emit({ status: 'offline' })
  const onVisible = () => { if (document.visibilityState === 'visible') scheduleBackfill() }

  // A dropped realtime connection (phone lock, cell handover, laptop sleep)
  // leaves no backfill: on reconnect / becoming visible, re-pull everything
  // and hand each row through the same isDirty-guarded path as realtime, so
  // a viewer's screen doesn't sit stale while looking live. Debounced so a
  // rapid visibility flap (locking/unlocking quickly) doesn't fire several
  // pulls at once.
  let backfillTimer: number | undefined
  function scheduleBackfill() {
    window.clearTimeout(backfillTimer)
    backfillTimer = window.setTimeout(() => { void backfill() }, 500)
  }
  async function backfill() {
    if (!navigator.onLine) return
    try {
      const remote = await pullAll()
      const groups: FieldGroup[] = ['inspection', 'commercial', 'decision']
      for (const [lotKey, state] of Object.entries(remote)) {
        const lot = Number(lotKey)
        const dirty = await Promise.all(groups.map(g => isDirty(lot, g)))
        if (dirty.some(Boolean)) continue
        await putState(lot, state)
        currentOnRemoteState?.(lot, state)
      }
    } catch { /* offline or transient error: try again on the next trigger */ }
  }

  window.addEventListener('online', online)
  window.addEventListener('offline', offline)
  document.addEventListener('visibilitychange', onVisible)

  const timer = window.setInterval(() => { if (navigator.onLine) void drainOutbox() }, 15_000)

  const channel = supabase
    .channel('machine_states_stream')
    .on('postgres_changes',
        { event: '*', schema: 'ehs', table: 'machine_states' },
        async (payload: any) => {
          const row: any = payload.new
          if (!row?.lot) return
          // Never overwrite a lot with unsynced local edits - the outbox is the
          // durable record of those, and it survives reloads.
          const groups: FieldGroup[] = ['inspection', 'commercial', 'decision']
          const dirty = await Promise.all(groups.map(g => isDirty(row.lot, g)))
          if (dirty.some(Boolean)) {
            if (pendingPull.size >= PENDING_PULL_LIMIT) {
              pendingPull.clear()
            }
            pendingPull.add(row.lot)
            return
          }
          const state = rowToState(row)
          await putState(row.lot, state)
          onRemoteState(row.lot, state)
        })
    .subscribe()

  void refreshPending().then(() => { if (navigator.onLine) return drainOutbox() })

  return () => {
    window.removeEventListener('online', online)
    window.removeEventListener('offline', offline)
    document.removeEventListener('visibilitychange', onVisible)
    window.clearTimeout(backfillTimer)
    window.clearInterval(timer)
    void supabase.removeChannel(channel)
    currentOnRemoteState = null
    pendingPull.clear()
  }
}
