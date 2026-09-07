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

export async function fetchProfile(): Promise<Profile | null> {
  const { data: session } = await supabase.auth.getSession()
  const uid = session.session?.user?.id
  if (!uid) return null

  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, role')
    .eq('id', uid)
    .maybeSingle()

  if (error) throw error
  return (data as Profile) ?? null
}

export async function redeemCode(code: string, displayName: string): Promise<Role> {
  const { data, error } = await supabase.rpc('redeem_access_code', {
    p_code: code.trim(),
    p_display_name: displayName.trim(),
  })
  if (error) throw new Error(error.message)
  if (data === 'invalid_code') throw new Error('That access code is not recognised.')
  if (data === 'rate_limited') throw new Error('Too many attempts. Wait 15 minutes and try again.')
  return data as Role
}
