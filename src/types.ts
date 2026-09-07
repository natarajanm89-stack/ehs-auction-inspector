export type MachineCategory = 'Articulating Boom Lift' | 'Scissor Lift' | 'Vertical Mast Lift' | 'Telehandler'
export type PowerType = 'Diesel' | 'Electric' | 'Unknown'
export type Priority = 'P1' | 'P2' | 'P3'
export type Decision = 'UNASSESSED' | 'BUY' | 'BUY_IF' | 'HOLD' | 'REJECT'
export type BidStatus = 'WATCH' | 'READY' | 'BIDDING' | 'STOPPED' | 'WON' | 'LOST'

export interface Machine {
  lot: number
  year?: number
  make: string
  model: string
  title: string
  category: MachineCategory
  power: PowerType
  hours?: number
  serial?: string
  location: string
  imageUrl?: string
  sourceUrl: string
  features: string[]
  notes?: string
  priority: Priority
  fleetFit: number
  partsSupport: number
  rentalDemand: number
  sourceVerified: boolean
}

export interface InspectionState {
  scores: Record<string, number>
  critical: Record<string, 'UNSET' | 'PASS' | 'FAIL'>
  notes: string
  inspector: string
  inspectedAt: string
  repairEstimateEur: number
}

export interface CommercialState {
  estimatedResaleInr: number
  monthlyRentalInr: number
  expectedUtilizationPct: number
  transportNlEur: number
  seaFreightEur: number
  insuranceEur: number
  importPct: number
  inlandIndiaEur: number
  contingencyPct: number
  fxEurInr: number
  targetMarginPct: number
  currentBidEur: number
  manualMaxBidEur: number
  status: BidStatus
}

export interface MachineState {
  inspection: InspectionState
  commercial: CommercialState
  decision: Decision
  shortlist: boolean
}
