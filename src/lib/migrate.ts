import type { MachineState } from '../types'
import { enqueue, putState } from './db'
import { drainOutbox } from './sync'

export const LEGACY_KEY = 'ehs-auction-inspector-state-v1'
export const MIGRATED_KEY = 'ehs-auction-inspector-migrated'

function hasWork(s: MachineState): boolean {
  if (!s) return false
  if (s.shortlist) return true
  if (Object.values(s.inspection?.scores ?? {}).some(v => v > 0)) return true
  if (Object.values(s.inspection?.critical ?? {}).some(v => v !== 'UNSET')) return true
  if ((s.inspection?.notes ?? '').trim()) return true
  if (s.inspection?.repairEstimateEur) return true
  if (s.commercial?.currentBidEur) return true
  if (s.commercial?.estimatedResaleInr) return true
  if (s.commercial?.manualMaxBidEur) return true
  return false
}

/** Lots in the old localStorage blob that hold real work. Null if there are none. */
export function readLegacyState(): Record<number, MachineState> | null {
  if (localStorage.getItem(MIGRATED_KEY)) return null
  const raw = localStorage.getItem(LEGACY_KEY)
  if (!raw) return null

  let parsed: Record<string, MachineState>
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null

  const out: Record<number, MachineState> = {}
  for (const [lot, state] of Object.entries(parsed)) {
    try {
      if (hasWork(state)) out[Number(lot)] = state
    } catch {
      // Malformed entry for this lot - skip it rather than let one bad
      // record abort the whole import.
    }
  }
  return Object.keys(out).length ? out : null
}

/** Queues every legacy lot for sync. Returns how many were imported. */
export async function importLegacy(): Promise<number> {
  const legacy = readLegacyState()
  if (!legacy) { localStorage.setItem(MIGRATED_KEY, new Date().toISOString()); return 0 }

  const updatedAt = new Date().toISOString()
  for (const [lotKey, state] of Object.entries(legacy)) {
    const lot = Number(lotKey)
    // The pre-migration build stored photos as base64 strings directly on
    // the state (`photos` is not part of the current MachineState type).
    // Photos now live in Supabase Storage, so a leftover `photos` field
    // must never be queued into the `inspection` JSONB column - it would
    // push a large base64 blob to the server and likely blow past payload
    // limits. Strip it defensively before writing or enqueuing anything.
    const { photos: _legacyPhotos, ...cleanState } = state as MachineState & { photos?: unknown }
    void _legacyPhotos
    const cleanInspection = { ...cleanState.inspection } as MachineState['inspection'] & { photos?: unknown }
    delete cleanInspection.photos

    await putState(lot, { ...cleanState, inspection: cleanInspection })
    await enqueue({ lot, group: 'inspection', payload: cleanInspection, updatedAt })
    await enqueue({ lot, group: 'commercial', payload: cleanState.commercial, updatedAt })
    await enqueue({ lot, group: 'decision', payload: { decision: cleanState.decision, shortlist: cleanState.shortlist }, updatedAt })
  }

  if (navigator.onLine) await drainOutbox()
  localStorage.setItem(MIGRATED_KEY, new Date().toISOString())
  return Object.keys(legacy).length
}
