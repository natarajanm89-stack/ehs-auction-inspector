import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { deletePhotoBlob, getPhotoBlob, listPendingPhotos, putPhotoBlob } from '../lib/db'

interface Shot { id: string; url: string; pending: boolean }

/** Downscale to a long edge of 1600px. Keeps a full-frame shot a few hundred KB. */
function downscale(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = () => {
      const img = new Image()
      img.onerror = reject
      img.onload = () => {
        const max = 1600
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('encode failed')), 'image/jpeg', 0.72)
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

const SIGNED_URL_TTL = 3600
const SIGNED_URL_REFRESH_MS = 45 * 60 * 1000

export function Photos({ lot, canWrite, profileId }: { lot: number; canWrite: boolean; profileId: string }) {
  const [shots, setShots] = useState<Shot[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Tracks object URLs from the previous render so they can be revoked once
  // replaced - otherwise a long inspection session leaks memory on a phone.
  const objectUrls = useRef<string[]>([])

  const load = useCallback(async () => {
    const { data } = await supabase.from('photos')
      .select('id, storage_path').eq('lot', lot).order('created_at', { ascending: false })

    const rows = data ?? []
    const uploaded: Shot[] = []
    if (rows.length > 0) {
      const paths = rows.map(row => row.storage_path)
      const { data: signedList } = await supabase.storage
        .from('inspection-photos').createSignedUrls(paths, SIGNED_URL_TTL)
      const urlByPath = new Map<string, string>()
      for (const signed of signedList ?? []) {
        if (signed.signedUrl && signed.path) urlByPath.set(signed.path, signed.signedUrl)
      }
      for (const row of rows) {
        const url = urlByPath.get(row.storage_path)
        if (url) uploaded.push({ id: row.id, url, pending: false })
      }
    }

    const pending: Shot[] = []
    const newObjectUrls: string[] = []
    for (const id of await listPendingPhotos()) {
      if (!id.startsWith(`${lot}/`)) continue
      const blob = await getPhotoBlob(id)
      if (blob) {
        const url = URL.createObjectURL(blob)
        newObjectUrls.push(url)
        pending.push({ id, url, pending: true })
      }
    }

    // Revoke the object URLs from the previous load now that they are
    // being replaced.
    objectUrls.current.forEach(u => URL.revokeObjectURL(u))
    objectUrls.current = newObjectUrls

    setShots([...pending, ...uploaded])
  }, [lot])

  useEffect(() => { void load() }, [load])

  // Revoke any outstanding object URLs on unmount.
  useEffect(() => () => { objectUrls.current.forEach(u => URL.revokeObjectURL(u)) }, [])

  // Signed URLs expire after SIGNED_URL_TTL seconds. Refresh well inside
  // that window on a timer, and again whenever the tab regains visibility -
  // a viewer can leave the tab open for hours.
  useEffect(() => {
    const interval = setInterval(() => { void load() }, SIGNED_URL_REFRESH_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  const upload = async (id: string, blob: Blob) => {
    const { error: uploadError } = await supabase.storage
      .from('inspection-photos').upload(id, blob, { contentType: 'image/jpeg', upsert: true })
    if (uploadError) return false           // stays pending, retried on next load

    const { error: insertError } = await supabase.from('photos').insert({ lot, storage_path: id, taken_by: profileId })
    // A unique-violation on storage_path means a previous attempt already
    // created the row (e.g. storage succeeded but the insert failed or the
    // connection dropped before the response arrived). That is success, not
    // failure - the evidence is already recorded.
    if (insertError && insertError.code !== '23505') return false

    await deletePhotoBlob(id)
    return true
  }

  const onPick = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    try {
      for (const file of Array.from(files).slice(0, 6)) {
        let blob: Blob
        try {
          blob = await downscale(file)
        } catch {
          setError('Could not read that image. Try taking the photo again.')
          continue                          // skip this file, keep processing the rest
        }
        const id = `${lot}/${crypto.randomUUID()}.jpg`
        await putPhotoBlob(id, blob)        // survives a crash or signal loss
        await load()                        // show it immediately
        if (navigator.onLine) {
          const ok = await upload(id, blob)
          if (ok) setError('')
        }
      }
      await load()
    } finally {
      setBusy(false)
    }
  }

  // Retry anything left pending whenever the connection returns. Subscribed
  // once per lot (not on every render) so the listener isn't added/removed
  // on every render.
  useEffect(() => {
    const retry = async () => {
      let allOk = true
      for (const id of await listPendingPhotos()) {
        if (!id.startsWith(`${lot}/`)) continue
        const blob = await getPhotoBlob(id)
        if (blob) {
          const ok = await upload(id, blob)
          if (!ok) allOk = false
        }
      }
      if (allOk) setError('')
      await load()
    }
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [lot, load])

  // An offline inspector is expected to have pending photos - only surface a
  // failure note once the device is online and photos are still stuck.
  const pendingCount = shots.filter(s => s.pending).length
  const pendingNote = pendingCount > 0 && navigator.onLine
    ? `${pendingCount} photo${pendingCount > 1 ? 's' : ''} could not upload. ${pendingCount > 1 ? 'They are' : 'It is'} saved on this device and will retry.`
    : ''

  return (
    <div className="photos">
      {canWrite && (
        <label className="full">Photo evidence
          <input type="file" accept="image/*" capture="environment" multiple
                 disabled={busy} onChange={e => onPick(e.target.files)} />
          <small>Stored on this device immediately, uploaded when there is signal.</small>
        </label>
      )}
      {(error || pendingNote) && <p className="photo-error" role="alert">{error || pendingNote}</p>}
      {shots.length > 0 && (
        <div className="photo-grid full">
          {shots.map(s => (
            <figure key={s.id} className={s.pending ? 'pending' : ''}>
              <img src={s.url} alt={`Lot ${lot} inspection`} />
              {s.pending && <figcaption>Waiting to upload</figcaption>}
            </figure>
          ))}
        </div>
      )}
    </div>
  )
}
