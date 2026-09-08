/**
 * What was written on the handwritten lot sheets photographed during the
 * viewing, transcribed verbatim - including the abbreviations and the one
 * entry left without a year.
 *
 * This is deliberately NOT corrected to match the catalogue. The whole point of
 * the Sheets tab is to show where the yard notes and the catalogue disagree, so
 * an inspector can decide which to trust in front of the machine.
 */
export interface SheetEntry {
  lot: number
  /** Model exactly as written on the sheet. */
  model: string
  /** Year as written, or undefined where the sheet left it blank. */
  year?: number
}

export interface Sheet {
  id: string
  label: string
  subtitle: string
  /** File in public/lot-sheets/ */
  image: string
  /** Original camera filename, kept so a photo can be traced back. */
  source: string
  entries: SheetEntry[]
}

export const SHEETS: Sheet[] = [
  {
    id: 'sheet-1', label: 'Sheet 1', subtitle: 'Genie rough-terrain scissors',
    image: 'sheet-1.jpg', source: '20260908_013959.jpg (also shot as _014002)',
    entries: [
      { lot: 824, model: '5390', year: 2015 },
      { lot: 825, model: '5390', year: 2014 },
      { lot: 827, model: '5390', year: 2014 },
      { lot: 828, model: '5390', year: 2014 },
      { lot: 844, model: '3390', year: 2016 },
      { lot: 826, model: '5390', year: 2014 },
      { lot: 829, model: '5390', year: 2011 },
    ],
  },
  {
    id: 'sheet-2', label: 'Sheet 2', subtitle: 'JLG booms, Genie Z-135, Haulotte',
    image: 'sheet-2.jpg', source: '20260908_014633.jpg',
    entries: [
      { lot: 670, model: '600AJ', year: 2014 },
      { lot: 655, model: 'Z135', year: 2010 },
      { lot: 690, model: '18PX', year: 2017 },
      { lot: 668, model: '600AJ', year: 2015 },
      { lot: 671, model: '600AJ', year: 2014 },
      { lot: 665, model: '20PX', year: 2015 },
      { lot: 672, model: '600AJ', year: 2011 },
      { lot: 669, model: '660AT', year: 2014 },
      { lot: 673, model: '600AJ', year: 2010 },
      { lot: 631, model: '23RTJ', year: 2014 },
      { lot: 691, model: '18SPX', year: 2013 },
    ],
  },
  {
    id: 'sheet-3', label: 'Sheet 3', subtitle: 'Haulotte booms and electric IP series',
    image: 'sheet-3.jpg', source: '20260908_014645.jpg',
    entries: [
      { lot: 728, model: '15IP', year: 2017 },
      { lot: 652, model: '18SPX', year: 2007 },
      { lot: 693, model: '16PX', year: 2014 },
      { lot: 695, model: '16SPX', year: 2012 },
      { lot: 694, model: '18SPX' },
      { lot: 657, model: '16SPX', year: 2006 },
      { lot: 729, model: '12IP', year: 2014 },
      { lot: 730, model: '12IP', year: 2012 },
      { lot: 630, model: '23TPX', year: 2006 },
    ],
  },
  {
    id: 'sheet-4', label: 'Sheet 4', subtitle: 'Haulotte STAR 10 mast lifts',
    image: 'sheet-4.jpg', source: '20260908_014711.jpg',
    entries: [
      { lot: 753, model: 'Star 10', year: 2011 },
      { lot: 755, model: 'Star 10', year: 2014 },
      { lot: 747, model: 'Star 10', year: 2016 },
      { lot: 745, model: 'Star 10', year: 2016 },
      { lot: 757, model: 'Star 10', year: 2014 },
      { lot: 754, model: 'Star 10', year: 2013 },
      { lot: 675, model: '660AS', year: 2015 },
      { lot: 654, model: '16SPX', year: 2013 },
      { lot: 699, model: '16SPX', year: 2011 },
      { lot: 756, model: 'Star 10', year: 2009 },
    ],
  },
  {
    id: 'sheet-5', label: 'Sheet 5', subtitle: 'Two remaining lots',
    image: 'sheet-5.jpg', source: '20260908_014731.jpg',
    entries: [
      { lot: 752, model: 'Star 10', year: 2014 },
      { lot: 676, model: 'E600JP', year: 2010 },
    ],
  },
]
