import { CRITICAL_CHECKS, INSPECTION_SECTIONS } from '../data'
import type { Decision, Machine, MachineState } from '../types'

export interface CalcResult {
  technical: number
  commercialFit: number
  blended: number
  criticalFail: boolean
  criticalComplete: boolean
  calculatedMaxBid: number
  effectiveMaxBid: number
  landedEur: number
  landedInr: number
}

export function blankState(): MachineState {
  return {
    shortlist: false,
    decision: 'UNASSESSED',
    inspection: {
      scores: Object.fromEntries(INSPECTION_SECTIONS.map(([name]) => [name, 0])),
      critical: Object.fromEntries(CRITICAL_CHECKS.map(name => [name, 'UNSET'])),
      notes: '', inspector: '', inspectedAt: '', repairEstimateEur: 0,
    },
    commercial: {
      estimatedResaleInr: 0, monthlyRentalInr: 0, expectedUtilizationPct: 65,
      transportNlEur: 850, seaFreightEur: 3200, insuranceEur: 250,
      importPct: 18, inlandIndiaEur: 700, contingencyPct: 7, fxEurInr: 100,
      targetMarginPct: 20, currentBidEur: 0, manualMaxBidEur: 0, status: 'WATCH',
    },
  }
}

export function calc(machine: Machine, state: MachineState): CalcResult {
  const values = Object.values(state.inspection.scores).filter(v => v > 0)
  const technical = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / (values.length * 5) * 100) : 0
  const commercialFit = Math.round(((machine.fleetFit + machine.partsSupport + machine.rentalDemand) / 15) * 100)
  const criticalFail = Object.values(state.inspection.critical).some(v => v === 'FAIL')
  const criticalComplete = Object.values(state.inspection.critical).every(v => v === 'PASS')
  const blended = Math.round(technical * .55 + commercialFit * .45)
  const c = state.commercial
  const resaleEur = c.fxEurInr ? c.estimatedResaleInr / c.fxEurInr : 0
  const desiredCostEur = resaleEur ? resaleEur * (1 - c.targetMarginPct / 100) : 0
  const fixed = c.transportNlEur + c.seaFreightEur + c.insuranceEur + c.inlandIndiaEur + state.inspection.repairEstimateEur
  const beforeImport = Math.max(0, desiredCostEur - fixed)
  const importFactor = 1 + c.importPct / 100
  const contingencyFactor = 1 + c.contingencyPct / 100
  const calculatedMaxBid = desiredCostEur ? Math.max(0, beforeImport / importFactor / contingencyFactor) : 0
  const effectiveMaxBid = c.manualMaxBidEur || calculatedMaxBid
  const landedEur = (c.currentBidEur + fixed) * importFactor * contingencyFactor
  const landedInr = landedEur * c.fxEurInr
  return { technical, commercialFit, blended, criticalFail, criticalComplete, calculatedMaxBid, effectiveMaxBid, landedEur, landedInr }
}

export function autoDecision(machine: Machine, state: MachineState): Decision {
  const x = calc(machine, state)
  if (x.criticalFail) return 'REJECT'
  if (!x.technical) return 'UNASSESSED'
  if (x.technical < 55 || x.blended < 60) return 'REJECT'
  if (!x.criticalComplete) return 'HOLD'
  if (x.blended >= 82) return 'BUY'
  if (x.blended >= 70) return 'BUY_IF'
  return 'HOLD'
}
