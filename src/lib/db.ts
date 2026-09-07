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
  updatedAt: string   // ISO 8601
}

const outboxKey = (lot: number, group: FieldGroup) => `${lot}:${group}`

export async function getState(lot: number): Promise<MachineState | null> {
  return (await get<MachineState>(String(lot), stateStore)) ?? null
}

export async function putState(lot: number, state: MachineState): Promise<void> {
  await set(String(lot), state, stateStore)
}

export async function getAllStates(): Promise<Record<number, MachineState>> {
  const all: Record<number, MachineState> = {}
  for (const k of await keys(stateStore)) {
    const s = await get<MachineState>(k as string, stateStore)
    if (s) all[Number(k)] = s
  }
  return all
}

export async function enqueue(entry: OutboxEntry): Promise<void> {
  const key = outboxKey(entry.lot, entry.group)
  const existing = await get<OutboxEntry>(key, outboxStore)
  // Collapse to the newest edit. An out-of-order enqueue must not win.
  if (existing && existing.updatedAt > entry.updatedAt) return
  await set(key, entry, outboxStore)
}

export async function listOutbox(): Promise<OutboxEntry[]> {
  const out: OutboxEntry[] = []
  for (const k of await keys(outboxStore)) {
    const e = await get<OutboxEntry>(k as string, outboxStore)
    if (e) out.push(e)
  }
  return out.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
}

/** Clears the entry only if it has not been superseded by a newer edit. */
export async function dequeue(lot: number, group: FieldGroup, updatedAt: string): Promise<void> {
  const key = outboxKey(lot, group)
  const existing = await get<OutboxEntry>(key, outboxStore)
  if (existing && existing.updatedAt === updatedAt) await del(key, outboxStore)
}

export async function isDirty(lot: number, group: FieldGroup): Promise<boolean> {
  return (await get<OutboxEntry>(outboxKey(lot, group), outboxStore)) !== undefined
}

export async function putPhotoBlob(id: string, blob: Blob): Promise<void> {
  await set(id, blob, photoStore)
}
export async function getPhotoBlob(id: string): Promise<Blob | null> {
  return (await get<Blob>(id, photoStore)) ?? null
}
export async function deletePhotoBlob(id: string): Promise<void> {
  await del(id, photoStore)
}
export async function listPendingPhotos(): Promise<string[]> {
  return (await keys(photoStore)).map(String)
}

/** Test helper. Also used by the "reset this device" action in Settings. */
export async function clearAll(): Promise<void> {
  for (const store of [stateStore, outboxStore, photoStore]) {
    for (const k of await keys(store)) await del(k as string, store)
  }
}
