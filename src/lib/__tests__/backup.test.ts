import { beforeEach, describe, expect, it } from 'vitest'
import { blankState } from '../calc'
import {
  writeBackup, readBackup, setLastExport, getLastExport,
  setLastChange, getLastChange, hasUnexportedWork,
} from '../backup'

beforeEach(() => { localStorage.clear() })

describe('backup round-trip', () => {
  it('returns null when nothing has been written', () => {
    expect(readBackup()).toBeNull()
  })

  it('round-trips states written to the mirror', () => {
    const states = { 412: { ...blankState(), shortlist: true } }
    writeBackup(states)
    const back = readBackup()
    expect(back).not.toBeNull()
    expect(back!.states[412].shortlist).toBe(true)
    expect(typeof back!.savedAt).toBe('string')
  })

  it('overwrites the previous backup on each write', () => {
    writeBackup({ 1: blankState() })
    writeBackup({ 1: blankState(), 2: blankState() })
    expect(Object.keys(readBackup()!.states).sort()).toEqual(['1', '2'])
  })

  it('ignores garbage in localStorage instead of throwing', () => {
    localStorage.setItem('ehs-backup-v1', '{not json')
    expect(readBackup()).toBeNull()
  })
})

describe('export staleness', () => {
  it('no change yet means nothing is unexported', () => {
    expect(hasUnexportedWork(null, null)).toBe(false)
  })

  it('a change with no export at all is unexported', () => {
    expect(hasUnexportedWork('2026-09-09T10:00:00.000Z', null)).toBe(true)
  })

  it('an export after the last change means nothing is unexported', () => {
    expect(hasUnexportedWork('2026-09-09T10:00:00.000Z', '2026-09-09T10:05:00.000Z')).toBe(false)
  })

  it('an export before the last change means work is unexported', () => {
    expect(hasUnexportedWork('2026-09-09T10:05:00.000Z', '2026-09-09T10:00:00.000Z')).toBe(true)
  })

  it('tracks last export and last change via localStorage', () => {
    expect(getLastExport()).toBeNull()
    expect(getLastChange()).toBeNull()
    setLastChange('2026-09-09T10:00:00.000Z')
    setLastExport('2026-09-09T10:01:00.000Z')
    expect(getLastChange()).toBe('2026-09-09T10:00:00.000Z')
    expect(getLastExport()).toBe('2026-09-09T10:01:00.000Z')
  })
})
