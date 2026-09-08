// Wraps the Storage Manager API. Absent on older Safari, so every call
// degrades gracefully rather than throwing.

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage || typeof navigator.storage.persist !== 'function') return false
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export async function isStoragePersisted(): Promise<boolean> {
  try {
    if (!navigator.storage || typeof navigator.storage.persisted !== 'function') return false
    return await navigator.storage.persisted()
  } catch {
    return false
  }
}

export interface StorageEstimateResult {
  usedMb: number
  quotaMb: number
  percent: number
}

export async function storageEstimate(): Promise<StorageEstimateResult | null> {
  try {
    if (!navigator.storage || typeof navigator.storage.estimate !== 'function') return null
    const { usage, quota } = await navigator.storage.estimate()
    if (!quota) return null
    const usedMb = (usage ?? 0) / (1024 * 1024)
    const quotaMb = quota / (1024 * 1024)
    return { usedMb, quotaMb, percent: (usage ?? 0) / quota * 100 }
  } catch {
    return null
  }
}
