import { useMemo, useState } from 'react'
import { machines } from '../data'
import { SHEETS, type Sheet, type SheetEntry } from '../sheetNotes'

type Agreement = 'match' | 'model' | 'year' | 'absent'

interface Row {
  entry: SheetEntry
  make?: string
  model?: string
  year?: number
  agreement: Agreement
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Compares each handwritten entry against the catalogue record the app actually
 * renders. Computed at runtime rather than baked in, so re-seeding the catalogue
 * keeps this honest instead of leaving a stale claim of agreement behind.
 */
function compare(entry: SheetEntry): Row {
  const m = machines.find(x => x.lot === entry.lot)
  if (!m) return { entry, agreement: 'absent' }

  const a = norm(entry.model), b = norm(m.model)
  const modelOk = a.includes(b) || b.includes(a)
  const yearOk = entry.year === undefined || entry.year === m.year

  return {
    entry, make: m.make, model: m.model, year: m.year,
    agreement: modelOk && yearOk ? 'match' : (!modelOk ? 'model' : 'year'),
  }
}

const LABEL: Record<Agreement, string> = {
  match: 'matches', model: 'model differs', year: 'year differs', absent: 'no such lot',
}

export function SheetVerification() {
  const [openSheet, setOpenSheet] = useState<string | null>(null)

  const sheets = useMemo(
    () => SHEETS.map(s => ({ sheet: s, rows: s.entries.map(compare) })),
    []
  )

  const all = sheets.flatMap(s => s.rows)
  const matched = all.filter(r => r.agreement === 'match').length
  const differing = all.filter(r => r.agreement === 'model' || r.agreement === 'year')
  const absent = all.filter(r => r.agreement === 'absent')

  return (
    <section className="page">
      <div className="section-head">
        <div>
          <span className="eyebrow">FIELD NOTES vs CATALOGUE</span>
          <h1>Lot sheets</h1>
          <p>Every lot written on the viewing sheets, checked against the machine
             cards in this app. Where the two disagree the catalogue is treated as
             correct — it is the seller's own record, and what the machine is sold as.</p>
        </div>
      </div>

      <div className="metric-grid">
        <div className="metric"><span>On the sheets</span><strong>{all.length}</strong><small>hand-written lots</small></div>
        <div className="metric"><span>Agree</span><strong>{matched}</strong><small>model and year</small></div>
        <div className="metric"><span>Differ</span><strong>{differing.length}</strong><small>check on site</small></div>
        <div className="metric"><span>Unreconciled</span><strong>{absent.length}</strong><small>no catalogue lot</small></div>
      </div>

      {differing.length > 0 && (
        <div className="panel">
          <h3>Worth checking in front of the machine</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Lot</th><th>On the sheet</th><th>On the card</th><th></th></tr></thead>
              <tbody>
                {differing.map(r => (
                  <tr key={r.entry.lot}>
                    <td><strong>{r.entry.lot}</strong></td>
                    <td>{r.entry.model} <small>{r.entry.year ?? '—'}</small></td>
                    <td><strong>{r.make} {r.model}</strong> <small>{r.year}</small></td>
                    <td><span className={`pill pill-${r.agreement}`}>{LABEL[r.agreement]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sheets.map(({ sheet, rows }) => (
        <SheetPanel key={sheet.id} sheet={sheet} rows={rows}
                    open={openSheet === sheet.id}
                    toggle={() => setOpenSheet(openSheet === sheet.id ? null : sheet.id)} />
      ))}
    </section>
  )
}

function SheetPanel({ sheet, rows, open, toggle }:
  { sheet: Sheet; rows: Row[]; open: boolean; toggle: () => void }) {
  const agree = rows.filter(r => r.agreement === 'match').length
  const src = `${import.meta.env.BASE_URL}lot-sheets/${sheet.image}`

  return (
    <div className="panel sheet-panel">
      <div className="section-head">
        <div>
          <h3>{sheet.label}</h3>
          <small className="muted">{sheet.subtitle} · {sheet.source}</small>
        </div>
        <span className="score-number">{agree}/{rows.length}</span>
      </div>

      <div className="sheet-layout">
        <figure className="sheet-shot">
          <button type="button" onClick={toggle} title={open ? 'Shrink photo' : 'Enlarge photo'}>
            <img src={src} alt={`Handwritten lot sheet — ${sheet.subtitle}`} loading="lazy" />
          </button>
          <figcaption>{open ? 'Tap to shrink' : 'Tap to enlarge'}</figcaption>
        </figure>

        <div className="table-wrap">
          <table>
            <thead><tr><th>Lot</th><th>Sheet</th><th>Card</th><th></th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.entry.lot} className={r.agreement === 'match' ? '' : 'row-flag'}>
                  <td><strong>{r.entry.lot}</strong></td>
                  <td>{r.entry.model} <small>{r.entry.year ?? '—'}</small></td>
                  <td>{r.make ? <>{r.make} {r.model} <small>{r.year}</small></>
                              : <span className="muted">not in the catalogue</span>}</td>
                  <td><span className={`pill pill-${r.agreement}`}>{LABEL[r.agreement]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {open && (
        <div className="sheet-zoom" onClick={toggle}>
          <img src={src} alt={`Handwritten lot sheet — ${sheet.subtitle}, enlarged`} />
        </div>
      )}
    </div>
  )
}
