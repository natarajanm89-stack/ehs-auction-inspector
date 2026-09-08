import { useCallback, useEffect, useRef, useState } from 'react'
import { ensureSession } from '../lib/supabase'
import { cachedProfile, cacheProfile, fetchProfile, redeemCode, type Profile } from '../lib/profile'
import { getMode, getLocalName } from '../lib/mode'

// profile.ts throws human-readable messages for the cases it recognises, but a
// genuinely unexpected failure (an RPC/Postgres error it didn't map) still
// surfaces its raw driver message. Inspectors reading this are on phones in
// an auction yard, not developers, so anything that looks like a raw
// database/driver string gets swapped for a plain-language fallback.
function looksLikeRawDbError(message: string): boolean {
  const m = message.toLowerCase()
  return /violates|constraint|relation|column|syntax error|pg_|postgrest|\b\d{5}\b/.test(m)
}

function readableRedeemError(err: unknown): string {
  if (err instanceof Error && err.message && !looksLikeRawDbError(err.message)) {
    return err.message
  }
  return 'Something went wrong verifying that code. Please try again.'
}

const SINGLE_MODE_PROFILE: Profile = { id: 'local', display_name: getLocalName(), role: 'admin' }

export function Gate({ children }: { children: (profile: Profile) => React.ReactNode }) {
  if (getMode() === 'single') {
    // No account, no network: single-device mode skips ensureSession/fetchProfile
    // entirely. 'admin' here means only "no UI control is disabled" - there is
    // no server to enforce anything against.
    return <>{children({ ...SINGLE_MODE_PROFILE, display_name: getLocalName() })}</>
  }

  return <CollaborativeGate>{children}</CollaborativeGate>
}

function CollaborativeGate({ children }: { children: (profile: Profile) => React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [booting, setBooting] = useState(true)
  const [offline, setOffline] = useState(false)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)

  const boot = useCallback(async () => {
    setOffline(false)
    const cached = cachedProfile()
    if (cached) {
      setProfile(cached)
      setBooting(false)
    } else {
      setBooting(true)
    }

    try {
      await ensureSession()
      const fresh = await fetchProfile()
      if (fresh) {
        setProfile(fresh)
      } else {
        // Authoritative: server says no profile. Clear any stale cache.
        cacheProfile(null)
        setProfile(null)
      }
      setError('')
    } catch (e) {
      if (!cached) {
        setOffline(true)
        setError(e instanceof Error ? e.message : 'Could not reach the server.')
      }
      // If we have a cached profile, keep showing the app - the refresh
      // failed but there's nothing to correct for yet.
    } finally {
      setBooting(false)
    }
  }, [])

  useEffect(() => {
    boot()
  }, [boot])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting.current) return
    submitting.current = true
    setError('')
    setBusy(true)
    try {
      await redeemCode(code, name)
      setProfile(await fetchProfile())
    } catch (err) {
      setError(readableRedeemError(err))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  if (booting) return <div className="gate"><p>Starting…</p></div>
  if (profile) return <>{children(profile)}</>

  if (offline) {
    return (
      <div className="gate">
        <div className="gate-card">
          <div className="brand-mark">EHS</div>
          <h1>Auction Inspector</h1>
          <p className="gate-error" role="alert">
            Can't reach the server. Check your connection and try again.
          </p>
          <button className="primary wide" onClick={() => boot()}>Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <div className="brand-mark">EHS</div>
        <h1>Auction Inspector</h1>
        <p className="muted">Enter the access code your team lead gave you.</p>

        <label>Access code
          <input value={code} onChange={e => setCode(e.target.value)}
                 autoComplete="off" autoCapitalize="none" autoCorrect="off"
                 spellCheck={false} required />
        </label>

        <label>Your name
          <input value={name} onChange={e => setName(e.target.value)}
                 placeholder="e.g. Rakesh S." maxLength={60} required />
        </label>

        {error && <p className="gate-error" role="alert">{error}</p>}

        <button className="primary wide" disabled={busy || !code.trim() || !name.trim()}>
          {busy ? 'Checking…' : 'Enter'}
        </button>
        <small className="muted">Your code decides what you can do. Inspectors record
          findings; viewers read and comment.</small>
      </form>
    </div>
  )
}
