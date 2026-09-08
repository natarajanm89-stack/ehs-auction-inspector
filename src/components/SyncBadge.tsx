import { useEffect, useState } from 'react'
import { subscribeStatus, type SyncSnapshot } from '../lib/sync'
import { getMode } from '../lib/mode'

const LABEL: Record<SyncSnapshot['status'], string> = {
  synced:  'Synced',
  pending: 'Saving',
  offline: 'Offline',
  error:   'Retrying',
}

export function SyncBadge() {
  const [s, setS] = useState<SyncSnapshot>({ status: 'synced', pending: 0, lastSyncedAt: null })
  useEffect(() => subscribeStatus(setS), [])

  if (getMode() === 'single') {
    return <span className="sync-badge sync-synced" title="Saved on this device">
      <i /> Saved on this device
    </span>
  }

  return (
    <span className={`sync-badge sync-${s.status}`} title={
      s.lastSyncedAt ? `Last synced ${new Date(s.lastSyncedAt).toLocaleTimeString()}` : 'Not synced yet'
    }>
      <i /> {LABEL[s.status]}{s.pending ? ` ${s.pending}` : ''}
    </span>
  )
}
