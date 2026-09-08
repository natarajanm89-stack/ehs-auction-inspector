import { isSupabaseConfigured } from './supabase'
import { cachedProfile } from './profile'

export type AppMode = 'single' | 'collaborative'

const MODE_KEY = 'ehs-mode'
const LOCAL_NAME_KEY = 'ehs-local-name'
const DEFAULT_LOCAL_NAME = 'Inspector'

/**
 * Reads the device's mode. If no mode has ever been stored but a cached
 * profile exists, the device was already using the shared app before this
 * concept existed - treat it as `collaborative` and persist that so the
 * inspector is not silently demoted to single mode and made to look like
 * they have lost their team's data.
 */
export function getMode(): AppMode {
  const stored = readStored()
  if (stored) return stored

  if (cachedProfile()) {
    setMode('collaborative')
    return 'collaborative'
  }

  return 'single'
}

export function setMode(m: AppMode): void {
  try {
    localStorage.setItem(MODE_KEY, m)
  } catch { /* private mode or quota: mode just won't persist across reloads */ }
}

function readStored(): AppMode | null {
  try {
    const raw = localStorage.getItem(MODE_KEY)
    return raw === 'single' || raw === 'collaborative' ? raw : null
  } catch {
    return null
  }
}

/** Collaborative mode can only be selected in a build with Supabase credentials. */
export function isCollaborativeAvailable(): boolean {
  return isSupabaseConfigured
}

export function getLocalName(): string {
  try {
    return localStorage.getItem(LOCAL_NAME_KEY) || DEFAULT_LOCAL_NAME
  } catch {
    return DEFAULT_LOCAL_NAME
  }
}

export function setLocalName(name: string): void {
  try {
    localStorage.setItem(LOCAL_NAME_KEY, name)
  } catch { /* private mode or quota: name just won't persist across reloads */ }
}
