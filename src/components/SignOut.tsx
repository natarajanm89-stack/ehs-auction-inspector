import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { cacheProfile } from '../lib/profile'
import { subscribeStatus, type SyncSnapshot } from '../lib/sync'

/**
 * Signing out destroys the anonymous identity permanently - there is no signing
 * back into it, only redeeming a code as a new user. So it is blocked while any
 * edit is still queued: an inspector must never be able to wipe a morning's work
 * with one mistap at a live auction.
 */
export function SignOut() {
  const [sync, setSync] = useState<SyncSnapshot>({ status: 'synced', pending: 0, lastSyncedAt: null })
  useEffect(() => subscribeStatus(setSync), [])

  const blocked = sync.pending > 0 || sync.status !== 'synced'

  const signOut = async () => {
    if (blocked) return
    if (!confirm('Sign out of this device? You will need an access code to get back in.')) return
    cacheProfile(null)
    await supabase.auth.signOut()
    location.reload()
  }

  return (
    <div className="panel danger-panel">
      <h3>Sign out</h3>
      <p>Clears your identity on this device. Anyone using it next will need an
         access code. Inspection data already uploaded is not affected.</p>
      {blocked && (
        <p className="muted" role="status">
          {sync.pending} change{sync.pending > 1 ? 's have' : ' has'} not uploaded yet.
          Sign-out is available once everything has synced.
        </p>
      )}
      <button className="danger-button" onClick={signOut} disabled={blocked}>
        {blocked ? 'Waiting for sync…' : 'Sign out'}
      </button>
    </div>
  )
}
