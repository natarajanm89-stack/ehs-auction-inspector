import type { MachineState } from '../types'

// A second, independent copy of inspection + commercial state, written to
// localStorage - a different storage mechanism from IndexedDB with different
// failure modes. Photos are blobs and are deliberately excluded: they would
// blow the localStorage quota (usually 5-10MB) almost instantly.
const BACKUP_KEY = 'ehs-backup-v1'
const LAST_EXPORT_KEY = 'ehs-last-export'
const LAST_CHANGE_KEY = 'ehs-last-change'

export interface Backup {
  savedAt: string
  states: Record<number, MachineState>
}

type StorageErrorListener = (message: string) => void
const backupErrorListeners = new Set<StorageErrorListener>()

/** Lets db.ts's existing onStorageError channel also learn about backup failures. */
export function onBackupError(fn: StorageErrorListener): () => void {
  backupErrorListeners.add(fn)
  return () => { backupErrorListeners.delete(fn) }
}

/**
 * Strips photo-bearing fields from a state before mirroring it. Inspection
 * and commercial fields hold no blobs today, but this keeps the guarantee
 * explicit even if fields are added later.
 */
function toBackupState(s: MachineState): MachineState {
  return { shortlist: s.shortlist, decision: s.decision, inspection: s.inspection, commercial: s.commercial }
}

export function writeBackup(states: Record<number, MachineState>): void {
  try {
    const payload: Backup = {
      savedAt: new Date().toISOString(),
      states: Object.fromEntries(Object.entries(states).map(([lot, s]) => [lot, toBackupState(s)])),
    }
    localStorage.setItem(BACKUP_KEY, JSON.stringify(payload))
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    backupErrorListeners.forEach(fn => fn(`Could not write on-device backup (${detail}).`))
  }
}

export function readBackup(): Backup | null {
  try {
    const raw = localStorage.getItem(BACKUP_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !parsed.states) return null
    return parsed as Backup
  } catch {
    return null
  }
}

export function setLastExport(when: string = new Date().toISOString()): void {
  try { localStorage.setItem(LAST_EXPORT_KEY, when) } catch { /* ignore */ }
}

export function getLastExport(): string | null {
  try { return localStorage.getItem(LAST_EXPORT_KEY) } catch { return null }
}

export function setLastChange(when: string = new Date().toISOString()): void {
  try { localStorage.setItem(LAST_CHANGE_KEY, when) } catch { /* ignore */ }
}

export function getLastChange(): string | null {
  try { return localStorage.getItem(LAST_CHANGE_KEY) } catch { return null }
}

/** True when there is unexported work: some change happened and either
 *  nothing has been exported yet, or the export predates the latest change. */
export function hasUnexportedWork(lastChange: string | null, lastExport: string | null): boolean {
  if (!lastChange) return false
  if (!lastExport) return true
  return lastExport < lastChange
}
