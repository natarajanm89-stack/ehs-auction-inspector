import { describe, it, expect, beforeEach, vi } from 'vitest'

const { rpc, signOut, ensureSession, resetSession } = vi.hoisted(() => ({
  rpc: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
  ensureSession: vi.fn(async () => 'uid-new'),
  resetSession: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    rpc,
    auth: { signOut },
  },
  ensureSession,
  resetSession,
}))

import { redeemCode } from '../profile'

function fkError() {
  return {
    code: '23503',
    message: 'insert or update on table "profiles" violates foreign key constraint "profiles_id_fkey"',
  }
}

describe('redeemCode', () => {
  beforeEach(() => {
    rpc.mockReset()
    signOut.mockClear()
    ensureSession.mockClear()
    resetSession.mockClear()
  })

  it('recovers from a stale-session foreign key violation: signs out, gets a fresh session, and retries once', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: fkError() })
    rpc.mockResolvedValueOnce({ data: 'inspector', error: null })

    const role = await redeemCode('ABC123', 'Rakesh')

    expect(role).toBe('inspector')
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(ensureSession).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('throws a clear error and does not retry again if the retry also fails', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: fkError() })
    rpc.mockResolvedValueOnce({ data: null, error: fkError() })

    await expect(redeemCode('ABC123', 'Rakesh')).rejects.toThrow()
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('throws the "not recognised" message for invalid_code without any sign-out', async () => {
    rpc.mockResolvedValueOnce({ data: 'invalid_code', error: null })

    await expect(redeemCode('BAD', 'Rakesh')).rejects.toThrow(/not recognised/)
    expect(signOut).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
