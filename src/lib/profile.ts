import { supabase } from './supabase'

export type Role = 'admin' | 'inspector' | 'viewer'

export interface Profile {
  id: string
  display_name: string
  role: Role
}

export type Action = 'write_state' | 'write_catalog' | 'comment'

/**
 * UI convenience only. The authoritative check is the RLS policy in
 * db/0003_rls.sql — never rely on this for security.
 */
export function can(role: Role | null, action: Action): boolean {
  if (!role) return false
  switch (action) {
    case 'write_state':   return role === 'inspector' || role === 'admin'
    case 'write_catalog': return role === 'admin'
    case 'comment':       return true
  }
}

const PROFILE_CACHE_KEY = 'ehs-profile-v1'

/**
 * The last known profile, cached so the app opens offline. Role here is a UI
 * convenience only - the server re-checks every request against RLS, so a
 * tampered cache grants nothing.
 */
export function cachedProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    return p && typeof p.id === 'string' && typeof p.display_name === 'string'
      && (p.role === 'admin' || p.role === 'inspector' || p.role === 'viewer')
      ? p as Profile
      : null
  } catch {
    return null
  }
}

export function cacheProfile(p: Profile | null): void {
  try {
    if (p) localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(p))
    else localStorage.removeItem(PROFILE_CACHE_KEY)
  } catch { /* private mode or quota: the app still works, just re-prompts */ }
}

export async function fetchProfile(): Promise<Profile | null> {
  const { data: session } = await supabase.auth.getSession()
  const uid = session.session?.user?.id
  if (!uid) {
    cacheProfile(null)
    return null
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, role')
    .eq('id', uid)
    .maybeSingle()

  if (error) throw error
  const result = (data as Profile) ?? null
  cacheProfile(result)
  return result
}

export async function redeemCode(code: string, displayName: string): Promise<Role> {
  const { data, error } = await supabase.rpc('redeem_access_code', {
    p_code: code.trim(),
    p_display_name: displayName.trim(),
  })
  if (error) throw new Error(error.message)
  if (data === 'invalid_code') throw new Error('That access code is not recognised.')
  if (data === 'rate_limited') throw new Error('Too many attempts. Wait 15 minutes and try again.')
  if (data === 'admin' || data === 'inspector' || data === 'viewer') return data
  throw new Error('Unexpected response from the server. Try again.')
}
