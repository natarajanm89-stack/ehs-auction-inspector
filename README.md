# EHS Auction Inspector

A mobile-first auction inspection, bidding and acquisition workspace for **EHS Global Access Equipment Pvt Ltd**.

The starter dataset is tailored to the **Ritchie Bros. Netherlands Unreserved Auction, Zevenbergen / Moerdijk, 9–10 September 2026** and focuses on equipment aligned with EHS's access-equipment rental/sales profile.

## What the app does

- **Auction overview** — viewing window, auction mode, payment/removal deadlines, catalog mix.
- **Machine queue** — real starter lots with Ritchie Bros. images, lot links, hours and catalog specifications.
- **EHS priorities** — P1/P2/P3 ranking based on fleet fit, parts familiarity and rental demand.
- **Field inspection** — 10-domain 1–5 scoring model for structure, hydraulics, controls, safety, tyres and rental readiness.
- **Critical safety gates** — any explicit FAIL produces a REJECT recommendation.
- **Photo evidence** — camera/file capture compressed into local browser storage for the static MVP.
- **Commercial model** — editable EUR→INR planning FX, NL transport, sea freight, insurance, import/tax allowance, India inland, repair reserve, contingency and margin.
- **Stop-bid calculator** — derives a maximum bid from the acquisition/resale value target and landed-cost assumptions.
- **Bid board** — WATCH / READY / BIDDING / STOPPED / WON / LOST states with headroom to the stop-bid.
- **Exports** — JSON session backup and CSV bid board.
- **Offline-capable shell** — simple service worker caches the app shell after first load.

## Important operating model

Catalog data and EHS inspection data are intentionally separated.

- Catalog facts are only a **starting point**.
- Hours, serial number, CE documentation and functions must be verified on site.
- The buying calculator is a **commercial planning tool**, not tax/customs advice.
- For a static GitHub Pages build, entered inspection data stays on the browser/device. Export the session after inspection.

## Local development

```bash
npm install
npm run dev
```

Production check:

```bash
npm run build
npm run preview
```

## GitHub Pages deployment

The repository includes:

```text
.github/workflows/deploy.yml
```

1. Create a GitHub repository and copy this project into it.
2. Commit and push to `main` (or `master`).
3. In GitHub: **Settings → Pages → Build and deployment → Source → GitHub Actions**.
4. Push again or run **Actions → Deploy EHS Auction Inspector → Run workflow**.
5. GitHub Pages will publish the `dist` artifact.

The Vite config uses `base: './'`, so it works when deployed under a repository path such as:

```text
https://<org>.github.io/<repo>/
```

## Starter lots

The seed dataset includes verified examples from the live auction catalog such as:

- Lot 659 — 2013 JLG 800AJ
- Lot 667 — 2015 JLG 600AJ
- Lot 690 — 2017 Haulotte HA18SPX
- Lot 834 — 2015 Haulotte H18SXL
- Lot 873 — 2016 Haulotte Compact 12
- Lot 758 — 2021 ATN PIAF 10RE
- Lot 763 — 2016 Genie GR-20
- Lot 100 — 2023 Bobcat T40.180SLPRC
- Lot 107 — 2018 Manitou MHT790
- Lot 95 — 2014 Manitou MRT2150+

Edit `src/data.ts` to add more lots. The next production step should replace static seed data with an API/database sync.

## Recommended production evolution

For use by multiple directors/inspectors across devices, add a backend (Supabase/PostgreSQL or an EHS internal API) with these entities:

```text
Auction
MachineLot
CatalogSnapshot
Inspection
InspectionCheck
EvidencePhoto
CommercialScenario
BidPlan
BidEvent
Purchase
LogisticsMilestone
User / Role
```

Suggested roles:

- Managing Director — approve shortlist, stop-bid and purchase.
- Inspector — machine condition, photos and repair estimate.
- Buyer — current bid, bidding status and auction outcome.
- Logistics/Finance — landed cost, payment and removal milestones.

## Data provenance

Starter auction data was checked against Ritchie Bros. public Zevenbergen catalog/product-detail pages on 7 September 2026. Remote catalog images remain hosted by Ritchie Bros./IronPlanet and are not copied into this repository.
