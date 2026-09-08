import { get, set, del, keys, createStore } from 'idb-keyval'
import type { MachineState } from '../types'

// Each store gets its own IndexedDB database. idb-keyval's createStore opens
// its db without a version bump, so multiple stores sharing one db name only
// ever get the first store created (the others silently 404 on later opens).
const stateStore  = createStore('ehs-inspector-states', 'states')
const outboxStore = createStore('ehs-inspector-outbox', 'outbox')
const photoStore  = createStore('ehs-inspector-photos', 'photos')

export type FieldGroup = 'inspection' | 'commercial' | 'decision'

export interface OutboxEntry {
  lot: number
  group: FieldGroup
  payload: unknown
  // Must be `new Date().toISOString()` output - UTC with a `Z` suffix and
  // millisecond precision. Collapsing and dequeue-guard logic below compares
  // these values lexicographically; a local-offset timestamp would sort
  // wrongly. On an exact tie the newer entry intentionally wins (the guard
  // is `>`, not `>=`) - a same-millisecond re-edit should overwrite.
  updatedAt: string   // ISO 8601
}

const outboxKey = (lot: number, group: FieldGroup) => `${lot}:${group}`

type StorageErrorListener = (message: string) => void
const storageErrorListeners = new Set<StorageErrorListener>()

/**
 * Storage failures are not recoverable in place - quota exceeded, private
 * browsing, a blocked upgrade - but the user must be told, because the
 * local copy is the source of truth and a silent failure loses their work.
 */
export function onStorageError(fn: StorageErrorListener): () => void {
  storageErrorListeners.add(fn)
  return () => { storageErrorListeners.delete(fn) }
}

function reportStorageError(op: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err)
  const message =
    detail.toLowerCase().includes('quota')
      ? 'Device storage is full. Export your session and clear photos to continue saving.'
      : `Could not save to this device (${op}). Your last change may not be stored.`
  storageErrorListeners.forEach(fn => fn(message))
}

export async function getState(lot: number): Promise<MachineState | null> {
  try {
    return (await get<MachineState>(String(lot), stateStore)) ?? null
  } catch (err) {
    reportStorageError('getState', err)
    return null
  }
}

export async function putState(lot: number, state: MachineState): Promise<void> {
  try {
    await set(String(lot), state, stateStore)
  } catch (err) {
    reportStorageError('putState', err)
    throw err
  }
}

export async function getAllStates(): Promise<Record<number, MachineState>> {
  try {
    const all: Record<number, MachineState> = {}
    for (const k of await keys(stateStore)) {
      const s = await get<MachineState>(k as string, stateStore)
      if (s) all[Number(k)] = s
    }
    return all
  } catch (err) {
    reportStorageError('getAllStates', err)
    return {}
  }
}

export async function enqueue(entry: OutboxEntry): Promise<void> {
  try {
    const key = outboxKey(entry.lot, entry.group)
    const existing = await get<OutboxEntry>(key, outboxStore)
    // Collapse to the newest edit. An out-of-order enqueue must not win.
    if (existing && existing.updatedAt > entry.updatedAt) return
    await set(key, entry, outboxStore)
  } catch (err) {
    reportStorageError('enqueue', err)
    throw err
  }
}

export async function listOutbox(): Promise<OutboxEntry[]> {
  try {
    const out: OutboxEntry[] = []
    for (const k of await keys(outboxStore)) {
      const e = await get<OutboxEntry>(k as string, outboxStore)
      if (e) out.push(e)
    }
    return out.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
  } catch (err) {
    reportStorageError('listOutbox', err)
    return []
  }
}

/** Clears the entry only if it has not been superseded by a newer edit. */
export async function dequeue(lot: number, group: FieldGroup, updatedAt: string): Promise<void> {
  try {
    const key = outboxKey(lot, group)
    const existing = await get<OutboxEntry>(key, outboxStore)
    if (existing && existing.updatedAt === updatedAt) await del(key, outboxStore)
  } catch (err) {
    reportStorageError('dequeue', err)
    throw err
  }
}

export async function isDirty(lot: number, group: FieldGroup): Promise<boolean> {
  try {
    return (await get<OutboxEntry>(outboxKey(lot, group), outboxStore)) !== undefined
  } catch (err) {
    reportStorageError('isDirty', err)
    return false
  }
}

export async function putPhotoBlob(id: string, blob: Blob): Promise<void> {
  try {
    await set(id, blob, photoStore)
  } catch (err) {
    reportStorageError('putPhotoBlob', err)
    throw err
  }
}
export async function getPhotoBlob(id: string): Promise<Blob | null> {
  try {
    return (await get<Blob>(id, photoStore)) ?? null
  } catch (err) {
    reportStorageError('getPhotoBlob', err)
    return null
  }
}
export async function deletePhotoBlob(id: string): Promise<void> {
  try {
    await del(id, photoStore)
  } catch (err) {
    reportStorageError('deletePhotoBlob', err)
    throw err
  }
}
export async function listPendingPhotos(): Promise<string[]> {
  try {
    return (await keys(photoStore)).map(String)
  } catch (err) {
    reportStorageError('listPendingPhotos', err)
    return []
  }
}

/** Test helper. Also used by the "reset this device" action in Settings. */
export async function clearAll(): Promise<void> {
  for (const store of [stateStore, outboxStore, photoStore]) {
    for (const k of await keys(store)) await del(k as string, store)
  }
}
