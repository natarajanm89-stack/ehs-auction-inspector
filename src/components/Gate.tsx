import { useEffect, useState } from 'react'
import { ensureSession } from '../lib/supabase'
import { fetchProfile, redeemCode, type Profile } from '../lib/profile'

export function Gate({ children }: { children: (profile: Profile) => React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [booting, setBooting] = useState(true)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        await ensureSession()
        setProfile(await fetchProfile())
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not reach the server.')
      } finally {
        setBooting(false)
      }
    })()
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await redeemCode(code, name)
      setProfile(await fetchProfile())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify that code.')
    } finally {
      setBusy(false)
    }
  }

  if (booting) return <div className="gate"><p>Starting…</p></div>
  if (profile) return <>{children(profile)}</>

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <div className="brand-mark">EHS</div>
        <h1>Auction Inspector</h1>
        <p className="muted">Enter the access code your team lead gave you.</p>

        <label>Access code
          <input value={code} onChange={e => setCode(e.target.value)}
                 autoComplete="off" autoCapitalize="none" required />
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
