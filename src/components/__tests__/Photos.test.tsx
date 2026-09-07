import { describe, it, expect, beforeEach, vi } from 'vitest'

const { storageUploadMock, fromMock } = vi.hoisted(() => ({
  storageUploadMock: vi.fn(),
  fromMock: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    storage: { from: () => ({ upload: storageUploadMock, createSignedUrls: vi.fn() }) },
    from: fromMock,
  },
}))

import { clearAll, putPhotoBlob, listPendingPhotos } from '../../lib/db'
import { drainPendingPhotos } from '../Photos'

beforeEach(async () => {
  await clearAll()
  storageUploadMock.mockReset()
  fromMock.mockReset()
})

describe('drainPendingPhotos', () => {
  it('attempts every pending blob on the device, not just one lot', async () => {
    await putPhotoBlob('95/a.jpg', new Blob(['x']))
    await putPhotoBlob('100/b.jpg', new Blob(['y']))
    await putPhotoBlob('107/c.jpg', new Blob(['z']))

    storageUploadMock.mockResolvedValue({ error: null })
    fromMock.mockReturnValue({ insert: () => Promise.resolve({ error: null }) })

    await drainPendingPhotos('profile-1')

    expect(storageUploadMock).toHaveBeenCalledTimes(3)
    expect(await listPendingPhotos()).toEqual([])
  })

  it('treats an already-exists upload error as success (idempotent retry)', async () => {
    await putPhotoBlob('95/a.jpg', new Blob(['x']))
    storageUploadMock.mockResolvedValue({ error: { statusCode: 409, message: 'The resource already exists' } })
    fromMock.mockReturnValue({ insert: () => Promise.resolve({ error: null }) })

    await drainPendingPhotos('profile-1')

    expect(await listPendingPhotos()).toEqual([])
  })

  it('leaves a blob pending when the upload genuinely fails', async () => {
    await putPhotoBlob('95/a.jpg', new Blob(['x']))
    storageUploadMock.mockResolvedValue({ error: { statusCode: 500, message: 'network down' } })

    await drainPendingPhotos('profile-1')

    expect(await listPendingPhotos()).toEqual(['95/a.jpg'])
  })
})
