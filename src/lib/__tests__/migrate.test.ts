import { describe, it, expect, beforeEach } from 'vitest'
import { blankState } from '../calc'
import { readLegacyState, LEGACY_KEY } from '../migrate'

beforeEach(() => { localStorage.clear() })

describe('readLegacyState', () => {
  it('returns null when there is no legacy key', () => {
    expect(readLegacyState()).toBeNull()
  })

  it('returns null for unparseable data rather than throwing', () => {
    localStorage.setItem(LEGACY_KEY, 'not json {{')
    expect(readLegacyState()).toBeNull()
  })

  it('returns null when every lot is untouched', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ 412: blankState(), 413: blankState() }))
    expect(readLegacyState()).toBeNull()
  })

  it('returns only the lots with real work on them', () => {
    const touched = blankState()
    touched.inspection.scores[Object.keys(touched.inspection.scores)[0]] = 4
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ 412: blankState(), 413: touched }))
    expect(Object.keys(readLegacyState()!)).toEqual(['413'])
  })

  it('treats notes, a bid, a shortlist or a critical gate as real work', () => {
    const withNotes = blankState(); withNotes.inspection.notes = 'boom weld cracked'
    const withBid = blankState(); withBid.commercial.currentBidEur = 8000
    const listed = blankState(); listed.shortlist = true
    const gated = blankState(); gated.inspection.critical[Object.keys(gated.inspection.critical)[0]] = 'PASS'
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ 1: withNotes, 2: withBid, 3: listed, 4: gated }))
    expect(Object.keys(readLegacyState()!).sort()).toEqual(['1', '2', '3', '4'])
  })
})
