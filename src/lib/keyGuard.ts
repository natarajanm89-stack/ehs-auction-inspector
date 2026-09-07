/**
 * Guards against shipping a Supabase service_role key to the browser. That key
 * bypasses row-level security entirely, and this project's database is shared
 * with an unrelated application, so a published bundle carrying one would expose
 * every table in the project.
 *
 * Pure by design: `isProd` is passed in rather than read from import.meta.env,
 * so the behaviour is directly testable.
 *
 * @returns a warning message when the key is a service_role key in development,
 *          or null when the key is acceptable.
 * @throws  when the key is a service_role key and `isProd` is true.
 */
export function assertNotServiceRole(key: string, isProd: boolean): string | null {
  if (roleFromJwt(key) !== 'service_role') return null

  const msg =
    'VITE_SUPABASE_ANON_KEY is a service_role key. Use the anon/public key - ' +
    'the service key bypasses row-level security and must never reach a browser.'
  if (isProd) throw new Error(msg)
  return msg
}

/** The `role` claim of a JWT, or null for a non-JWT or unparseable key. */
function roleFromJwt(key: string): string | null {
  const parts = key.split('.')
  if (parts.length !== 3) return null      // sb_publishable_... style key
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const claims = JSON.parse(atob(padded))
    return typeof claims.role === 'string' ? claims.role : null
  } catch {
    return null
  }
}
