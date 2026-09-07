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

  it('treats an inspector name or visit time alone as real work', () => {
    const named = blankState(); named.inspection.inspector = 'Rakesh S.'
    const timed = blankState(); timed.inspection.inspectedAt = '2026-09-09T09:30'
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ 1: named, 2: timed, 3: blankState() }))
    expect(Object.keys(readLegacyState()!).sort()).toEqual(['1', '2'])
  })

  it('skips one malformed lot without discarding the others', () => {
    const good = blankState(); good.inspection.notes = 'boom weld cracked'
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ 1: 'not-an-object', 2: good }))
    expect(Object.keys(readLegacyState()!)).toEqual(['2'])
  })
})
