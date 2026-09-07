import { describe, it, expect } from 'vitest'
import { blankState, calc, autoDecision } from '../calc'
import { machines } from '../../data'

const m = machines[0]

function scored(value: number) {
  const s = blankState()
  Object.keys(s.inspection.scores).forEach(k => { s.inspection.scores[k] = value })
  return s
}

function allPass(state = scored(5)) {
  Object.keys(state.inspection.critical).forEach(k => { state.inspection.critical[k] = 'PASS' })
  return state
}

describe('calc', () => {
  it('reports zero technical score when nothing is scored', () => {
    expect(calc(m, blankState()).technical).toBe(0)
  })

  it('reports 100 technical when every section scores 5', () => {
    expect(calc(m, scored(5)).technical).toBe(100)
  })

  it('reports 60 technical when every section scores 3', () => {
    expect(calc(m, scored(3)).technical).toBe(60)
  })

  it('ignores unscored sections in the average', () => {
    const s = blankState()
    const keys = Object.keys(s.inspection.scores)
    s.inspection.scores[keys[0]] = 4
    expect(calc(m, s).technical).toBe(80)
  })

  it('blends technical and commercial fit 55/45', () => {
    const s = scored(5)
    const r = calc(m, s)
    expect(r.blended).toBe(Math.round(r.technical * 0.55 + r.commercialFit * 0.45))
  })

  it('flags criticalFail when any gate is FAIL', () => {
    const s = allPass()
    s.inspection.critical[Object.keys(s.inspection.critical)[0]] = 'FAIL'
    expect(calc(m, s).criticalFail).toBe(true)
    expect(calc(m, s).criticalComplete).toBe(false)
  })

  it('returns zero max bid when no resale value is entered', () => {
    expect(calc(m, blankState()).calculatedMaxBid).toBe(0)
  })

  it('prefers a manual stop-bid over the calculated one', () => {
    const s = scored(5)
    s.commercial.estimatedResaleInr = 4_500_000
    s.commercial.manualMaxBidEur = 12_345
    expect(calc(m, s).effectiveMaxBid).toBe(12_345)
  })

  it('derives max bid from resale, margin, fixed costs, import and contingency', () => {
    const s = blankState()
    s.commercial.estimatedResaleInr = 4_500_000
    const c = s.commercial
    const resaleEur = c.estimatedResaleInr / c.fxEurInr
    const desired = resaleEur * (1 - c.targetMarginPct / 100)
    const fixed = c.transportNlEur + c.seaFreightEur + c.insuranceEur + c.inlandIndiaEur
    const expected = Math.max(0, desired - fixed) / (1 + c.importPct / 100) / (1 + c.contingencyPct / 100)
    expect(calc(m, s).calculatedMaxBid).toBeCloseTo(expected, 6)
  })

  it('includes the repair reserve in landed cost', () => {
    const a = blankState(); a.commercial.currentBidEur = 10_000
    const b = blankState(); b.commercial.currentBidEur = 10_000; b.inspection.repairEstimateEur = 1_000
    expect(calc(m, b).landedEur).toBeGreaterThan(calc(m, a).landedEur)
  })
})

describe('autoDecision', () => {
  it('is UNASSESSED before any scoring', () => {
    expect(autoDecision(m, blankState())).toBe('UNASSESSED')
  })

  it('is REJECT when a critical gate fails, even with perfect scores', () => {
    const s = allPass()
    s.inspection.critical[Object.keys(s.inspection.critical)[0]] = 'FAIL'
    expect(autoDecision(m, s)).toBe('REJECT')
  })

  it('is REJECT when technical is below 55', () => {
    expect(autoDecision(m, allPass(scored(2)))).toBe('REJECT')
  })

  it('is HOLD when scores are good but gates are incomplete', () => {
    expect(autoDecision(m, scored(5))).toBe('HOLD')
  })

  it('is BUY when gates all pass and blended is at least 82', () => {
    const s = allPass(scored(5))
    expect(calc(m, s).blended).toBeGreaterThanOrEqual(82)
    expect(autoDecision(m, s)).toBe('BUY')
  })
})
