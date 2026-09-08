import { useEffect, useMemo, useState } from 'react'
import { CATEGORY_COUNTS, EVENT, INSPECTION_SECTIONS, CRITICAL_CHECKS, machines } from './data'
import type { Decision, Machine, MachineState } from './types'
import { autoDecision, blankState, calc } from './lib/calc'
import { can, type Profile } from './lib/profile'
import { clearAll, onStorageError } from './lib/db'
import { importLegacy, readLegacyState } from './lib/migrate'
import { subscribeStatus } from './lib/sync'
import { useAllMachineStates } from './hooks/useMachineState'
import { SyncBadge } from './components/SyncBadge'
import { SignOut } from './components/SignOut'
import { MachineImage } from './components/MachineImage'
import { Photos, drainPendingPhotos } from './components/Photos'
import { Comments, useUnreadCounts } from './components/Comments'

type Tab = 'dashboard' | 'machines' | 'inspect' | 'bidboard' | 'settings'

const euro = (n: number) => new Intl.NumberFormat('en-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0)
const inr = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0)

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode, tone?: string }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

function ScoreBar({ value }: { value: number }) {
  return <div className="scorebar"><div style={{ width: `${Math.min(100, value)}%` }} /></div>
}

function App({ profile }: { profile: Profile }) {
  const canWrite = can(profile.role, 'write_state')
  const { states, ready, patchState } = useAllMachineStates(canWrite)
  const unread = useUnreadCounts(profile.id)
  const [tab, setTab] = useState<Tab>('dashboard')
  const [selectedLot, setSelectedLot] = useState<number>(machines[0].lot)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const [priority, setPriority] = useState('All')
  const [make, setMake] = useState('All')
  const [detailLot, setDetailLot] = useState<number | null>(null)
  const [storageError, setStorageError] = useState('')
  const [legacyCount, setLegacyCount] = useState(() => Object.keys(readLegacyState() ?? {}).length)

  useEffect(() => onStorageError(setStorageError), [])
  // A transient storage failure shouldn't leave the banner stuck for the
  // whole session - clear it once sync subsequently reports healthy.
  useEffect(() => subscribeStatus(s => { if (s.status === 'synced') setStorageError('') }), [])

  // Drain every pending photo on this device, not just the lot on screen -
  // an inspector may shoot a lot and never revisit it while online.
  useEffect(() => {
    void drainPendingPhotos(profile.id)
    const onOnline = () => { void drainPendingPhotos(profile.id) }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [profile.id])

  const selected = machines.find(m => m.lot === selectedLot) || machines[0]
  const selectedState = states[selected.lot]

  const filtered = useMemo(() => machines.filter(m => {
    const q = search.toLowerCase().trim()
    const matchQ = !q || `${m.lot} ${m.make} ${m.model} ${m.title}`.toLowerCase().includes(q)
    const matchC = category === 'All' || m.category === category
    const matchP = priority === 'All' || m.priority === priority
    const matchM = make === 'All' || m.make === make
    return matchQ && matchC && matchP && matchM
  }), [search, category, priority, make])

  const shortlist = machines.filter(m => states[m.lot]?.shortlist)
  const inspected = machines.filter(m => Object.values(states[m.lot]?.inspection.scores || {}).some(v => v > 0))
  const buyCandidates = machines.filter(m => ['BUY', 'BUY_IF'].includes(autoDecision(m, states[m.lot] || blankState())))

  const navigateMachine = (lot: number, nextTab: Tab = 'inspect') => { setSelectedLot(lot); setTab(nextTab); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  const exportData = () => {
    const payload = { exportedAt: new Date().toISOString(), event: EVENT, machines, states }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `ehs-auction-inspection-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(a.href)
  }

  const exportCsv = () => {
    const rows = [['lot','machine','priority','technical_score','decision','current_bid_eur','max_bid_eur','repair_eur','notes']]
    machines.forEach(m => {
      const s = states[m.lot] || blankState(); const c = calc(m,s)
      rows.push([String(m.lot), m.title, m.priority, String(c.technical), autoDecision(m,s), String(s.commercial.currentBidEur), String(Math.round(c.effectiveMaxBid)), String(s.inspection.repairEstimateEur), s.inspection.notes.replace(/\n/g,' ')])
    })
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' }); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='ehs-auction-board.csv'; a.click(); URL.revokeObjectURL(a.href)
  }

  if (!ready) return <div className="gate"><p>Loading inspection data…</p></div>

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand" onClick={() => setTab('dashboard')}>
        <div className="brand-mark">EHS</div>
        <div><strong>Auction Inspector</strong><span>Global Access Equipment</span></div>
      </div>
      <div className="header-actions">
        <SyncBadge />
        <Badge tone="live">Zevenbergen · 9 Sep</Badge>
        <span className="who" title="Your identity on this device">
          {profile.display_name} · {profile.role}
        </span>
        <button className="ghost" onClick={exportData}>Export</button>
      </div>
    </header>
    {storageError && (
      <div className="storage-error-banner" role="alert">
        <span>{storageError}</span>
        <button className="ghost small" onClick={() => setStorageError('')}>Dismiss</button>
      </div>
    )}

    <nav className="nav-tabs">
      {([['dashboard','Overview'],['machines','Machines'],['inspect','Inspect'],['bidboard','Bid Board'],['settings','Settings']] as [Tab,string][]).map(([key,label]) =>
        <button key={key} className={tab===key?'active':''} onClick={()=>setTab(key)}>{label}</button>
      )}
    </nav>

    {legacyCount > 0 && canWrite && (
      <div className="legacy-banner">
        <span>{legacyCount} lot{legacyCount > 1 ? 's' : ''} of inspection data
          from this device has not been uploaded yet.</span>
        <button className="primary" onClick={async () => {
          await importLegacy(); setLegacyCount(0)
        }}>Upload now</button>
      </div>
    )}

    <main>
      {tab === 'dashboard' && <section className="page">
        <div className="hero-grid">
          <article className="hero-card">
            <div className="eyebrow">EHS FIELD COMMAND</div>
            <h1>Inspect fast. Bid with a ceiling. Buy rental-ready assets.</h1>
            <p>Mobile-first decision workspace for the Managing Director and inspection team. Catalog facts stay separate from EHS field findings.</p>
            <div className="hero-actions"><button className="primary" onClick={()=>setTab('machines')}>Open machine queue</button><a className="button-link" href={EVENT.catalogUrl} target="_blank">Ritchie Bros. catalog ↗</a></div>
          </article>
          <article className="event-card">
            <div className="event-row"><span>Viewing</span><strong>{EVENT.viewing}</strong></div>
            <div className="event-row"><span>Auction</span><strong>{EVENT.mode}</strong></div>
            <div className="event-row"><span>Access block</span><strong>{EVENT.accessLotsClose}</strong></div>
            <div className="event-row"><span>Payment</span><strong>{EVENT.paymentDue}</strong></div>
            <div className="event-row"><span>Removal</span><strong>{EVENT.removalDue}</strong></div>
          </article>
        </div>

        <div className="metric-grid">
          <div className="metric"><span>Seed shortlist</span><strong>{machines.length}</strong><small>verified starter lots</small></div>
          <div className="metric"><span>Shortlisted</span><strong>{shortlist.length}</strong><small>by EHS team</small></div>
          <div className="metric"><span>Inspected</span><strong>{inspected.length}</strong><small>scoring started</small></div>
          <div className="metric"><span>Buy candidates</span><strong>{buyCandidates.length}</strong><small>automatic gate</small></div>
        </div>

        <div className="section-head"><div><span className="eyebrow">LIVE CATALOG MIX</span><h2>Access equipment concentration</h2></div><small>Counts observed 7 Sep 2026; catalog can change before close.</small></div>
        <div className="category-grid">{CATEGORY_COUNTS.map(c => <div className="category-card" key={c.label}><strong>{c.count}</strong><span>{c.label}</span><ScoreBar value={Math.min(100,c.count/1.5)} /></div>)}</div>

        <div className="section-head"><div><span className="eyebrow">TODAY'S ROUTE</span><h2>Inspection order</h2></div><button className="ghost" onClick={()=>setTab('machines')}>View all</button></div>
        <div className="machine-strip">{machines.filter(m=>m.priority==='P1').slice(0,5).map(m => <MachineCard key={m.lot} machine={m} state={states[m.lot]} compact onOpen={()=>navigateMachine(m.lot)} onDetail={()=>setDetailLot(m.lot)} onShortlist={()=>patchState(m.lot,'decision',s=>({...s,shortlist:!s.shortlist}))} canWrite={canWrite} unread={unread[m.lot] ?? 0}/>)}</div>
      </section>}

      {tab === 'machines' && <section className="page">
        <div className="section-head"><div><span className="eyebrow">CATALOG SHORTLIST</span><h1>Machines</h1><p>Real starter lots selected for EHS relevance. Add the full auction later by replacing <code>src/data.ts</code> or importing through your next data service.</p></div></div>
        <div className="filterbar">
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search lot, make or model…" />
          <select value={category} onChange={e=>setCategory(e.target.value)}><option>All</option>{[...new Set(machines.map(m=>m.category))].map(x=><option key={x}>{x}</option>)}</select>
          <select value={make} onChange={e=>setMake(e.target.value)} aria-label="Filter by make">
            <option value="All">All makes</option>
            {[...new Set(machines.map(m=>m.make))].sort().map(x=><option key={x}>{x}</option>)}
          </select>
          <select value={priority} onChange={e=>setPriority(e.target.value)}><option>All</option><option>P1</option><option>P2</option><option>P3</option></select>
        </div>
        <div className="filter-count">
          {filtered.length} of {machines.length} lots
          {(search || category!=='All' || priority!=='All' || make!=='All') && (
            <button className="ghost small" onClick={()=>{setSearch('');setCategory('All');setPriority('All');setMake('All')}}>
              Clear filters
            </button>
          )}
        </div>
        <div className="machine-grid">{filtered.map(m => <MachineCard key={m.lot} machine={m} state={states[m.lot]} onOpen={()=>navigateMachine(m.lot)} onDetail={()=>setDetailLot(m.lot)} onShortlist={()=>patchState(m.lot,'decision',s=>({...s,shortlist:!s.shortlist}))} canWrite={canWrite} unread={unread[m.lot] ?? 0}/>)}</div>
      </section>}

      {tab === 'inspect' && <section className="page inspection-page">
        {!canWrite && (
          <div className="viewer-note" role="status">
            You are signed in as a <strong>viewer</strong>. You can read everything and
            post comments, but not change inspection data.
          </div>
        )}
        <div className="inspection-selector">
          <label>Machine to inspect</label>
          <select value={selectedLot} onChange={e=>setSelectedLot(Number(e.target.value))}>{machines.map(m=><option value={m.lot} key={m.lot}>Lot {m.lot} · {m.make} {m.model}</option>)}</select>
        </div>
        <div className="machine-hero">
          <MachineImage machine={selected}/>
          <div><div className="badges"><Badge tone={selected.priority==='P1'?'danger':'warn'}>{selected.priority}</Badge><Badge>{selected.category}</Badge><Badge>{selected.power}</Badge></div><h1>Lot {selected.lot} · {selected.make} {selected.model}</h1><p>{selected.year} · {selected.hours?.toLocaleString()} h · {selected.location}</p><div className="spec-pills">{selected.features.map(x=><span key={x}>{x}</span>)}</div><div className="hero-actions"><a className="button-link" href={selected.sourceUrl} target="_blank">Open Ritchie lot ↗</a><button className="ghost" onClick={()=>setDetailLot(selected.lot)}>Catalog details</button></div></div>
        </div>

        <div className="inspection-layout">
          <div>
            <div className="section-head"><div><span className="eyebrow">TECHNICAL INSPECTION</span><h2>Condition scoring</h2></div><ScoreRing value={calc(selected, selectedState).technical}/></div>
            <div className="score-list">{INSPECTION_SECTIONS.map(([name, hint]) => <div className="score-row" key={name}><div><strong>{name}</strong><small>{hint}</small></div><div className="score-buttons">{[1,2,3,4,5].map(v=><button key={v} disabled={!canWrite} className={selectedState.inspection.scores[name]===v?'active':''} onClick={()=>patchState(selected.lot,'inspection',s=>({...s,inspection:{...s.inspection,scores:{...s.inspection.scores,[name]:v}}}))}>{v}</button>)}</div></div>)}</div>

            <div className="panel"><h3>Critical safety gates</h3><p className="muted">A single FAIL forces REJECT. All gates must PASS before the automatic engine can recommend BUY.</p><div className="critical-list">{CRITICAL_CHECKS.map(name => <div key={name}><span>{name}</span><div className="three-state"><button disabled={!canWrite} className={selectedState.inspection.critical[name]==='PASS'?'pass':''} onClick={()=>patchState(selected.lot,'inspection',s=>({...s,inspection:{...s.inspection,critical:{...s.inspection.critical,[name]:'PASS'}}}))}>Pass</button><button disabled={!canWrite} className={selectedState.inspection.critical[name]==='FAIL'?'fail':''} onClick={()=>patchState(selected.lot,'inspection',s=>({...s,inspection:{...s.inspection,critical:{...s.inspection.critical,[name]:'FAIL'}}}))}>Fail</button><button disabled={!canWrite} className={selectedState.inspection.critical[name]==='UNSET'?'unset':''} onClick={()=>patchState(selected.lot,'inspection',s=>({...s,inspection:{...s.inspection,critical:{...s.inspection.critical,[name]:'UNSET'}}}))}>Reset</button></div></div>)}</div></div>

            <div className="panel field-grid">
              <label>Inspector<input disabled={!canWrite} value={selectedState.inspection.inspector} onChange={e=>patchState(selected.lot,'inspection',s=>({...s,inspection:{...s.inspection,inspector:e.target.value}}))} placeholder="Name"/></label>
              <label>Inspection time<input disabled={!canWrite} type="datetime-local" value={selectedState.inspection.inspectedAt} onChange={e=>patchState(selected.lot,'inspection',s=>({...s,inspection:{...s.inspection,inspectedAt:e.target.value}}))}/></label>
              <label>Repair reserve (€)<input disabled={!canWrite} type="number" value={selectedState.inspection.repairEstimateEur || ''} onChange={e=>patchState(selected.lot,'inspection',s=>({...s,inspection:{...s.inspection,repairEstimateEur:Number(e.target.value)}}))}/></label>
              <label className="full">Field notes<textarea disabled={!canWrite} rows={5} value={selectedState.inspection.notes} onChange={e=>patchState(selected.lot,'inspection',s=>({...s,inspection:{...s.inspection,notes:e.target.value}}))} placeholder="Leaks, noise, welds, battery dates, error codes, tyres, documents, parts needed…"/></label>
              <Photos lot={selected.lot} canWrite={canWrite} profileId={profile.id} />
            </div>

            <Comments lot={selected.lot} profile={profile} />
          </div>

          <aside className="commercial-panel">
            <div className="sticky-card">
              <span className="eyebrow">BUYING ENGINE</span><h2>{decisionLabel(autoDecision(selected, selectedState))}</h2>
              <ScoreBar value={calc(selected,selectedState).blended}/>
              <div className="decision-metrics"><span>Technical<strong>{calc(selected,selectedState).technical}%</strong></span><span>EHS fit<strong>{calc(selected,selectedState).commercialFit}%</strong></span><span>Blended<strong>{calc(selected,selectedState).blended}%</strong></span></div>
              <hr/>
              <CommercialForm machine={selected} state={selectedState} patch={(fn)=>patchState(selected.lot,'commercial',fn)} canWrite={canWrite}/>
              <hr/>
              <div className="bid-ceiling"><span>Calculated max bid</span><strong>{euro(calc(selected,selectedState).calculatedMaxBid)}</strong><small>Planning estimate; excludes any fee/tax assumption not entered above.</small></div>
              <div className="bid-ceiling secondary"><span>Effective stop-bid</span><strong>{euro(calc(selected,selectedState).effectiveMaxBid)}</strong><small>{selectedState.commercial.manualMaxBidEur ? 'Manual ceiling overrides model.' : 'Using calculated ceiling.'}</small></div>
              <button className="primary wide" disabled={!canWrite} onClick={()=>{patchState(selected.lot,'decision',s=>({...s,decision:autoDecision(selected,s),shortlist:true})); setTab('bidboard')}}>Send to bid board</button>
            </div>
          </aside>
        </div>
      </section>}

      {tab === 'bidboard' && <section className="page">
        {!canWrite && (
          <div className="viewer-note" role="status">
            You are signed in as a <strong>viewer</strong>. You can read everything and
            post comments, but not change inspection data.
          </div>
        )}
        <div className="section-head"><div><span className="eyebrow">AUCTION CONTROL</span><h1>Bid Board</h1><p>One screen to prevent emotional bidding. The stop-bid is visible before the live close.</p></div><div className="hero-actions"><button className="ghost" onClick={exportCsv}>Export CSV</button></div></div>
        <div className="table-wrap"><table><thead><tr><th>Lot</th><th>Machine</th><th>Inspection</th><th>Decision</th><th>Current bid</th><th>Stop-bid</th><th>Headroom</th><th>Status</th><th></th></tr></thead><tbody>{machines.filter(m=>states[m.lot]?.shortlist || Object.values(states[m.lot]?.inspection.scores||{}).some(v=>v>0)).map(m=>{const s=states[m.lot]; const c=calc(m,s); const d=autoDecision(m,s); const head=c.effectiveMaxBid-s.commercial.currentBidEur; return <tr key={m.lot}><td><strong>{m.lot}</strong></td><td><strong>{m.make} {m.model}</strong><small>{m.year} · {m.hours?.toLocaleString()} h</small></td><td><span className="score-number">{c.technical}%</span></td><td><Badge tone={d==='BUY'?'good':d==='BUY_IF'?'warn':d==='REJECT'?'danger':'neutral'}>{decisionLabel(d)}</Badge></td><td>{euro(s.commercial.currentBidEur)}</td><td><strong>{euro(c.effectiveMaxBid)}</strong></td><td className={head<0?'negative':'positive'}>{euro(head)}</td><td><select disabled={!canWrite} value={s.commercial.status} onChange={e=>patchState(m.lot,'commercial',x=>({...x,commercial:{...x.commercial,status:e.target.value as any}}))}><option>WATCH</option><option>READY</option><option>BIDDING</option><option>STOPPED</option><option>WON</option><option>LOST</option></select></td><td><button className="ghost small" onClick={()=>navigateMachine(m.lot)}>Open</button></td></tr>})}</tbody></table></div>
        {machines.filter(m=>states[m.lot]?.shortlist).length===0 && <div className="empty">No machines are shortlisted yet. Inspect a machine and send it to the bid board.</div>}
      </section>}

      {tab === 'settings' && <section className="page narrow">
        <span className="eyebrow">OPERATING NOTES</span><h1>Settings & governance</h1>
        <div className="panel"><h3>Shared live persistence</h3><p>Scores, notes, bids and decisions are saved to this device instantly and synced to the shared server in the background, so the whole team — on site or remote — sees the same data within seconds of a change. If you go offline, edits still save locally and upload automatically once you reconnect.</p></div>
        <div className="panel"><h3>Commercial assumptions</h3><p>EUR→INR FX, freight, duty/import percentage, inland cost, repair reserve, contingency and target margin are editable per machine. The app does not claim these are tax advice or final customs values.</p></div>
        <div className="panel"><h3>Data provenance</h3><p>Starter lot facts come from the Ritchie Bros. Zevenbergen catalog/PDP pages checked on 7 Sep 2026. Auction catalog details can change. EHS inspection results are separate fields and should be treated as the controlling condition assessment.</p></div>
        <SignOut />
        <div className="panel danger-panel"><h3>Reset this device</h3><p>Clears the local cache, any unsent edits, and any photos not yet uploaded on this device. Data already
           synced to the server is not affected.</p><button className="danger-button" onClick={async ()=>{if(confirm('Clear local cache, unsent edits, and unsent photos on this device?')){await clearAll(); location.reload()}}}>Reset local cache</button></div>
      </section>}
    </main>

    {detailLot && <MachineModal machine={machines.find(m=>m.lot===detailLot)!} state={states[detailLot]} close={()=>setDetailLot(null)} inspect={()=>{setDetailLot(null);navigateMachine(detailLot)}} />}
  </div>
}

function MachineCard({ machine, state, compact=false, onOpen, onDetail, onShortlist, canWrite=true, unread=0 }: { machine: Machine, state: MachineState, compact?: boolean, onOpen:()=>void, onDetail:()=>void, onShortlist:()=>void, canWrite?: boolean, unread?: number }) {
  const c = calc(machine, state || blankState())
  const d = autoDecision(machine, state || blankState())
  return <article className={`machine-card ${compact?'compact':''}`}>
    <div className="image-wrap"><MachineImage machine={machine}/><div className="image-tags"><Badge tone={machine.priority==='P1'?'danger':'warn'}>{machine.priority}</Badge><button disabled={!canWrite} className={`shortlist-btn ${state?.shortlist?'on':''}`} onClick={onShortlist} title="Shortlist">★</button></div></div>
    <div className="machine-body"><div className="lot-line"><strong>LOT {machine.lot}</strong>{unread > 0 && <span className="unread-dot">{unread}</span>}<Badge>{machine.category.replace(' Lift','')}</Badge></div><h3>{machine.make} {machine.model}</h3><p>{machine.year} · {machine.hours?.toLocaleString()} h · {machine.power}</p>{!compact && <div className="mini-specs">{machine.features.slice(0,2).map(x=><span key={x}>{x}</span>)}</div>}<div className="card-bottom"><div><small>Inspection</small><strong>{c.technical ? `${c.technical}%` : 'Not started'}</strong></div><Badge tone={d==='BUY'?'good':d==='BUY_IF'?'warn':d==='REJECT'?'danger':'neutral'}>{decisionLabel(d)}</Badge></div><div className="card-actions"><button className="primary" onClick={onOpen}>Inspect</button><button className="ghost" onClick={onDetail}>Details</button></div></div>
  </article>
}

function CommercialForm({ machine, state, patch, canWrite }: { machine: Machine, state: MachineState, patch:(fn:(s:MachineState)=>MachineState)=>void, canWrite: boolean }) {
  const c = state.commercial
  const set = (key: keyof typeof c, value: number | string) => patch(s=>({...s,commercial:{...s.commercial,[key]:value}}))
  const x = calc(machine,state)
  return <div className="commercial-form">
    <label>Expected resale / acquisition value in India (₹)<input disabled={!canWrite} type="number" value={c.estimatedResaleInr||''} onChange={e=>set('estimatedResaleInr',Number(e.target.value))} placeholder="e.g. 4500000"/></label>
    <div className="two-col"><label>EUR→INR planning FX<input disabled={!canWrite} type="number" step="0.1" value={c.fxEurInr} onChange={e=>set('fxEurInr',Number(e.target.value))}/></label><label>Target margin %<input disabled={!canWrite} type="number" value={c.targetMarginPct} onChange={e=>set('targetMarginPct',Number(e.target.value))}/></label></div>
    <div className="two-col"><label>NL transport €<input disabled={!canWrite} type="number" value={c.transportNlEur} onChange={e=>set('transportNlEur',Number(e.target.value))}/></label><label>Sea freight €<input disabled={!canWrite} type="number" value={c.seaFreightEur} onChange={e=>set('seaFreightEur',Number(e.target.value))}/></label></div>
    <div className="two-col"><label>Insurance €<input disabled={!canWrite} type="number" value={c.insuranceEur} onChange={e=>set('insuranceEur',Number(e.target.value))}/></label><label>India inland €<input disabled={!canWrite} type="number" value={c.inlandIndiaEur} onChange={e=>set('inlandIndiaEur',Number(e.target.value))}/></label></div>
    <div className="two-col"><label>Import/tax allowance %<input disabled={!canWrite} type="number" value={c.importPct} onChange={e=>set('importPct',Number(e.target.value))}/></label><label>Contingency %<input disabled={!canWrite} type="number" value={c.contingencyPct} onChange={e=>set('contingencyPct',Number(e.target.value))}/></label></div>
    <div className="two-col"><label>Current bid €<input disabled={!canWrite} type="number" value={c.currentBidEur||''} onChange={e=>set('currentBidEur',Number(e.target.value))}/></label><label>Manual stop-bid €<input disabled={!canWrite} type="number" value={c.manualMaxBidEur||''} onChange={e=>set('manualMaxBidEur',Number(e.target.value))} placeholder="optional"/></label></div>
    <div className="landed-box"><span>Indicative landed at current bid</span><strong>{euro(x.landedEur)} · {inr(x.landedInr)}</strong></div>
  </div>
}

function ScoreRing({ value }: { value: number }) { return <div className="score-ring" style={{'--score':`${value*3.6}deg`} as React.CSSProperties}><span>{value || '—'}</span><small>/100</small></div> }

function decisionLabel(d: Decision) { return ({UNASSESSED:'UNASSESSED',BUY:'BUY',BUY_IF:'BUY ≤ CEILING',HOLD:'HOLD / VERIFY',REJECT:'REJECT'})[d] }

function MachineModal({ machine, state, close, inspect }: { machine: Machine, state: MachineState, close:()=>void, inspect:()=>void }) {
  const c=calc(machine,state||blankState())
  return <div className="modal-backdrop" onMouseDown={close}><div className="modal" onMouseDown={e=>e.stopPropagation()}><button className="modal-close" onClick={close}>×</button><MachineImage machine={machine} className="modal-image"/><div className="modal-content"><div className="badges"><Badge tone={machine.priority==='P1'?'danger':'warn'}>{machine.priority}</Badge><Badge>{machine.category}</Badge><Badge>{machine.power}</Badge></div><h2>Lot {machine.lot} · {machine.make} {machine.model}</h2><p>{machine.title}</p><div className="detail-grid"><span>Year<strong>{machine.year}</strong></span><span>Hours<strong>{machine.hours?.toLocaleString()}</strong></span><span>Serial<strong>{machine.serial || 'Verify on site'}</strong></span><span>EHS fit<strong>{c.commercialFit}%</strong></span></div><h3>Catalog features</h3><ul>{machine.features.map(x=><li key={x}>{x}</li>)}</ul>{machine.notes && <div className="catalog-note"><strong>Catalog note</strong><p>{machine.notes}</p></div>}<p className="muted">Catalog fields are source-verified starter data, not an EHS condition guarantee. Verify serial, hours, CE, functions and defects during inspection.</p><div className="hero-actions"><button className="primary" onClick={inspect}>Start inspection</button><a className="button-link" href={machine.sourceUrl} target="_blank">Open source ↗</a></div></div></div></div>
}

export default App
