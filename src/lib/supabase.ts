import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill it in.'
  )
}

// Refuse to run with a service_role key. It bypasses row-level security
// entirely, so shipping one would expose every table in the project - including
// the unrelated application sharing this database - to anyone who opens the site.
function assertNotServiceRole(k: string): void {
  const parts = k.split('.')
  if (parts.length !== 3) return           // non-JWT publishable key: fine
  try {
    const pad = parts[1] + '='.repeat((4 - (parts[1].length % 4)) % 4)
    const claims = JSON.parse(atob(pad.replace(/-/g, '+').replace(/_/g, '/')))
    if (claims.role === 'service_role') {
      const msg =
        'VITE_SUPABASE_ANON_KEY is a service_role key. Use the anon/public key - ' +
        'the service key bypasses row-level security and must never reach a browser.'
      // Fatal in a production build, which is what gets published. In dev it is
      // only a warning, so local work can continue while the key is being sorted
      // out - but note RLS is NOT being exercised honestly while it is in use.
      if (import.meta.env.PROD) throw new Error(msg)
      console.error('[ehs] ' + msg)
      return
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('VITE_SUPABASE_ANON_KEY')) throw e
    // Unparseable payload: not our concern, let the client surface any real error.
  }
}

assertNotServiceRole(key)

export const supabase = createClient(url, key, {
  db: { schema: 'ehs' },   // this project's public schema belongs to another app
  auth: { persistSession: true, autoRefreshToken: true },
})

/** Returns the anonymous user id, creating a session on first run. */
export async function ensureSession(): Promise<string> {
  const { data: existing } = await supabase.auth.getSession()
  if (existing.session?.user) return existing.session.user.id

  const { data, error } = await supabase.auth.signInAnonymously()
  if (error) throw error
  return data.user!.id
}
