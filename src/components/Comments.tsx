import { useCallback, useEffect, useState } from 'react'
import { requireSupabase } from '../lib/supabase'
import type { Profile } from '../lib/profile'
import { getMode } from '../lib/mode'

interface Comment {
  id: string
  lot: number
  author_id: string | null
  author_name: string
  body: string
  created_at: string
}

/**
 * Opening a thread writes a comment_reads row, but that write raises no
 * realtime event, so the badge would keep showing a stale count until the next
 * comment posted anywhere. This tells the badge directly.
 */
const readListeners = new Set<(lot: number) => void>()

function notifyRead(lot: number): void {
  readListeners.forEach(fn => fn(lot))
}

export function Comments({ lot, profile }: { lot: number; profile: Profile }) {
  const single = getMode() === 'single'
  const [items, setItems] = useState<Comment[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [sendError, setSendError] = useState('')

  const load = useCallback(async () => {
    if (single) return
    const supabase = requireSupabase()
    const { data } = await supabase.from('comments')
      .select('*').eq('lot', lot).order('created_at', { ascending: true })
    setItems((data ?? []) as Comment[])
    await supabase.from('comment_reads')
      .upsert({ profile_id: profile.id, lot, last_read_at: new Date().toISOString() })
    notifyRead(lot)
  }, [lot, profile.id, single])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (single) return
    const supabase = requireSupabase()
    const channel = supabase.channel(`comments_${lot}`)
      .on('postgres_changes',
          { event: 'INSERT', schema: 'ehs', table: 'comments', filter: `lot=eq.${lot}` },
          payload => {
            setItems(prev =>
              prev.some(c => c.id === (payload.new as Comment).id)
                ? prev
                : [...prev, payload.new as Comment])
            // The thread is open and visible, so a comment arriving for this
            // lot right now has effectively been seen — mark it read again
            // rather than letting the badge count it as unread.
            void supabase.from('comment_reads')
              .upsert({ profile_id: profile.id, lot, last_read_at: new Date().toISOString() })
              .then(() => notifyRead(lot))
          })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [lot, profile.id, single])

  const post = async (e: React.FormEvent) => {
    e.preventDefault()
    const body = draft.trim()
    if (!body) return
    setBusy(true)
    const supabase = requireSupabase()
    const { error } = await supabase.from('comments').insert({
      lot, author_id: profile.id, author_name: profile.display_name, body,
    })
    setBusy(false)
    if (!error) {
      setSendError('')
      setDraft('')
      await load()
      return
    }
    // Comments are not queued in the outbox (see the design doc) - the
    // minimum honest behaviour is to keep the draft and say so plainly,
    // rather than silently discarding what the inspector typed.
    setSendError('Not sent - you appear to be offline. Your text is kept; try again when you have signal.')
  }

  if (single) {
    return (
      <div className="panel comments">
        <h3>Team comments</h3>
        <p className="muted">Comments are available in collaborative mode.</p>
      </div>
    )
  }

  return (
    <div className="panel comments">
      <h3>Team comments</h3>
      {items.length === 0 && <p className="muted">No comments on this lot yet.</p>}
      <ul className="comment-list">
        {items.map(c => (
          <li key={c.id}>
            <div className="comment-head">
              <strong>{c.author_name}</strong>
              <time>{new Date(c.created_at).toLocaleString()}</time>
            </div>
            <p>{c.body}</p>
          </li>
        ))}
      </ul>
      <form onSubmit={post} className="comment-form">
        <textarea rows={3} value={draft} maxLength={4000}
                  onChange={e => setDraft(e.target.value)}
                  placeholder="Question or instruction for the inspection team…" />
        {sendError && <p className="comment-error" role="alert">{sendError}</p>}
        <button className="primary" disabled={busy || !draft.trim()}>
          {busy ? 'Posting…' : 'Post comment'}
        </button>
      </form>
    </div>
  )
}

/** Unread comment counts per lot, for the machine-card badge. */
export function useUnreadCounts(profileId: string): Record<number, number> {
  const [counts, setCounts] = useState<Record<number, number>>({})

  useEffect(() => {
    if (getMode() === 'single') return   // no comments, no unread counts
    const supabase = requireSupabase()
    const compute = async () => {
      const [{ data: reads }, { data: comments }] = await Promise.all([
        supabase.from('comment_reads').select('lot, last_read_at').eq('profile_id', profileId),
        supabase.from('comments').select('lot, created_at, author_id'),
      ])
      const readAt = new Map((reads ?? []).map(r => [r.lot, r.last_read_at]))
      const next: Record<number, number> = {}
      for (const c of comments ?? []) {
        if (c.author_id === profileId) continue          // your own aren't unread
        const seen = readAt.get(c.lot)
        if (!seen || c.created_at > seen) next[c.lot] = (next[c.lot] ?? 0) + 1
      }
      setCounts(next)
    }
    void compute()

    const onRead = (lot: number) => {
      setCounts(prev => (prev[lot] ? { ...prev, [lot]: 0 } : prev))
    }
    readListeners.add(onRead)

    const channel = supabase.channel('comments_unread')
      .on('postgres_changes',
          { event: 'INSERT', schema: 'ehs', table: 'comments' },
          () => { void compute() })
      .subscribe()
    return () => {
      readListeners.delete(onRead)
      void supabase.removeChannel(channel)
    }
  }, [profileId])

  return counts
}
