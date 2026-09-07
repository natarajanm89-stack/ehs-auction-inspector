import { createClient } from '@supabase/supabase-js'
import { assertNotServiceRole } from './keyGuard'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill it in.'
  )
}

// Fatal in a production build, which is what gets published. In dev it is only a
// warning, so local work can continue while the key is being sorted out - but
// note RLS is NOT being exercised honestly while a service_role key is in use.
const keyWarning = assertNotServiceRole(key, import.meta.env.PROD)
if (keyWarning) console.error('[ehs] ' + keyWarning)

export const supabase = createClient(url, key, {
  db: { schema: 'ehs' },   // this project's public schema belongs to another app
  auth: { persistSession: true, autoRefreshToken: true },
})

let sessionPromise: Promise<string> | null = null

/**
 * Returns the anonymous user id, creating a session on first run.
 * The in-flight promise is shared so concurrent callers on a cold start do not
 * each trigger a separate anonymous sign-in.
 */
export function ensureSession(): Promise<string> {
  if (!sessionPromise) {
    sessionPromise = bootstrapSession().finally(() => { sessionPromise = null })
  }
  return sessionPromise
}

/**
 * Drops any in-flight/memoized session promise so the next ensureSession()
 * call genuinely re-derives the identity instead of handing back a cached
 * one. Needed after an explicit signOut() - without this, a caller that
 * signed out and immediately called ensureSession() could still receive an
 * id from a bootstrap that started (and was memoized) before the sign-out.
 */
export function resetSession(): void {
  sessionPromise = null
}

// getSession() in supabase-js v2 refreshes an expired session itself and returns
// null if the refresh token has been revoked, so a revoked session falls through
// to a fresh anonymous sign-in below.
async function bootstrapSession(): Promise<string> {
  const { data: existing } = await supabase.auth.getSession()
  if (existing.session?.user) return existing.session.user.id

  const { data, error } = await supabase.auth.signInAnonymously()
  if (error) throw error
  return data.user!.id
}
