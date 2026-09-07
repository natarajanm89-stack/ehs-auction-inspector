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

export function Photos({ lot, canWrite, profileId }: { lot: number; canWrite: boolean; profileId: string }) {
  const [shots, setShots] = useState<Shot[]>([])
  const [busy, setBusy] = useState(false)
  // Tracks object URLs from the previous render so they can be revoked once
  // replaced - otherwise a long inspection session leaks memory on a phone.
  const objectUrls = useRef<string[]>([])

  const load = useCallback(async () => {
    const { data } = await supabase.from('photos')
      .select('id, storage_path').eq('lot', lot).order('created_at', { ascending: false })

    const uploaded: Shot[] = []
    for (const row of data ?? []) {
      const { data: signed } = await supabase.storage
        .from('inspection-photos').createSignedUrl(row.storage_path, 3600)
      if (signed?.signedUrl) uploaded.push({ id: row.id, url: signed.signedUrl, pending: false })
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

  const upload = async (id: string, blob: Blob) => {
    const { error } = await supabase.storage
      .from('inspection-photos').upload(id, blob, { contentType: 'image/jpeg' })
    if (error) return                       // stays pending, retried on next load
    await supabase.from('photos').insert({ lot, storage_path: id, taken_by: profileId })
    await deletePhotoBlob(id)
  }

  const onPick = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    try {
      for (const file of Array.from(files).slice(0, 6)) {
        const blob = await downscale(file)
        const id = `${lot}/${crypto.randomUUID()}.jpg`
        await putPhotoBlob(id, blob)        // survives a crash or signal loss
        await load()                        // show it immediately
        if (navigator.onLine) await upload(id, blob)
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
      for (const id of await listPendingPhotos()) {
        if (!id.startsWith(`${lot}/`)) continue
        const blob = await getPhotoBlob(id)
        if (blob) await upload(id, blob)
      }
      await load()
    }
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [lot, load])

  return (
    <div className="photos">
      {canWrite && (
        <label className="full">Photo evidence
          <input type="file" accept="image/*" capture="environment" multiple
                 disabled={busy} onChange={e => onPick(e.target.files)} />
          <small>Stored on this device immediately, uploaded when there is signal.</small>
        </label>
      )}
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
