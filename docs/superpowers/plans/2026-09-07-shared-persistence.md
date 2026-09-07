# Shared Persistence, Access Codes and Team Comments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the EHS Auction Inspector from single-device `localStorage` to shared Supabase persistence with access-code entry, three roles, offline-first sync, photo upload and per-lot comment threads.

**Architecture:** The app stays a static Vite build on GitHub Pages and talks directly to Supabase. IndexedDB is the working copy the UI reads and writes; a background sync worker pushes dirty field-groups through one idempotent RPC and pulls changes via realtime. All permissions are enforced by Postgres row-level security, never by the client.

**Tech Stack:** React 18 + TypeScript + Vite; `@supabase/supabase-js` v2; `idb-keyval` for IndexedDB; Vitest + `fake-indexeddb` for tests; Supabase CLI for SQL migrations; GitHub Actions → GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-09-07-shared-persistence-design.md`

## Global Constraints

- Frontend stays a **static build**. No server-side runtime of ours. All Supabase access is from the browser.
- **The UI never awaits the network.** Every mutation writes IndexedDB + React state + outbox synchronously, then returns.
- **RLS is the only security boundary.** Never gate behaviour on client-side role checks alone; every table has explicit policies and no table is left with RLS disabled.
- The anon key is public by design. The `service_role` key must never appear in `src/`, `.env`, or any committed file.
- `calc()` and `autoDecision()` must remain behaviourally identical. Any change to their output is a regression.
- Existing TypeScript types in `src/types.ts` stay as-is, with one exception: `InspectionState.photos` is removed (photos move to their own table).
- Conflict resolution is **last-write-wins per field group** (`inspection`, `commercial`, `decision`) using client-supplied timestamps.
- **All application objects live in the `ehs` schema, never `public`.** The target
  project (`zxfyfigmajlvgbddlbbx`, "VanithaHomeKitchen") already hosts an unrelated
  app in `public`; nothing in this plan may create, alter or drop anything there.
- The Supabase JS client must be constructed with `db: { schema: 'ehs' }`, and `ehs`
  must be listed under **Settings → API → Data API → Exposed schemas** or every
  request 404s.
- Supabase region: **eu-central-2 (Zurich)**, fixed. Shared with the existing app.
- **Never run `supabase db push`, `db reset` or `db pull`.** The remote project holds
  21 migrations owned by another application. All SQL here is applied with
  `psql "$(scripts/db-url.sh)" -v ON_ERROR_STOP=1 -f <file>`, and our SQL lives in `db/`,
  outside `supabase/migrations/`, so the CLI never touches it.
- Commit after every task. Conventional-commit prefixes (`feat:`, `test:`, `chore:`, `refactor:`).

## File Structure

| File | Responsibility |
|---|---|
| `db/0001_schema.sql` | Tables, indexes, enum-ish constraints |
| `db/0002_functions.sql` | `redeem_access_code`, `sync_machine_state`, role helper |
| `db/0003_rls.sql` | RLS policies for every table + storage bucket |
| `db/seed_machines.sql` | Generated one-time catalog seed from `src/data.ts` |
| `src/lib/keyGuard.ts` | Pure, testable service_role key guard |
| `src/lib/supabase.ts` | Client construction + anonymous session bootstrap |
| `src/lib/profile.ts` | Profile fetch, role type, `redeemCode()` wrapper |
| `src/lib/db.ts` | IndexedDB: state cache, photo blobs, outbox queue |
| `src/lib/sync.ts` | Outbox drain, realtime subscribe, online/offline state |
| `src/lib/calc.ts` | `blankState`, `calc`, `autoDecision` lifted from `App.tsx` |
| `src/lib/migrate.ts` | One-time `localStorage` → server import |
| `src/hooks/useMachineState.ts` | Local-first read/write hook per lot |
| `src/components/Gate.tsx` | Access code + name screen |
| `src/components/SyncBadge.tsx` | synced / pending N / offline indicator |
| `src/components/Comments.tsx` | Thread, composer, unread marker |
| `src/components/Photos.tsx` | Capture, local preview, upload state |
| `src/App.tsx` | Routing + shell only |
| `scripts/check-rls.mjs` | Scripted RLS assertion across all three roles |
| `.github/workflows/deploy.yml` | Build + publish to Pages |

---

### Task 1: Repo, dependencies and test harness

This directory is not yet a git repo and has no test runner. Everything downstream needs both.

**Files:**
- Create: `.gitignore` (already written), `vitest.config.ts`, `src/lib/__tests__/harness.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing
- Produces: `npm test` runs Vitest; `npm run build` still succeeds

- [ ] **Step 1: Initialise git and commit the current state**

```bash
cd /Users/natarajanmurugesan/Downloads/ehs-auction-inspector
git init -b main
git add -A
git commit -m "chore: baseline before shared persistence work"
```

Expected: a first commit containing `src/`, `docs/`, `.gitignore`, and **not** `.env` or `node_modules`. Verify with `git status --short` (should be clean) and `git ls-files | grep -c node_modules` (should print `0`).

- [ ] **Step 2: Install dependencies**

```bash
npm install @supabase/supabase-js idb-keyval
npm install -D vitest fake-indexeddb @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 3: Add the test script**

In `package.json`, add to `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
})
```

- [ ] **Step 5: Create `vitest.setup.ts`**

`fake-indexeddb/auto` installs a working IndexedDB into jsdom, which has none. Without it every `db.ts` test fails with `indexedDB is not defined`.

```ts
import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 6: Write a harness test that proves the setup works**

Create `src/lib/__tests__/harness.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

describe('test harness', () => {
  it('provides IndexedDB in the test environment', () => {
    expect(typeof indexedDB).toBe('object')
    expect(indexedDB).not.toBeNull()
  })
})
```

- [ ] **Step 7: Run the tests**

Run: `npm test`
Expected: PASS, 1 test.

- [ ] **Step 8: Verify the production build is unbroken**

Run: `npm run build`
Expected: exit 0, `dist/` produced.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: add vitest harness and supabase dependencies"
```

---

### Task 2: Extract calc.ts with regression tests

`calc()`, `autoDecision()` and `blankState()` live inside `src/App.tsx` (lines 12–68). Every later task needs them, and `App.tsx` is about to be split. Lift them first, under test, so a later regression is caught immediately.

**Files:**
- Create: `src/lib/calc.ts`, `src/lib/__tests__/calc.test.ts`
- Modify: `src/App.tsx:12-68` (delete the moved functions, import them instead)

**Interfaces:**
- Consumes: `Machine`, `MachineState` from `src/types.ts`; `INSPECTION_SECTIONS`, `CRITICAL_CHECKS` from `src/data.ts`
- Produces:
  - `blankState(): MachineState`
  - `calc(machine: Machine, state: MachineState): CalcResult`
  - `autoDecision(machine: Machine, state: MachineState): Decision`
  - `interface CalcResult { technical: number; commercialFit: number; blended: number; criticalFail: boolean; criticalComplete: boolean; calculatedMaxBid: number; effectiveMaxBid: number; landedEur: number; landedInr: number }`

- [ ] **Step 1: Write the failing regression tests**

Create `src/lib/__tests__/calc.test.ts`. These pin the current behaviour exactly — if the lift changes any number, they fail.

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- calc`
Expected: FAIL — `Failed to resolve import "../calc"`.

- [ ] **Step 3: Create `src/lib/calc.ts`**

Move the three functions from `App.tsx` **verbatim** — do not "improve" them. `photos` is dropped from `blankState` because it moves to its own table in Task 3.

```ts
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
```

- [ ] **Step 4: Remove `photos` from the inspection type**

In `src/types.ts`, delete the line `photos: string[]` from `InspectionState`.

- [ ] **Step 5: Update `App.tsx` to import instead of define**

Delete `blankState`, `calc` and `autoDecision` from `src/App.tsx` and add to the imports at the top:

```ts
import { autoDecision, blankState, calc } from './lib/calc'
```

Also delete the now-dead `photos` references in `App.tsx`: the `<div className="photo-grid full">` block and the `handlePhotos` / `compressImage` functions plus the `<input type="file" …>` label that calls `handlePhotos`. Task 11 replaces them with `<Photos />`.

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test && npx tsc --noEmit -p tsconfig.app.json && npm run build`
Expected: all tests PASS, no type errors, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: extract calc.ts with regression tests"
```

---

### Task 3: Database schema

**Files:**
- Create: `db/0001_schema.sql`, `scripts/gen-seed.mjs`, `db/seed_machines.sql`

**Interfaces:**
- Consumes: `src/data.ts` (`machines` array) as the seed source
- Produces: tables `profiles`, `access_codes`, `machines`, `machine_states`, `photos`, `comments`, `comment_reads`

- [ ] **Step 1: Confirm the CLI is already initialised and linked**

The controller has already run `supabase init` and `supabase link --project-ref
zxfyfigmajlvgbddlbbx`. Verify, do not repeat:

```bash
test -f supabase/config.toml && echo linked-ok
```

- [ ] **Step 2: Confirm psql can reach the database**

**Do not use `supabase db push`.** The remote project carries 21 migrations
belonging to an unrelated application; pushing would try to reconcile our work
with that history. All SQL in this plan is applied directly with `psql`, which
leaves the other app's migration history untouched.

```bash
psql "$(scripts/db-url.sh)" -v ON_ERROR_STOP=1 -c "select current_database(), current_user;"
```

Expected: one row. If `psql` is not on PATH, use
`/opt/homebrew/opt/libpq/bin/psql`.

- [ ] **Step 3: Write `db/0001_schema.sql`**

```sql
create extension if not exists pgcrypto;

-- Everything for this app lives here. The project's public schema belongs to an
-- unrelated application and must not be touched.
create schema if not exists ehs;
grant usage on schema ehs to authenticated, anon;

-- Identity. One row per device that has redeemed a code.
create table ehs.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null check (length(trim(display_name)) between 1 and 60),
  role          text not null check (role in ('admin','inspector','viewer')),
  created_at    timestamptz not null default now()
);

-- Hashed access codes, one per role. Never readable by any client.
create table ehs.access_codes (
  role        text primary key check (role in ('admin','inspector','viewer')),
  code_hash   text not null,
  updated_at  timestamptz not null default now()
);

-- Rate limiting for code redemption, keyed by anonymous auth uid.
create table ehs.code_attempts (
  uid          uuid primary key,
  attempts     int not null default 0,
  first_at     timestamptz not null default now()
);

-- Catalog. Mirrors the Machine type in src/types.ts.
create table ehs.machines (
  lot             int primary key,
  year            int,
  make            text not null,
  model           text not null,
  title           text not null,
  category        text not null,
  power           text not null,
  hours           int,
  serial          text,
  location        text not null,
  image_url       text,
  source_url      text not null,
  features        text[] not null default '{}',
  notes           text,
  priority        text not null check (priority in ('P1','P2','P3')),
  fleet_fit       int not null,
  parts_support   int not null,
  rental_demand   int not null,
  source_verified boolean not null default false
);

-- Per-lot state, three independently versioned field groups.
create table ehs.machine_states (
  lot                     int primary key references ehs.machines(lot) on delete cascade,
  inspection              jsonb not null default '{}'::jsonb,
  inspection_updated_at   timestamptz not null default 'epoch',
  commercial              jsonb not null default '{}'::jsonb,
  commercial_updated_at   timestamptz not null default 'epoch',
  decision                text not null default 'UNASSESSED',
  shortlist               boolean not null default false,
  decision_updated_at     timestamptz not null default 'epoch'
);

create table ehs.photos (
  id            uuid primary key default gen_random_uuid(),
  lot           int not null references ehs.machines(lot) on delete cascade,
  storage_path  text not null unique,
  caption       text,
  taken_by      uuid references ehs.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index photos_lot_idx on ehs.photos (lot, created_at desc);

create table ehs.comments (
  id           uuid primary key default gen_random_uuid(),
  lot          int not null references ehs.machines(lot) on delete cascade,
  author_id    uuid references ehs.profiles(id) on delete set null,
  author_name  text not null,
  body         text not null check (length(trim(body)) between 1 and 4000),
  created_at   timestamptz not null default now(),
  edited_at    timestamptz
);
create index comments_lot_idx on ehs.comments (lot, created_at);

create table ehs.comment_reads (
  profile_id    uuid not null references ehs.profiles(id) on delete cascade,
  lot           int not null references ehs.machines(lot) on delete cascade,
  last_read_at  timestamptz not null default now(),
  primary key (profile_id, lot)
);

-- PostgREST needs table privileges as well as RLS policies; RLS then narrows
-- what these grants allow.
grant select, insert, update, delete on all tables in schema ehs to authenticated;

-- Deny-by-default. Policies arrive in 0003.
alter table ehs.profiles       enable row level security;
alter table ehs.access_codes   enable row level security;
alter table ehs.code_attempts  enable row level security;
alter table ehs.machines       enable row level security;
alter table ehs.machine_states enable row level security;
alter table ehs.photos         enable row level security;
alter table ehs.comments       enable row level security;
alter table ehs.comment_reads  enable row level security;
```

`inspection_updated_at` defaults to `'epoch'`, not `now()`. A row created by the seed must lose to any real client edit; defaulting to `now()` would make fresh empty rows beat genuine offline work.

- [ ] **Step 4: Write the seed generator `scripts/gen-seed.mjs`**

Hand-writing 20+ INSERT statements invites transcription errors. Generate them from the existing typed data instead.

```js
import { machines } from '../src/data.ts'
import { writeFileSync } from 'node:fs'

const q = v => v === undefined || v === null ? 'null' : `'${String(v).replace(/'/g, "''")}'`
const n = v => v === undefined || v === null ? 'null' : Number(v)
const arr = a => `array[${(a || []).map(q).join(',')}]::text[]`

const rows = machines.map(m => `(${[
  n(m.lot), n(m.year), q(m.make), q(m.model), q(m.title), q(m.category), q(m.power),
  n(m.hours), q(m.serial), q(m.location), q(m.imageUrl), q(m.sourceUrl), arr(m.features),
  q(m.notes), q(m.priority), n(m.fleetFit), n(m.partsSupport), n(m.rentalDemand),
  m.sourceVerified ? 'true' : 'false',
].join(', ')})`).join(',\n  ')

const sql = `-- Generated by scripts/gen-seed.mjs. Do not edit by hand.
insert into ehs.machines (
  lot, year, make, model, title, category, power, hours, serial, location,
  image_url, source_url, features, notes, priority, fleet_fit, parts_support,
  rental_demand, source_verified
) values
  ${rows}
on conflict (lot) do nothing;

insert into ehs.machine_states (lot)
select lot from ehs.machines
on conflict (lot) do nothing;
`

writeFileSync(new URL('../db/seed_machines.sql', import.meta.url), sql)
console.log(`wrote ${machines.length} machines`)
```

- [ ] **Step 5: Generate the seed**

```bash
npx vite-node scripts/gen-seed.mjs
```

(`vite-node` is already available via Vite; it resolves the `.ts` import that plain `node` cannot.)

Expected: prints `wrote N machines`; `db/seed_machines.sql` exists.

Verify the count matches the source: `grep -c '^  (' db/seed_machines.sql` should equal the number of entries in `src/data.ts`.

- [ ] **Step 6: Apply the schema and seed**

```bash
psql "$(scripts/db-url.sh)" -v ON_ERROR_STOP=1 -f db/0001_schema.sql
psql "$(scripts/db-url.sh)" -v ON_ERROR_STOP=1 -f db/seed_machines.sql
```

`ON_ERROR_STOP=1` matters: without it psql reports success after a failed
statement, and you would seed into a half-built schema.

- [ ] **Step 7: Verify the tables exist and are seeded**

```bash
psql "$(scripts/db-url.sh)" -v ON_ERROR_STOP=1 -c "select count(*) as machines from ehs.machines; select count(*) as states from ehs.machine_states;"
```

Expected: both counts equal the number of lots in `src/data.ts`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add supabase schema and catalog seed"
```

---

### Task 4: Database functions

Two functions carry the whole design: one is the only path to a role, the other is the only path to writing state.

**Files:**
- Create: `db/0002_functions.sql`

**Interfaces:**
- Consumes: tables from Task 3
- Produces:
  - `ehs.caller_role() returns text` — SECURITY DEFINER, reads caller's role
  - `ehs.redeem_access_code(p_code text, p_display_name text) returns text` — returns the granted role, or `'invalid_code'` / `'rate_limited'` (raises only on `not authenticated` / bad name, before any writes)
  - `ehs.sync_machine_state(p_lot int, p_group text, p_payload jsonb, p_client_updated_at timestamptz) returns boolean` — true if applied, false if the incoming write was stale
  - `ehs.set_access_code(p_role text, p_code text) returns void` — admin-only rotation

- [ ] **Step 1: Write `db/0002_functions.sql`**

```sql
-- Reads the caller's role without triggering the profiles RLS policy.
-- Named caller_role, not current_role: current_role is a reserved SQL keyword
-- and a built-in Postgres function.
-- SECURITY DEFINER is required: policies on profiles will themselves call
-- this function, and a plain query would recurse infinitely.
create or replace function ehs.caller_role()
returns text
language sql
security definer
set search_path = ehs, public, extensions
stable
as $$
  select role from ehs.profiles where id = auth.uid();
$$;

revoke all on function ehs.caller_role() from public;
grant execute on function ehs.caller_role() to authenticated;

-- Redeems a code and creates the caller's profile. The only way to get a role.
create or replace function ehs.redeem_access_code(p_code text, p_display_name text)
returns text
language plpgsql
security definer
set search_path = ehs, public, extensions
as $$
declare
  v_uid    uuid := auth.uid();
  v_role   text;
  v_name   text := trim(p_display_name);
  v_tries  int;
  v_since  timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if length(v_name) < 1 or length(v_name) > 60 then
    raise exception 'name must be between 1 and 60 characters';
  end if;

  -- Rate limit: 10 attempts per 15 minutes per identity. Only failed
  -- attempts increment the counter (see below), and success never touches
  -- it, so a legitimate inspector redeeming repeatedly is never locked out.
  insert into ehs.code_attempts (uid, attempts, first_at)
    values (v_uid, 0, now())
  on conflict (uid) do update set uid = excluded.uid
  returning attempts, first_at into v_tries, v_since;

  if v_since < now() - interval '15 minutes' then
    update ehs.code_attempts set attempts = 0, first_at = now() where uid = v_uid;
    v_tries := 0;
  end if;

  if v_tries >= 10 then
    return 'rate_limited';
  end if;

  select role into v_role
    from ehs.access_codes
   where code_hash = crypt(p_code, code_hash);

  if v_role is null then
    update ehs.code_attempts set attempts = attempts + 1 where uid = v_uid;
    -- Must return, not raise: raising here would abort the transaction and
    -- roll back the increment above, defeating the rate limit entirely.
    return 'invalid_code';
  end if;

  insert into ehs.profiles (id, display_name, role)
    values (v_uid, v_name, v_role)
  on conflict (id) do update
    set display_name = excluded.display_name,
        role         = excluded.role;

  return v_role;
end;
$$;

revoke all on function ehs.redeem_access_code(text, text) from public;
grant execute on function ehs.redeem_access_code(text, text) to authenticated;

-- Admin-only code rotation. Stores only the hash.
create or replace function ehs.set_access_code(p_role text, p_code text)
returns void
language plpgsql
security definer
set search_path = ehs, public, extensions
as $$
begin
  if ehs.caller_role() is distinct from 'admin' then
    raise exception 'admin role required';
  end if;
  if p_role not in ('admin','inspector','viewer') then
    raise exception 'unknown role %', p_role;
  end if;
  if length(coalesce(p_code, '')) < 12 then
    raise exception 'code must be at least 12 characters';
  end if;

  insert into ehs.access_codes (role, code_hash, updated_at)
    values (p_role, crypt(p_code, gen_salt('bf', 12)), now())
  on conflict (role) do update
    set code_hash = excluded.code_hash, updated_at = now();
end;
$$;

revoke all on function ehs.set_access_code(text, text) from public;
grant execute on function ehs.set_access_code(text, text) to authenticated;

-- The only write path for machine state. Idempotent, per-field-group LWW.
create or replace function ehs.sync_machine_state(
  p_lot int,
  p_group text,
  p_payload jsonb,
  p_client_updated_at timestamptz
) returns boolean
language plpgsql
security invoker          -- runs as the caller, so RLS on machine_states applies
set search_path = ehs, public, extensions
as $$
declare
  v_rows int := 0;
begin
  if p_group not in ('inspection','commercial','decision') then
    raise exception 'unknown field group %', p_group;
  end if;

  -- Clamp to guard against a skewed or hostile client clock. An unbounded
  -- future timestamp would freeze this field group forever.
  p_client_updated_at := least(p_client_updated_at, now() + interval '5 minutes');

  insert into ehs.machine_states (lot) values (p_lot)
  on conflict (lot) do nothing;

  if p_group = 'inspection' then
    update ehs.machine_states
       set inspection = p_payload, inspection_updated_at = p_client_updated_at
     where lot = p_lot and inspection_updated_at < p_client_updated_at;

  elsif p_group = 'commercial' then
    update ehs.machine_states
       set commercial = p_payload, commercial_updated_at = p_client_updated_at
     where lot = p_lot and commercial_updated_at < p_client_updated_at;

  else
    update ehs.machine_states
       set decision   = coalesce(p_payload->>'decision', decision),
           shortlist  = coalesce((p_payload->>'shortlist')::boolean, shortlist),
           decision_updated_at = p_client_updated_at
     where lot = p_lot and decision_updated_at < p_client_updated_at;
  end if;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function ehs.sync_machine_state(int, text, jsonb, timestamptz) from public;
grant execute on function ehs.sync_machine_state(int, text, jsonb, timestamptz) to authenticated;
```

`sync_machine_state` is **SECURITY INVOKER** on purpose. It must run under the caller's own permissions so the RLS policy on `machine_states` rejects a viewer's write. Making it DEFINER would silently hand every viewer full write access — the single most dangerous mistake available in this plan.

- [ ] **Step 2: Apply the migration**

```bash
psql "$(scripts/db-url.sh)" -v ON_ERROR_STOP=1 -f db/0002_functions.sql
```

- [ ] **Step 3: Seed the three access codes**

Pick three distinct codes. Replace the placeholders below with your real ones — and do not commit them anywhere.

```bash
psql "$(scripts/db-url.sh)" -v ON_ERROR_STOP=1 -c "
insert into ehs.access_codes (role, code_hash) values
  ('admin',     crypt('CHOOSE-ADMIN-CODE',     gen_salt('bf'))),
  ('inspector', crypt('CHOOSE-INSPECTOR-CODE', gen_salt('bf'))),
  ('viewer',    crypt('CHOOSE-VIEWER-CODE',    gen_salt('bf')))
on conflict (role) do update set code_hash = excluded.code_hash;"
```

- [ ] **Step 4: Verify the codes match and the plaintext is unrecoverable**

```bash
psql "$(scripts/db-url.sh)" -v ON_ERROR_STOP=1 -c "
select role, code_hash = crypt('CHOOSE-INSPECTOR-CODE', code_hash) as matches,
       left(code_hash, 7) as hash_prefix
  from ehs.access_codes order by role;"
```

Expected: three rows; `matches` is `t` only for `inspector`; every `hash_prefix` starts `$2a$` or `$2b$` (a bcrypt hash, not the plaintext).

- [ ] **Step 5: Verify stale writes are rejected**

```bash
psql "$(scripts/db-url.sh)" -v ON_ERROR_STOP=1 -c "
select ehs.sync_machine_state(
  (select min(lot) from ehs.machines), 'commercial',
  '{\"currentBidEur\": 999}'::jsonb, '1999-01-01T00:00:00Z') as should_be_false;"
```

Expected: `f`. An epoch-old timestamp must not beat the row's `'epoch'` default via `<` — confirming the comparison is strict.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add access code redemption and state sync functions"
```

---

### Task 5: Row-level security policies and storage

Every table currently has RLS on with zero policies, which means nobody can read anything. This task defines who can do what.

**Files:**
- Create: `db/0003_rls.sql`

**Interfaces:**
- Consumes: `ehs.caller_role()` from Task 4
- Produces: a private `inspection-photos` storage bucket and policies on all eight tables

- [ ] **Step 1: Write `db/0003_rls.sql`**

```sql
-- profiles: everyone with a profile can see the team; you edit only your own
-- name; only an admin changes roles (via the admin update policy below).
create policy profiles_select on ehs.profiles
  for select to authenticated
  using (ehs.caller_role() is not null);

-- profiles_insert_self only constrained id, not role: any authenticated
-- (even anonymous, code-less) user could self-insert as admin. Removed;
-- redeem_access_code is SECURITY DEFINER and bypasses RLS, so it remains the
-- only path to a profile row. Drop kept here so re-running this file is
-- idempotent and never recreates the policy.
drop policy if exists profiles_insert_self on ehs.profiles;

-- The `role = ehs.caller_role()` check below prevents self-escalation ONLY
-- because caller_role() is STABLE: inside WITH CHECK it reads the statement's
-- snapshot and returns the PRE-update role, so the new role is compared against
-- the old one. Marking caller_role() VOLATILE would silently break this.
create policy profiles_update_self on ehs.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = ehs.caller_role());

create policy profiles_admin_all on ehs.profiles
  for all to authenticated
  using (ehs.caller_role() = 'admin')
  with check (ehs.caller_role() = 'admin');

-- access_codes and code_attempts: no client access at all. The SECURITY
-- DEFINER functions bypass RLS; nothing else may touch these.
-- (RLS enabled with no policies = deny all.)

-- machines: everyone reads the catalog, only admins change it.
create policy machines_select on ehs.machines
  for select to authenticated
  using (ehs.caller_role() is not null);

create policy machines_admin_write on ehs.machines
  for all to authenticated
  using (ehs.caller_role() = 'admin')
  with check (ehs.caller_role() = 'admin');

-- machine_states: everyone reads, inspectors and admins write.
create policy states_select on ehs.machine_states
  for select to authenticated
  using (ehs.caller_role() is not null);

create policy states_write on ehs.machine_states
  for all to authenticated
  using (ehs.caller_role() in ('inspector','admin'))
  with check (ehs.caller_role() in ('inspector','admin'));

-- photos: everyone reads, inspectors add, authors and admins delete.
create policy photos_select on ehs.photos
  for select to authenticated
  using (ehs.caller_role() is not null);

create policy photos_insert on ehs.photos
  for insert to authenticated
  with check (ehs.caller_role() in ('inspector','admin') and taken_by = auth.uid());

create policy photos_delete on ehs.photos
  for delete to authenticated
  using (taken_by = auth.uid() or ehs.caller_role() = 'admin');

create policy photos_update on ehs.photos
  for update to authenticated
  using (taken_by = auth.uid() or ehs.caller_role() = 'admin')
  with check (taken_by = auth.uid() or ehs.caller_role() = 'admin');

-- comments: anyone with a profile posts; authors edit their own for 5 minutes;
-- authors and admins delete.
create policy comments_select on ehs.comments
  for select to authenticated
  using (ehs.caller_role() is not null);

create policy comments_insert on ehs.comments
  for insert to authenticated
  with check (ehs.caller_role() is not null and author_id = auth.uid());

create policy comments_update_own on ehs.comments
  for update to authenticated
  using (author_id = auth.uid() and created_at > now() - interval '5 minutes')
  with check (author_id = auth.uid());

create policy comments_delete on ehs.comments
  for delete to authenticated
  using (author_id = auth.uid() or ehs.caller_role() = 'admin');

-- author_name is denormalised so history survives a profile deletion, but it
-- must be the poster's real name, not free text: without this a viewer could
-- post a comment displayed as an inspector's name.
create or replace function ehs.comments_stamp_author()
returns trigger
language plpgsql
security definer
set search_path = ehs, public, extensions
as $$
begin
  new.author_id   := auth.uid();
  new.author_name := coalesce(
    (select display_name from ehs.profiles where id = auth.uid()),
    'Unknown'
  );
  new.created_at  := now();
  new.edited_at   := null;
  return new;
end;
$$;

drop trigger if exists comments_stamp_author_trg on ehs.comments;
create trigger comments_stamp_author_trg
  before insert on ehs.comments
  for each row execute function ehs.comments_stamp_author();

-- Only the body may change, and only inside the 5-minute window the policy
-- enforces. Pinning created_at here is what stops the window being extended
-- indefinitely by PATCHing created_at itself.
create or replace function ehs.comments_guard_update()
returns trigger
language plpgsql
security definer
set search_path = ehs, public, extensions
as $$
begin
  new.id         := old.id;
  new.lot        := old.lot;
  new.author_id  := old.author_id;
  new.author_name:= old.author_name;
  new.created_at := old.created_at;
  new.edited_at  := now();
  return new;
end;
$$;

drop trigger if exists comments_guard_update_trg on ehs.comments;
create trigger comments_guard_update_trg
  before update on ehs.comments
  for each row execute function ehs.comments_guard_update();

-- comment_reads: strictly your own.
create policy reads_own on ehs.comment_reads
  for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- Realtime broadcast for the two tables clients subscribe to.
alter publication supabase_realtime add table ehs.machine_states;
alter publication supabase_realtime add table ehs.comments;

-- Private photo bucket.
insert into storage.buckets (id, name, public)
  values ('inspection-photos', 'inspection-photos', false)
on conflict (id) do nothing;

create policy photos_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'inspection-photos' and ehs.caller_role() is not null);

create policy photos_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'inspection-photos' and ehs.caller_role() in ('inspector','admin'));

create policy photos_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'inspection-photos'
         and (owner = auth.uid() or ehs.caller_role() = 'admin'));
```

- [ ] **Step 2: Apply**

```bash
psql "$(scripts/db-url.sh)" -v ON_ERROR_STOP=1 -f db/0003_rls.sql
```

- [ ] **Step 3: Verify every table has RLS enabled**

```bash
psql "$(scripts/db-url.sh)" -v ON_ERROR_STOP=1 -c "
select tablename, rowsecurity
  from pg_tables where schemaname = 'ehs' order by tablename;"
```

Expected: `rowsecurity` is `t` for all eight tables. Any `f` is a hole.

- [ ] **Step 4: Verify the two locked tables have no policies**

```bash
psql "$(scripts/db-url.sh)" -v ON_ERROR_STOP=1 -c "
select tablename, count(*) as policies
  from pg_policies where schemaname = 'ehs'
 group by tablename order by tablename;"
```

Expected: `access_codes` and `code_attempts` do not appear at all (zero policies = deny all). Every other table appears with at least one.

- [ ] **Step 5a: Expose the `ehs` schema to the Data API**

In the Supabase dashboard: **Settings → API → Data API → Exposed schemas** — add
`ehs` alongside `public` and save. Without this every client query returns 404
with `PGRST106`, even though the tables and policies are correct.

- [ ] **Step 5: Enable anonymous sign-ins**

In the Supabase dashboard: **Authentication → Sign In / Providers → Anonymous sign-ins → Enable**. Without this, `signInAnonymously()` in Task 6 fails with `anonymous_provider_disabled` and nothing else in the app works.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add row-level security policies and photo storage bucket"
```

---

### Task 6: Supabase client and anonymous session

**Files:**
- Create: `src/lib/keyGuard.ts`, `src/lib/supabase.ts`, `src/lib/profile.ts`
- Create: `src/lib/__tests__/keyGuard.test.ts`, `src/lib/__tests__/profile.test.ts`
- Create: `src/vite-env.d.ts`

**Interfaces:**
- Consumes: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- Produces:
  - `supabase: SupabaseClient`
  - `ensureSession(): Promise<string>` — returns the anonymous user id, signing in if needed
  - `type Role = 'admin' | 'inspector' | 'viewer'`
  - `interface Profile { id: string; display_name: string; role: Role }`
  - `fetchProfile(): Promise<Profile | null>`
  - `redeemCode(code: string, displayName: string): Promise<Role>`
  - `can(role: Role | null, action: 'write_state' | 'write_catalog' | 'comment'): boolean`

- [ ] **Step 1: Declare the env var types**

Create `src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
}
interface ImportMeta { readonly env: ImportMetaEnv }
```

- [ ] **Step 2: Write the failing test for `can()`**

`can()` is pure, so it is the piece worth unit-testing. It is a **UI convenience only** — it decides whether to show a disabled control. The real enforcement is RLS, verified in Task 14.

Create `src/lib/__tests__/profile.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { can } from '../profile'

describe('can', () => {
  it('lets inspectors and admins write state', () => {
    expect(can('inspector', 'write_state')).toBe(true)
    expect(can('admin', 'write_state')).toBe(true)
  })
  it('does not let viewers write state', () => {
    expect(can('viewer', 'write_state')).toBe(false)
  })
  it('lets only admins write the catalog', () => {
    expect(can('admin', 'write_catalog')).toBe(true)
    expect(can('inspector', 'write_catalog')).toBe(false)
  })
  it('lets every role comment', () => {
    expect(can('viewer', 'comment')).toBe(true)
    expect(can('inspector', 'comment')).toBe(true)
    expect(can('admin', 'comment')).toBe(true)
  })
  it('denies everything without a role', () => {
    expect(can(null, 'write_state')).toBe(false)
    expect(can(null, 'comment')).toBe(false)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- profile`
Expected: FAIL — `Failed to resolve import "../profile"`.

- [ ] **Step 4a: Write the failing test for the service_role key guard**

`assertNotServiceRole` is pure (env-access happens at the call site, not inside
the function), so it is directly unit-testable. Create
`src/lib/__tests__/keyGuard.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { assertNotServiceRole } from '../keyGuard'

const jwt = (claims: object) => {
  const b64 = (o: object) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`
}

describe('assertNotServiceRole', () => {
  it('throws in prod for a service_role key, mentioning the anon key', () => {
    const key = jwt({ role: 'service_role' })
    expect(() => assertNotServiceRole(key, true)).toThrow(/anon/i)
  })

  it('returns a warning message (does not throw) in dev for a service_role key', () => {
    const key = jwt({ role: 'service_role' })
    expect(assertNotServiceRole(key, false)).toMatch(/service_role/i)
  })

  it('returns null for an anon-role key in dev and prod', () => {
    const key = jwt({ role: 'anon' })
    expect(assertNotServiceRole(key, false)).toBeNull()
    expect(assertNotServiceRole(key, true)).toBeNull()
  })

  it('returns null for a non-JWT publishable key', () => {
    expect(assertNotServiceRole('sb_publishable_abc123', true)).toBeNull()
  })

  it('returns null for malformed keys instead of throwing', () => {
    expect(assertNotServiceRole('not.a.jwt', true)).toBeNull()
    expect(assertNotServiceRole('a.!!!not-base64!!!.c', true)).toBeNull()
  })

  it('returns null for a JWT with no role claim', () => {
    const key = jwt({ sub: 'user123' })
    expect(assertNotServiceRole(key, true)).toBeNull()
  })
})
```

Run: `npm test -- keyGuard`
Expected: FAIL — `Failed to resolve import "../keyGuard"`.

- [ ] **Step 4b: Create `src/lib/keyGuard.ts`**

```ts
/**
 * Guards against shipping a Supabase service_role key to the browser. That key
 * bypasses row-level security entirely, and this project's database is shared
 * with an unrelated application, so a published bundle carrying one would expose
 * every table in the project.
 *
 * Pure by design: `isProd` is passed in rather than read from import.meta.env,
 * so the behaviour is directly testable.
 *
 * @returns a warning message when the key is a service_role key in development,
 *          or null when the key is acceptable.
 * @throws  when the key is a service_role key and `isProd` is true.
 */
export function assertNotServiceRole(key: string, isProd: boolean): string | null {
  if (roleFromJwt(key) !== 'service_role') return null

  const msg =
    'VITE_SUPABASE_ANON_KEY is a service_role key. Use the anon/public key - ' +
    'the service key bypasses row-level security and must never reach a browser.'
  if (isProd) throw new Error(msg)
  return msg
}

/** The `role` claim of a JWT, or null for a non-JWT or unparseable key. */
function roleFromJwt(key: string): string | null {
  const parts = key.split('.')
  if (parts.length !== 3) return null      // sb_publishable_... style key
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const claims = JSON.parse(atob(padded))
    return typeof claims.role === 'string' ? claims.role : null
  } catch {
    return null
  }
}
```

Run: `npm test -- keyGuard`
Expected: PASS.

- [ ] **Step 4c: Create `src/lib/supabase.ts`**

```ts
import { createClient } from '@supabase/supabase-js'
import { assertNotServiceRole } from './keyGuard'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill it in.'
  )
}

// Fatal in a production build, which is what gets published. In dev it is only a
// warning, so local work can continue while the key is being sorted out - but
// note RLS is NOT being exercised honestly while a service_role key is in use.
const keyWarning = assertNotServiceRole(key, import.meta.env.PROD)
if (keyWarning) console.error('[ehs] ' + keyWarning)

export const supabase = createClient(url, key, {
  db: { schema: 'ehs' },   // this project's public schema belongs to another app
  auth: { persistSession: true, autoRefreshToken: true },
})

let sessionPromise: Promise<string> | null = null

/**
 * Returns the anonymous user id, creating a session on first run.
 * The in-flight promise is shared so concurrent callers on a cold start do not
 * each trigger a separate anonymous sign-in.
 */
export function ensureSession(): Promise<string> {
  if (!sessionPromise) {
    sessionPromise = bootstrapSession().finally(() => { sessionPromise = null })
  }
  return sessionPromise
}

// getSession() in supabase-js v2 refreshes an expired session itself and returns
// null if the refresh token has been revoked, so a revoked session falls through
// to a fresh anonymous sign-in below.
async function bootstrapSession(): Promise<string> {
  const { data: existing } = await supabase.auth.getSession()
  if (existing.session?.user) return existing.session.user.id

  const { data, error } = await supabase.auth.signInAnonymously()
  if (error) throw error
  return data.user!.id
}
```

- [ ] **Step 5: Create `src/lib/profile.ts`**

```ts
import { supabase } from './supabase'

export type Role = 'admin' | 'inspector' | 'viewer'

export interface Profile {
  id: string
  display_name: string
  role: Role
}

export type Action = 'write_state' | 'write_catalog' | 'comment'

/**
 * UI convenience only. The authoritative check is the RLS policy in
 * db/0003_rls.sql — never rely on this for security.
 */
export function can(role: Role | null, action: Action): boolean {
  if (!role) return false
  switch (action) {
    case 'write_state':   return role === 'inspector' || role === 'admin'
    case 'write_catalog': return role === 'admin'
    case 'comment':       return true
  }
}

const PROFILE_CACHE_KEY = 'ehs-profile-v1'

/**
 * The last known profile, cached so the app opens offline. Role here is a UI
 * convenience only - the server re-checks every request against RLS, so a
 * tampered cache grants nothing.
 */
export function cachedProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    return p && typeof p.id === 'string' && typeof p.display_name === 'string'
      && (p.role === 'admin' || p.role === 'inspector' || p.role === 'viewer')
      ? p as Profile
      : null
  } catch {
    return null
  }
}

export function cacheProfile(p: Profile | null): void {
  try {
    if (p) localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(p))
    else localStorage.removeItem(PROFILE_CACHE_KEY)
  } catch { /* private mode or quota: the app still works, just re-prompts */ }
}

export async function fetchProfile(): Promise<Profile | null> {
  const { data: session } = await supabase.auth.getSession()
  const uid = session.session?.user?.id
  if (!uid) {
    cacheProfile(null)
    return null
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, role')
    .eq('id', uid)
    .maybeSingle()

  if (error) throw error
  const result = (data as Profile) ?? null
  cacheProfile(result)
  return result
}

export async function redeemCode(code: string, displayName: string): Promise<Role> {
  const { data, error } = await supabase.rpc('redeem_access_code', {
    p_code: code.trim(),
    p_display_name: displayName.trim(),
  })
  if (error) throw new Error(error.message)
  if (data === 'invalid_code') throw new Error('That access code is not recognised.')
  if (data === 'rate_limited') throw new Error('Too many attempts. Wait 15 minutes and try again.')
  if (data === 'admin' || data === 'inspector' || data === 'viewer') return data
  throw new Error('Unexpected response from the server. Try again.')
}
```

- [ ] **Step 6: Run tests**

Run: `npm test -- profile`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add supabase client, anonymous session and profile helpers"
```

---

### Task 7: Gate screen

**Files:**
- Create: `src/components/Gate.tsx`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: `ensureSession`, `fetchProfile`, `redeemCode`, `Profile` from Task 6
- Produces: `<Gate>{(profile) => ReactNode}</Gate>` — renders children only once a profile exists

- [ ] **Step 1: Create `src/components/Gate.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { ensureSession } from '../lib/supabase'
import { cachedProfile, cacheProfile, fetchProfile, redeemCode, type Profile } from '../lib/profile'

export function Gate({ children }: { children: (profile: Profile) => React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [booting, setBooting] = useState(true)
  const [offline, setOffline] = useState(false)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)

  const boot = useCallback(async () => {
    setOffline(false)
    const cached = cachedProfile()
    if (cached) {
      setProfile(cached)
      setBooting(false)
    } else {
      setBooting(true)
    }

    try {
      await ensureSession()
      const fresh = await fetchProfile()
      if (fresh) {
        setProfile(fresh)
      } else {
        // Authoritative: server says no profile. Clear any stale cache.
        cacheProfile(null)
        setProfile(null)
      }
      setError('')
    } catch (e) {
      if (!cached) {
        setOffline(true)
        setError(e instanceof Error ? e.message : 'Could not reach the server.')
      }
      // If we have a cached profile, keep showing the app - the refresh
      // failed but there's nothing to correct for yet.
    } finally {
      setBooting(false)
    }
  }, [])

  useEffect(() => {
    boot()
  }, [boot])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting.current) return
    submitting.current = true
    setError('')
    setBusy(true)
    try {
      await redeemCode(code, name)
      setProfile(await fetchProfile())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify that code.')
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  if (booting) return <div className="gate"><p>Starting…</p></div>
  if (profile) return <>{children(profile)}</>

  if (offline) {
    return (
      <div className="gate">
        <div className="gate-card">
          <div className="brand-mark">EHS</div>
          <h1>Auction Inspector</h1>
          <p className="gate-error" role="alert">
            Can't reach the server. Check your connection and try again.
          </p>
          <button className="primary wide" onClick={() => boot()}>Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <div className="brand-mark">EHS</div>
        <h1>Auction Inspector</h1>
        <p className="muted">Enter the access code your team lead gave you.</p>

        <label>Access code
          <input value={code} onChange={e => setCode(e.target.value)}
                 autoComplete="off" autoCapitalize="none" autoCorrect="off"
                 spellCheck={false} required />
        </label>

        <label>Your name
          <input value={name} onChange={e => setName(e.target.value)}
                 placeholder="e.g. Rakesh S." maxLength={60} required />
        </label>

        {error && <p className="gate-error" role="alert">{error}</p>}

        <button className="primary wide" disabled={busy || !code.trim() || !name.trim()}>
          {busy ? 'Checking…' : 'Enter'}
        </button>
        <small className="muted">Your code decides what you can do. Inspectors record
          findings; viewers read and comment.</small>
      </form>
    </div>
  )
}
```

There is no role dropdown. The code determines the role server-side — that is the whole point of Task 4.

The gate must not block on the network. It renders from `cachedProfile()` first
and refreshes in the background, so an inspector who redeemed a code yesterday
gets straight in with no signal. A genuine connection failure shows a distinct
retry screen, never the code form — otherwise a dead spot looks like a rejected
code. The cached role is a UI convenience only; RLS re-checks every request.

- [ ] **Step 2: Wrap the app in `src/main.tsx`**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { Gate } from './components/Gate'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Gate>{profile => <App profile={profile} />}</Gate>
  </React.StrictMode>
)
```

Keep any existing service-worker registration in `main.tsx` exactly as it is.

- [ ] **Step 3: Accept the prop in `App.tsx`**

```tsx
import type { Profile } from './lib/profile'

function App({ profile }: { profile: Profile }) {
```

- [ ] **Step 4: Add gate styles to `src/styles.css`**

```css
.gate { min-height: 100dvh; display: grid; place-items: center; padding: 24px; }
.gate-card { width: min(380px, 100%); display: grid; gap: 14px; padding: 28px;
  border-radius: 16px; background: #fff; box-shadow: 0 10px 40px rgba(0,0,0,.12); }
.gate-card h1 { margin: 0; font-size: 22px; }
.gate-card label { display: grid; gap: 6px; font-size: 13px; font-weight: 600; }
.gate-card input { padding: 11px 12px; border: 1px solid #d6dae2; border-radius: 9px;
  font-size: 16px; }
.gate-error { margin: 0; color: #b42318; font-size: 13px; }
```

`font-size: 16px` on the inputs is deliberate: iOS Safari zooms the viewport on focus for anything smaller, which is disorienting on a phone in the field.

- [ ] **Step 5: Verify manually**

Fill `.env` with your real values, then `npm run dev`. Expected: the gate appears; a wrong code shows "That access code is not recognised."; the inspector code lets you through to the app.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add access code gate screen"
```

---

### Task 8: IndexedDB store and outbox

The heart of local-first. Fully testable without a network.

**Files:**
- Create: `src/lib/db.ts`, `src/lib/__tests__/db.test.ts`

**Interfaces:**
- Consumes: `MachineState` from `src/types.ts`
- Produces:
  - `type FieldGroup = 'inspection' | 'commercial' | 'decision'`
  - `interface OutboxEntry { lot: number; group: FieldGroup; payload: unknown; updatedAt: string }`
  - `getState(lot): Promise<MachineState | null>` / `putState(lot, state): Promise<void>`
  - `getAllStates(): Promise<Record<number, MachineState>>`
  - `enqueue(entry: OutboxEntry): Promise<void>` — collapses to one entry per `(lot, group)`
  - `listOutbox(): Promise<OutboxEntry[]>` / `dequeue(lot, group, updatedAt): Promise<void>`
  - `isDirty(lot, group): Promise<boolean>`
  - `putPhotoBlob(id, blob)` / `getPhotoBlob(id)` / `deletePhotoBlob(id)` / `listPendingPhotos()`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/db.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { blankState } from '../calc'
import {
  clearAll, getState, putState, getAllStates,
  enqueue, listOutbox, dequeue, isDirty,
} from '../db'

beforeEach(async () => { await clearAll() })

describe('state cache', () => {
  it('returns null for an unknown lot', async () => {
    expect(await getState(999)).toBeNull()
  })

  it('round-trips a state', async () => {
    const s = blankState()
    s.inspection.notes = 'hydraulic weep at boom pivot'
    await putState(412, s)
    expect((await getState(412))?.inspection.notes).toBe('hydraulic weep at boom pivot')
  })

  it('returns every cached state keyed by lot', async () => {
    await putState(1, blankState())
    await putState(2, blankState())
    expect(Object.keys(await getAllStates()).sort()).toEqual(['1', '2'])
  })
})

describe('outbox', () => {
  const entry = (lot: number, group: any, updatedAt: string, payload: any = {}) =>
    ({ lot, group, payload, updatedAt })

  it('starts empty', async () => {
    expect(await listOutbox()).toEqual([])
  })

  it('queues an entry', async () => {
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:00.000Z'))
    expect(await listOutbox()).toHaveLength(1)
  })

  it('collapses repeated edits to the same lot and group', async () => {
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:00.000Z', { n: 1 }))
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:05.000Z', { n: 2 }))
    const out = await listOutbox()
    expect(out).toHaveLength(1)
    expect((out[0].payload as any).n).toBe(2)
  })

  it('keeps different field groups on the same lot separate', async () => {
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:00.000Z'))
    await enqueue(entry(412, 'commercial', '2026-09-07T10:00:01.000Z'))
    expect(await listOutbox()).toHaveLength(2)
  })

  it('never replaces a newer queued edit with an older one', async () => {
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:05.000Z', { n: 'new' }))
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:00.000Z', { n: 'old' }))
    expect(((await listOutbox())[0].payload as any).n).toBe('new')
  })

  it('reports dirty state per lot and group', async () => {
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:00.000Z'))
    expect(await isDirty(412, 'inspection')).toBe(true)
    expect(await isDirty(412, 'commercial')).toBe(false)
    expect(await isDirty(999, 'inspection')).toBe(false)
  })

  it('dequeues only when the timestamp still matches', async () => {
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:00.000Z'))
    await dequeue(412, 'inspection', '2026-09-07T10:00:05.000Z')
    expect(await listOutbox()).toHaveLength(1)
    await dequeue(412, 'inspection', '2026-09-07T10:00:00.000Z')
    expect(await listOutbox()).toHaveLength(0)
  })

  it('keeps an edit made while its push was in flight', async () => {
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:00.000Z'))
    // user edits again mid-flight
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:09.000Z'))
    // the in-flight push completes and tries to clear the old version
    await dequeue(412, 'inspection', '2026-09-07T10:00:00.000Z')
    expect(await listOutbox()).toHaveLength(1)
  })
})
```

That last test is the one that matters most. Without the timestamp check in `dequeue`, a successful push silently discards whatever the inspector typed while it was in flight.

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- db`
Expected: FAIL — `Failed to resolve import "../db"`.

- [ ] **Step 3: Create `src/lib/db.ts`**

```ts
import { get, set, del, keys, createStore } from 'idb-keyval'
import type { MachineState } from '../types'

// Each store gets its own IndexedDB database. idb-keyval's createStore opens
// its db without a version bump, so multiple stores sharing one db name only
// ever get the first store created (the others silently 404 on later opens).
const stateStore  = createStore('ehs-inspector-states', 'states')
const outboxStore = createStore('ehs-inspector-outbox', 'outbox')
const photoStore  = createStore('ehs-inspector-photos', 'photos')

export type FieldGroup = 'inspection' | 'commercial' | 'decision'

export interface OutboxEntry {
  lot: number
  group: FieldGroup
  payload: unknown
  // Must be `new Date().toISOString()` output - UTC with a `Z` suffix and
  // millisecond precision. Collapsing and dequeue-guard logic below compares
  // these values lexicographically; a local-offset timestamp would sort
  // wrongly. On an exact tie the newer entry intentionally wins (the guard
  // is `>`, not `>=`) - a same-millisecond re-edit should overwrite.
  updatedAt: string   // ISO 8601
}

const outboxKey = (lot: number, group: FieldGroup) => `${lot}:${group}`

type StorageErrorListener = (message: string) => void
const storageErrorListeners = new Set<StorageErrorListener>()

/**
 * Storage failures are not recoverable in place - quota exceeded, private
 * browsing, a blocked upgrade - but the user must be told, because the
 * local copy is the source of truth and a silent failure loses their work.
 */
export function onStorageError(fn: StorageErrorListener): () => void {
  storageErrorListeners.add(fn)
  return () => { storageErrorListeners.delete(fn) }
}

function reportStorageError(op: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err)
  const message =
    detail.toLowerCase().includes('quota')
      ? 'Device storage is full. Export your session and clear photos to continue saving.'
      : `Could not save to this device (${op}). Your last change may not be stored.`
  storageErrorListeners.forEach(fn => fn(message))
}

export async function getState(lot: number): Promise<MachineState | null> {
  try {
    return (await get<MachineState>(String(lot), stateStore)) ?? null
  } catch (err) {
    reportStorageError('getState', err)
    return null
  }
}

export async function putState(lot: number, state: MachineState): Promise<void> {
  try {
    await set(String(lot), state, stateStore)
  } catch (err) {
    reportStorageError('putState', err)
    throw err
  }
}

export async function getAllStates(): Promise<Record<number, MachineState>> {
  try {
    const all: Record<number, MachineState> = {}
    for (const k of await keys(stateStore)) {
      const s = await get<MachineState>(k as string, stateStore)
      if (s) all[Number(k)] = s
    }
    return all
  } catch (err) {
    reportStorageError('getAllStates', err)
    return {}
  }
}

export async function enqueue(entry: OutboxEntry): Promise<void> {
  try {
    const key = outboxKey(entry.lot, entry.group)
    const existing = await get<OutboxEntry>(key, outboxStore)
    // Collapse to the newest edit. An out-of-order enqueue must not win.
    if (existing && existing.updatedAt > entry.updatedAt) return
    await set(key, entry, outboxStore)
  } catch (err) {
    reportStorageError('enqueue', err)
    throw err
  }
}

export async function listOutbox(): Promise<OutboxEntry[]> {
  try {
    const out: OutboxEntry[] = []
    for (const k of await keys(outboxStore)) {
      const e = await get<OutboxEntry>(k as string, outboxStore)
      if (e) out.push(e)
    }
    return out.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
  } catch (err) {
    reportStorageError('listOutbox', err)
    return []
  }
}

/** Clears the entry only if it has not been superseded by a newer edit. */
export async function dequeue(lot: number, group: FieldGroup, updatedAt: string): Promise<void> {
  try {
    const key = outboxKey(lot, group)
    const existing = await get<OutboxEntry>(key, outboxStore)
    if (existing && existing.updatedAt === updatedAt) await del(key, outboxStore)
  } catch (err) {
    reportStorageError('dequeue', err)
    throw err
  }
}

export async function isDirty(lot: number, group: FieldGroup): Promise<boolean> {
  try {
    return (await get<OutboxEntry>(outboxKey(lot, group), outboxStore)) !== undefined
  } catch (err) {
    reportStorageError('isDirty', err)
    return false
  }
}

export async function putPhotoBlob(id: string, blob: Blob): Promise<void> {
  try {
    await set(id, blob, photoStore)
  } catch (err) {
    reportStorageError('putPhotoBlob', err)
    throw err
  }
}
export async function getPhotoBlob(id: string): Promise<Blob | null> {
  try {
    return (await get<Blob>(id, photoStore)) ?? null
  } catch (err) {
    reportStorageError('getPhotoBlob', err)
    return null
  }
}
export async function deletePhotoBlob(id: string): Promise<void> {
  try {
    await del(id, photoStore)
  } catch (err) {
    reportStorageError('deletePhotoBlob', err)
    throw err
  }
}
export async function listPendingPhotos(): Promise<string[]> {
  try {
    return (await keys(photoStore)).map(String)
  } catch (err) {
    reportStorageError('listPendingPhotos', err)
    return []
  }
}

/** Test helper. Also used by the "reset this device" action in Settings. */
export async function clearAll(): Promise<void> {
  for (const store of [stateStore, outboxStore, photoStore]) {
    for (const k of await keys(store)) await del(k as string, store)
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- db`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add IndexedDB state cache and outbox queue"
```

---

### Task 9: Sync worker

**Files:**
- Create: `src/lib/sync.ts`, `src/lib/__tests__/sync.test.ts`

**Interfaces:**
- Consumes: `supabase` (Task 6), `db.ts` (Task 8)
- Produces:
  - `type SyncStatus = 'synced' | 'pending' | 'offline' | 'error'`
  - `interface SyncSnapshot { status: SyncStatus; pending: number; lastSyncedAt: string | null }`
  - `drainOutbox(): Promise<{ pushed: number; failed: number }>`
  - `pullAll(): Promise<Record<number, MachineState>>`
  - `startSync(onRemoteState: (lot: number, state: MachineState) => void): () => void`
  - `subscribeStatus(fn: (s: SyncSnapshot) => void): () => void`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/sync.test.ts`. The Supabase client is mocked so the retry and ordering logic is tested without a network.

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('../supabase', () => ({
  supabase: {
    rpc,
    from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: vi.fn(),
  },
  ensureSession: vi.fn(async () => 'uid-1'),
}))

import { clearAll, enqueue, listOutbox } from '../db'
import { drainOutbox } from '../sync'

beforeEach(async () => { await clearAll(); rpc.mockReset() })

const entry = (lot: number, group: any, updatedAt: string) =>
  ({ lot, group, payload: {}, updatedAt })

describe('drainOutbox', () => {
  it('does nothing when the outbox is empty', async () => {
    expect(await drainOutbox()).toEqual({ pushed: 0, failed: 0 })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('pushes each queued entry once and clears it', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:00.000Z'))
    await enqueue(entry(413, 'commercial', '2026-09-07T10:00:01.000Z'))

    expect(await drainOutbox()).toEqual({ pushed: 2, failed: 0 })
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(await listOutbox()).toHaveLength(0)
  })

  it('calls sync_machine_state with the field group and client timestamp', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:00.000Z'))
    await drainOutbox()

    expect(rpc).toHaveBeenCalledWith('sync_machine_state', {
      p_lot: 412,
      p_group: 'inspection',
      p_payload: {},
      p_client_updated_at: '2026-09-07T10:00:00.000Z',
    })
  })

  it('keeps an entry queued when the push errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'network down' } })
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:00.000Z'))

    expect(await drainOutbox()).toEqual({ pushed: 0, failed: 1 })
    expect(await listOutbox()).toHaveLength(1)
  })

  it('clears the entry even when the server rejects the write as stale', async () => {
    // false means "a newer value already won" — retrying forever would be futile.
    rpc.mockResolvedValue({ data: false, error: null })
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:00.000Z'))

    expect(await drainOutbox()).toEqual({ pushed: 1, failed: 0 })
    expect(await listOutbox()).toHaveLength(0)
  })

  it('is safe to call twice with no double-push', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    await enqueue(entry(412, 'inspection', '2026-09-07T10:00:00.000Z'))
    await drainOutbox()
    await drainOutbox()
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- sync`
Expected: FAIL — `Failed to resolve import "../sync"`.

- [ ] **Step 3: Create `src/lib/sync.ts`**

```ts
import { supabase } from './supabase'
import { dequeue, listOutbox, putState, type FieldGroup } from './db'
import { blankState } from './calc'
import type { MachineState } from '../types'

export type SyncStatus = 'synced' | 'pending' | 'offline' | 'error'

export interface SyncSnapshot {
  status: SyncStatus
  pending: number
  lastSyncedAt: string | null
}

let snapshot: SyncSnapshot = { status: 'synced', pending: 0, lastSyncedAt: null }
const listeners = new Set<(s: SyncSnapshot) => void>()
let draining = false

export function subscribeStatus(fn: (s: SyncSnapshot) => void): () => void {
  listeners.add(fn)
  fn(snapshot)
  return () => { listeners.delete(fn) }
}

function emit(patch: Partial<SyncSnapshot>) {
  snapshot = { ...snapshot, ...patch }
  listeners.forEach(fn => fn(snapshot))
}

export async function refreshPending(): Promise<void> {
  const pending = (await listOutbox()).length
  const status: SyncStatus = !navigator.onLine ? 'offline' : pending ? 'pending' : 'synced'
  emit({ pending, status })
}

/** Pushes every queued field-group. Safe to call repeatedly. */
export async function drainOutbox(): Promise<{ pushed: number; failed: number }> {
  if (draining) return { pushed: 0, failed: 0 }
  draining = true
  let pushed = 0, failed = 0

  try {
    // Re-check after each pass: edits made while a push was in flight would
    // otherwise wait for the next interval tick, and the badge would read
    // "synced" while an entry was still queued.
    for (;;) {
      const batch = await listOutbox()
      if (batch.length === 0) break
      let progressed = false

      for (const e of batch) {
        const { data, error } = await supabase.rpc('sync_machine_state', {
          p_lot: e.lot,
          p_group: e.group,
          p_payload: e.payload,
          p_client_updated_at: e.updatedAt,
        })

        if (error) { failed++; continue }   // stays queued, retried later
        // data === false means the server already holds a newer value.
        // Our copy is stale; clearing it is correct, retrying is not.
        await dequeue(e.lot, e.group as FieldGroup, e.updatedAt)
        pushed++
        progressed = true
        void data
      }

      if (!progressed) break   // every remaining entry failed; retry later
    }
  } finally {
    draining = false
  }

  await refreshPending()
  if (pushed && !failed) emit({ lastSyncedAt: new Date().toISOString() })
  if (failed) emit({ status: navigator.onLine ? 'error' : 'offline' })
  return { pushed, failed }
}

// The server stores {} for untouched lots' inspection/commercial columns, so
// defaults must be merged in here rather than left to every consumer - a
// shallow merge downstream (`{ ...blankState(), ...pulled }`) would replace
// the whole default inspection object and drop `scores`/`critical`.
function rowToState(row: any): MachineState {
  const base = blankState()
  return {
    inspection: { ...base.inspection, ...(row.inspection ?? {}) },
    commercial: { ...base.commercial, ...(row.commercial ?? {}) },
    decision:   row.decision  ?? base.decision,
    shortlist:  row.shortlist ?? base.shortlist,
  }
}

export async function pullAll(): Promise<Record<number, MachineState>> {
  const { data, error } = await supabase.from('machine_states').select('*')
  if (error) throw error
  const out: Record<number, MachineState> = {}
  for (const row of data ?? []) out[row.lot] = rowToState(row)
  return out
}

/**
 * Starts background sync: drains on reconnect and on an interval, and applies
 * inbound realtime rows. Returns a cleanup function.
 */
export function startSync(onRemoteState: (lot: number, state: MachineState) => void): () => void {
  const online  = () => { void refreshPending().then(() => drainOutbox()) }
  const offline = () => emit({ status: 'offline' })

  window.addEventListener('online', online)
  window.addEventListener('offline', offline)

  const timer = window.setInterval(() => { if (navigator.onLine) void drainOutbox() }, 15_000)

  const channel = supabase
    .channel('machine_states_stream')
    .on('postgres_changes',
        { event: '*', schema: 'ehs', table: 'machine_states' },
        async payload => {
          const row: any = payload.new
          if (!row?.lot) return
          // Never overwrite a lot with unsynced local edits - the outbox is the
          // durable record of those, and it survives reloads.
          const groups: FieldGroup[] = ['inspection', 'commercial', 'decision']
          const dirty = await Promise.all(groups.map(g => isDirty(row.lot, g)))
          if (dirty.some(Boolean)) return
          const state = rowToState(row)
          await putState(row.lot, state)
          onRemoteState(row.lot, state)
        })
    .subscribe()

  void refreshPending().then(() => { if (navigator.onLine) return drainOutbox() })

  return () => {
    window.removeEventListener('online', online)
    window.removeEventListener('offline', offline)
    window.clearInterval(timer)
    void supabase.removeChannel(channel)
  }
}
```

The dirty check lives here, not with the caller: the outbox (`isDirty` from `db.ts`) is the durable record of unsynced local edits — it survives reloads, unlike any in-memory flag — and both the cache write (`putState`) and the caller's `onRemoteState` callback must be gated on it. `useMachineState` (Task 10) therefore no longer needs its own dirty check for realtime rows; it only needs one for the initial pull, since that runs before `startSync` is ever wired up.

- [ ] **Step 4: Run tests**

Run: `npm test -- sync`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add background sync worker with outbox drain and realtime pull"
```

---

### Task 10: Local-first state hook and App wiring

Replaces the `useState(loadAll)` + `useEffect(localStorage.setItem)` pair at `src/App.tsx:81` and `:88`.

**Files:**
- Create: `src/hooks/useMachineState.ts`, `src/components/SyncBadge.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `db.ts` (Task 8), `sync.ts` (Task 9), `blankState` (Task 2)
- Note: `pullAll` (Task 9) always returns fully-defaulted `MachineState`s — `inspection`/`commercial` are merged against `blankState()`, so consumers do not need to re-merge defaults. Consumers should also subscribe to `onStorageError` (Task 8) to surface local storage failures (quota exceeded, private browsing, blocked upgrade) to the user, since a failed write is otherwise silent.
- Produces:
  - `useAllMachineStates(canWrite: boolean)` returning
    `{ states: Record<number, MachineState>; ready: boolean; patchState(lot, group, fn): void }`
  - `<SyncBadge />`

- [ ] **Step 1: Create `src/hooks/useMachineState.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MachineState } from '../types'
import { blankState } from '../lib/calc'
import { machines } from '../data'
import { enqueue, getAllStates, isDirty, putState } from '../lib/db'
import { drainOutbox, pullAll, refreshPending, startSync } from '../lib/sync'
import type { FieldGroup } from '../lib/db'

const GROUPS: FieldGroup[] = ['inspection', 'commercial', 'decision']

function seed(partial: Record<number, MachineState>): Record<number, MachineState> {
  return Object.fromEntries(
    machines.map(m => [m.lot, partial[m.lot] ? { ...blankState(), ...partial[m.lot] } : blankState()])
  )
}

export function useAllMachineStates(canWrite: boolean) {
  const [states, setStates] = useState<Record<number, MachineState>>(() => seed({}))
  const [ready, setReady] = useState(false)
  const statesRef = useRef(states)
  useEffect(() => { statesRef.current = states }, [states])

  // Boot: local cache first (instant, works offline), then the server.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const local = await getAllStates()
      if (!cancelled) { setStates(seed(local)); setReady(true) }
      try {
        const remote = await pullAll()
        if (cancelled) return
        // The outbox is the durable record of unsynced work - an in-memory
        // dirty flag would be empty after a reload, and pulling would then
        // overwrite an inspector's offline edits. Guard every group, not
        // just 'inspection': a dirty commercial or decision edit is just as
        // real, and the server would otherwise clobber it.
        for (const [lotKey, state] of Object.entries(remote)) {
          const lot = Number(lotKey)
          const dirty = await Promise.all(GROUPS.map(g => isDirty(lot, g)))
          if (dirty.some(Boolean)) continue
          await putState(lot, state)
        }
        setStates(seed({ ...(await getAllStates()) }))
      } catch { /* offline: the local cache stands */ }
    })()
    return () => { cancelled = true }
  }, [])

  // Realtime: sync.ts (Task 9) already guards against overwriting a dirty
  // lot before it ever calls this, so it only needs to apply what it's given.
  useEffect(() => startSync((lot, remote) => {
    setStates(prev => ({ ...prev, [lot]: { ...blankState(), ...remote } }))
  }), [])

  const patchState = useCallback((lot: number, group: FieldGroup, fn: (s: MachineState) => MachineState) => {
    if (!canWrite) return
    const updatedAt = new Date().toISOString()
    // Computed from a ref, not inside the setStates updater: React may invoke
    // that updater twice under StrictMode, and putState/enqueue must not fire twice.
    const next = fn(statesRef.current[lot] ?? blankState())
    const payload =
      group === 'inspection' ? next.inspection :
      group === 'commercial' ? next.commercial :
      { decision: next.decision, shortlist: next.shortlist }

    setStates(prev => ({ ...prev, [lot]: next }))

    // Fire-and-forget: the UI must never wait on storage or the network.
    // db.ts reports failures via onStorageError, so these catches only swallow.
    void putState(lot, next).catch(() => {})
    void enqueue({ lot, group, payload, updatedAt })
      .then(() => refreshPending())
      .then(() => { if (navigator.onLine) return drainOutbox() })
      .catch(() => {})
  }, [canWrite])

  return { states, ready, patchState }
}
```

`refreshPending()` runs unconditionally as soon as `enqueue` resolves, before the online check — an offline edit must still update `sync.pending`, or `SignOut`'s guard (Task 11 / `SignOut.tsx`) will read a stale 0 and never arm.

- [ ] **Step 2: Create `src/components/SyncBadge.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { subscribeStatus, type SyncSnapshot } from '../lib/sync'

const LABEL: Record<SyncSnapshot['status'], string> = {
  synced:  'Synced',
  pending: 'Saving',
  offline: 'Offline',
  error:   'Retrying',
}

export function SyncBadge() {
  const [s, setS] = useState<SyncSnapshot>({ status: 'synced', pending: 0, lastSyncedAt: null })
  useEffect(() => subscribeStatus(setS), [])

  return (
    <span className={`sync-badge sync-${s.status}`} title={
      s.lastSyncedAt ? `Last synced ${new Date(s.lastSyncedAt).toLocaleTimeString()}` : 'Not synced yet'
    }>
      <i /> {LABEL[s.status]}{s.pending ? ` ${s.pending}` : ''}
    </span>
  )
}
```

Offline must never look like an error. An inspector seeing a red warning while working normally in a dead spot will stop trusting the app.

- [ ] **Step 3: Add badge styles to `src/styles.css`**

```css
.sync-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 12px;
  font-weight: 600; padding: 4px 9px; border-radius: 999px; background: #eef1f6; color: #45506b; }
.sync-badge i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.sync-synced  { background: #e7f6ec; color: #1a7f43; }
.sync-pending { background: #fff4e0; color: #a4650a; }
.sync-offline { background: #eef1f6; color: #56607a; }
.sync-error   { background: #fdecea; color: #b42318; }
```

- [ ] **Step 4: Rewire `App.tsx`**

Delete the `STORAGE_KEY` constant, `loadAll()`, the `useState(loadAll)` line and the `useEffect` that writes `localStorage`. Replace with:

```tsx
import { useAllMachineStates } from './hooks/useMachineState'
import { SyncBadge } from './components/SyncBadge'
import { can, type Profile } from './lib/profile'

function App({ profile }: { profile: Profile }) {
  const canWrite = can(profile.role, 'write_state')
  const { states, ready, patchState } = useAllMachineStates(canWrite)
  // …existing useState calls for tab, selectedLot, search, category, priority, detailLot
```

Every existing `patchState(lot, s => …)` call site now needs its field group as the second argument:

- shortlist toggles → `patchState(m.lot, 'decision', s => ({ ...s, shortlist: !s.shortlist }))`
- inspection scores, critical gates, inspector, inspectedAt, repairEstimateEur, notes → `'inspection'`
- everything inside `CommercialForm` and the bid-board status dropdown → `'commercial'`
- "Send to bid board" → two calls: `patchState(lot, 'decision', …)` then `patchState(lot, 'commercial', …)` if it touches both

Add a loading guard before the main return:

```tsx
if (!ready) return <div className="gate"><p>Loading inspection data…</p></div>
```

Put the badge and the user's identity in the header, next to the existing Export button:

```tsx
<div className="header-actions">
  <SyncBadge />
  <Badge tone="live">Zevenbergen · 9 Sep</Badge>
  <span className="who" title="Your identity on this device">
    {profile.display_name} · {profile.role}
  </span>
  <button className="ghost" onClick={exportData}>Export</button>
</div>
```

**Viewer banner.** Disabled controls with no explanation read as a broken app, and
someone will waste time at an auction trying to fix it instead of realising they
are on the wrong code. Add above the inspection layout, and again above the bid
board table:

```tsx
{!canWrite && (
  <div className="viewer-note" role="status">
    You are signed in as a <strong>viewer</strong>. You can read everything and
    post comments, but not change inspection data.
  </div>
)}
```

```css
.viewer-note { margin: 0 0 14px; padding: 10px 14px; border-radius: 10px;
  background: #eef3fb; color: #2c4a7c; font-size: 13px; font-weight: 600; }
```

Controls are **disabled, not hidden**, so a viewer in India and an inspector in
Moerdijk see the same screen layout while talking on the phone. The comment
composer stays fully enabled - commenting is the viewer's actual job.

Pass `canWrite` down to `CommercialForm` and add `disabled={!canWrite}` to its inputs, the score buttons, the critical-gate buttons and the bid-board status select, so a viewer sees the data as read-only rather than clicking into a silent rejection.

- [ ] **Step 4b: Sign out (Settings tab)**

Add to `src/components/SignOut.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { cacheProfile } from '../lib/profile'
import { subscribeStatus, type SyncSnapshot } from '../lib/sync'

/**
 * Signing out destroys the anonymous identity permanently - there is no signing
 * back into it, only redeeming a code as a new user. So it is blocked while any
 * edit is still queued: an inspector must never be able to wipe a morning's work
 * with one mistap at a live auction.
 */
export function SignOut() {
  const [sync, setSync] = useState<SyncSnapshot>({ status: 'synced', pending: 0, lastSyncedAt: null })
  useEffect(() => subscribeStatus(setSync), [])

  const blocked = sync.pending > 0

  const signOut = async () => {
    if (blocked) return
    if (!confirm('Sign out of this device? You will need an access code to get back in.')) return
    cacheProfile(null)
    await supabase.auth.signOut()
    location.reload()
  }

  return (
    <div className="panel danger-panel">
      <h3>Sign out</h3>
      <p>Clears your identity on this device. Anyone using it next will need an
         access code. Inspection data already uploaded is not affected.</p>
      {blocked && (
        <p className="muted" role="status">
          {sync.pending} change{sync.pending > 1 ? 's have' : ' has'} not uploaded yet.
          Sign-out is available once everything has synced.
        </p>
      )}
      <button className="danger-button" onClick={signOut} disabled={blocked}>
        {blocked ? 'Waiting for sync…' : 'Sign out'}
      </button>
    </div>
  )
}
```

Mount it in the Settings tab, above the "Reset this device" panel.

- [ ] **Step 5: Update the Settings tab copy and reset action**

Replace the "Static MVP persistence" panel text with the shared model, and point the reset button at IndexedDB:

```tsx
import { clearAll } from './lib/db'

<div className="panel danger-panel"><h3>Reset this device</h3>
  <p>Clears the local cache and any unsent edits on this device. Data already
     synced to the server is not affected.</p>
  <button className="danger-button" onClick={async () => {
    if (confirm('Clear local cache and unsent edits on this device?')) {
      await clearAll(); location.reload()
    }
  }}>Reset local cache</button>
</div>
```

- [ ] **Step 6: Verify**

Run: `npm test && npx tsc --noEmit -p tsconfig.app.json && npm run build`
Expected: all PASS, no type errors.

Then `npm run dev` and check by hand: enter with the **inspector** code, score a section, confirm the badge goes `Saving` → `Synced`. Open the same URL in a second browser with the **viewer** code and confirm the score appears there within a few seconds and the controls are disabled.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: replace localStorage with local-first IndexedDB state and sync"
```

---

### Task 11: Photo capture and upload

**Files:**
- Create: `src/components/Photos.tsx`
- Modify: `src/App.tsx` (inspection tab)

**Interfaces:**
- Consumes: `db.ts` photo helpers (Task 8), `supabase` storage
- Produces: `<Photos lot={number} canWrite={boolean} profileId={string} />`

- [ ] **Step 1: Create `src/components/Photos.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { deletePhotoBlob, getPhotoBlob, listPendingPhotos, putPhotoBlob } from '../lib/db'

interface Shot { id: string; url: string; pending: boolean }

/** Downscale to a long edge of 1600px. Keeps a full-frame shot a few hundred KB. */
function downscale(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = () => {
      const img = new Image()
      img.onerror = reject
      img.onload = () => {
        const max = 1600
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('encode failed')), 'image/jpeg', 0.72)
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

export function Photos({ lot, canWrite, profileId }: { lot: number; canWrite: boolean; profileId: string }) {
  const [shots, setShots] = useState<Shot[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase.from('photos')
      .select('id, storage_path').eq('lot', lot).order('created_at', { ascending: false })

    const uploaded: Shot[] = []
    for (const row of data ?? []) {
      const { data: signed } = await supabase.storage
        .from('inspection-photos').createSignedUrl(row.storage_path, 3600)
      if (signed?.signedUrl) uploaded.push({ id: row.id, url: signed.signedUrl, pending: false })
    }

    const pending: Shot[] = []
    for (const id of await listPendingPhotos()) {
      if (!id.startsWith(`${lot}/`)) continue
      const blob = await getPhotoBlob(id)
      if (blob) pending.push({ id, url: URL.createObjectURL(blob), pending: true })
    }

    setShots([...pending, ...uploaded])
  }, [lot])

  useEffect(() => { void load() }, [load])

  const upload = async (id: string, blob: Blob) => {
    const { error } = await supabase.storage
      .from('inspection-photos').upload(id, blob, { contentType: 'image/jpeg' })
    if (error) return                       // stays pending, retried on next load
    await supabase.from('photos').insert({ lot, storage_path: id, taken_by: profileId })
    await deletePhotoBlob(id)
  }

  const onPick = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    try {
      for (const file of Array.from(files).slice(0, 6)) {
        const blob = await downscale(file)
        const id = `${lot}/${crypto.randomUUID()}.jpg`
        await putPhotoBlob(id, blob)        // survives a crash or signal loss
        await load()                        // show it immediately
        if (navigator.onLine) await upload(id, blob)
      }
      await load()
    } finally {
      setBusy(false)
    }
  }

  // Retry anything left pending whenever the connection returns.
  useEffect(() => {
    const retry = async () => {
      for (const id of await listPendingPhotos()) {
        if (!id.startsWith(`${lot}/`)) continue
        const blob = await getPhotoBlob(id)
        if (blob) await upload(id, blob)
      }
      await load()
    }
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  })

  return (
    <div className="photos">
      {canWrite && (
        <label className="full">Photo evidence
          <input type="file" accept="image/*" capture="environment" multiple
                 disabled={busy} onChange={e => onPick(e.target.files)} />
          <small>Stored on this device immediately, uploaded when there is signal.</small>
        </label>
      )}
      {shots.length > 0 && (
        <div className="photo-grid full">
          {shots.map(s => (
            <figure key={s.id} className={s.pending ? 'pending' : ''}>
              <img src={s.url} alt={`Lot ${lot} inspection`} />
              {s.pending && <figcaption>Waiting to upload</figcaption>}
            </figure>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Use it in the inspection tab of `App.tsx`**

Where the old photo input and grid were (removed in Task 2), add:

```tsx
<Photos lot={selected.lot} canWrite={canWrite} profileId={profile.id} />
```

- [ ] **Step 3: Add styles to `src/styles.css`**

```css
.photo-grid figure { margin: 0; position: relative; }
.photo-grid figure.pending img { opacity: .55; }
.photo-grid figcaption { position: absolute; left: 6px; bottom: 6px; font-size: 11px;
  background: rgba(0,0,0,.65); color: #fff; padding: 2px 6px; border-radius: 5px; }
```

- [ ] **Step 4: Verify by hand**

`npm run dev`, enter as inspector, add a photo. Expected: it appears instantly with "Waiting to upload", then the caption disappears. Confirm the row landed:

```bash
psql "$(scripts/db-url.sh)" -v ON_ERROR_STOP=1 -c "select lot, storage_path, created_at from ehs.photos order by created_at desc limit 5;"
```

Then open DevTools → Network → Offline, add another photo, and confirm it appears as pending and uploads when you go back online.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: upload inspection photos to supabase storage with offline queue"
```

---

### Task 12: Comment threads

**Files:**
- Create: `src/components/Comments.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `supabase`, `Profile`
- Produces: `<Comments lot={number} profile={Profile} />`, `useUnreadCounts(): Record<number, number>`

- [ ] **Step 1: Create `src/components/Comments.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/profile'

interface Comment {
  id: string
  lot: number
  author_id: string | null
  author_name: string
  body: string
  created_at: string
}

export function Comments({ lot, profile }: { lot: number; profile: Profile }) {
  const [items, setItems] = useState<Comment[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase.from('comments')
      .select('*').eq('lot', lot).order('created_at', { ascending: true })
    setItems((data ?? []) as Comment[])
    await supabase.from('comment_reads')
      .upsert({ profile_id: profile.id, lot, last_read_at: new Date().toISOString() })
  }, [lot, profile.id])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const channel = supabase.channel(`comments_${lot}`)
      .on('postgres_changes',
          { event: 'INSERT', schema: 'ehs', table: 'comments', filter: `lot=eq.${lot}` },
          payload => setItems(prev =>
            prev.some(c => c.id === (payload.new as Comment).id)
              ? prev
              : [...prev, payload.new as Comment]))
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [lot])

  const post = async (e: React.FormEvent) => {
    e.preventDefault()
    const body = draft.trim()
    if (!body) return
    setBusy(true)
    const { error } = await supabase.from('comments').insert({
      lot, author_id: profile.id, author_name: profile.display_name, body,
    })
    setBusy(false)
    if (!error) { setDraft(''); await load() }
  }

  return (
    <div className="panel comments">
      <h3>Team comments</h3>
      {items.length === 0 && <p className="muted">No comments on this lot yet.</p>}
      <ul className="comment-list">
        {items.map(c => (
          <li key={c.id}>
            <div className="comment-head">
              <strong>{c.author_name}</strong>
              <time>{new Date(c.created_at).toLocaleString()}</time>
            </div>
            <p>{c.body}</p>
          </li>
        ))}
      </ul>
      <form onSubmit={post} className="comment-form">
        <textarea rows={3} value={draft} maxLength={4000}
                  onChange={e => setDraft(e.target.value)}
                  placeholder="Question or instruction for the inspection team…" />
        <button className="primary" disabled={busy || !draft.trim()}>
          {busy ? 'Posting…' : 'Post comment'}
        </button>
      </form>
    </div>
  )
}

/** Unread comment counts per lot, for the machine-card badge. */
export function useUnreadCounts(profileId: string): Record<number, number> {
  const [counts, setCounts] = useState<Record<number, number>>({})

  useEffect(() => {
    const compute = async () => {
      const [{ data: reads }, { data: comments }] = await Promise.all([
        supabase.from('comment_reads').select('lot, last_read_at').eq('profile_id', profileId),
        supabase.from('comments').select('lot, created_at, author_id'),
      ])
      const readAt = new Map((reads ?? []).map(r => [r.lot, r.last_read_at]))
      const next: Record<number, number> = {}
      for (const c of comments ?? []) {
        if (c.author_id === profileId) continue          // your own aren't unread
        const seen = readAt.get(c.lot)
        if (!seen || c.created_at > seen) next[c.lot] = (next[c.lot] ?? 0) + 1
      }
      setCounts(next)
    }
    void compute()

    const channel = supabase.channel('comments_unread')
      .on('postgres_changes',
          { event: 'INSERT', schema: 'ehs', table: 'comments' },
          () => { void compute() })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [profileId])

  return counts
}
```

The 5-minute edit window from the spec is enforced by the RLS policy but no UI
exposes editing yet — see Out of scope in the spec. Comments post straight
through rather than via the outbox: they carry no merge problem, and a stale comment posted an hour late during a live auction is worse than one that visibly failed.

- [ ] **Step 2: Mount the thread in the inspection tab**

Below the field-notes panel in `App.tsx`:

```tsx
<Comments lot={selected.lot} profile={profile} />
```

- [ ] **Step 3: Show unread counts on machine cards**

In `App`:

```tsx
const unread = useUnreadCounts(profile.id)
```

Pass `unread={unread[m.lot] ?? 0}` into each `<MachineCard>`, and inside `MachineCard` render it in the lot line:

```tsx
{unread > 0 && <span className="unread-dot">{unread}</span>}
```

- [ ] **Step 4: Add styles to `src/styles.css`**

```css
.comment-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.comment-list li { background: #f6f8fb; border-radius: 10px; padding: 10px 12px; }
.comment-head { display: flex; justify-content: space-between; gap: 8px;
  font-size: 12px; color: #5b667f; }
.comment-list p { margin: 5px 0 0; white-space: pre-wrap; }
.comment-form { display: grid; gap: 8px; margin-top: 12px; }
.unread-dot { background: #b42318; color: #fff; border-radius: 999px; font-size: 11px;
  font-weight: 700; padding: 1px 7px; }
```

- [ ] **Step 5: Verify by hand**

Two browsers: inspector in one, viewer in the other, same lot. Post from the viewer. Expected: it appears in the inspector's thread within a second or two without a refresh, and the machine card shows an unread badge until opened.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add per-lot comment threads with realtime and unread counts"
```

---

### Task 13: One-time localStorage migration

**Files:**
- Create: `src/lib/migrate.ts`, `src/lib/__tests__/migrate.test.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `db.ts`, `sync.ts`
- Produces:
  - `readLegacyState(): Record<number, MachineState> | null` — null when there is nothing worth importing
  - `importLegacy(): Promise<number>` — returns the number of lots queued, then marks the import done

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/migrate.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- migrate`
Expected: FAIL — `Failed to resolve import "../migrate"`.

- [ ] **Step 3: Create `src/lib/migrate.ts`**

```ts
import type { MachineState } from '../types'
import { enqueue, putState } from './db'
import { drainOutbox } from './sync'

export const LEGACY_KEY = 'ehs-auction-inspector-state-v1'
export const MIGRATED_KEY = 'ehs-auction-inspector-migrated'

function hasWork(s: MachineState): boolean {
  if (!s) return false
  if (s.shortlist) return true
  if (Object.values(s.inspection?.scores ?? {}).some(v => v > 0)) return true
  if (Object.values(s.inspection?.critical ?? {}).some(v => v !== 'UNSET')) return true
  if ((s.inspection?.notes ?? '').trim()) return true
  if (s.inspection?.repairEstimateEur) return true
  if (s.commercial?.currentBidEur) return true
  if (s.commercial?.estimatedResaleInr) return true
  if (s.commercial?.manualMaxBidEur) return true
  return false
}

/** Lots in the old localStorage blob that hold real work. Null if there are none. */
export function readLegacyState(): Record<number, MachineState> | null {
  if (localStorage.getItem(MIGRATED_KEY)) return null
  const raw = localStorage.getItem(LEGACY_KEY)
  if (!raw) return null

  let parsed: Record<string, MachineState>
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null

  const out: Record<number, MachineState> = {}
  for (const [lot, state] of Object.entries(parsed)) {
    if (hasWork(state)) out[Number(lot)] = state
  }
  return Object.keys(out).length ? out : null
}

/** Queues every legacy lot for sync. Returns how many were imported. */
export async function importLegacy(): Promise<number> {
  const legacy = readLegacyState()
  if (!legacy) { localStorage.setItem(MIGRATED_KEY, new Date().toISOString()); return 0 }

  const updatedAt = new Date().toISOString()
  for (const [lotKey, state] of Object.entries(legacy)) {
    const lot = Number(lotKey)
    await putState(lot, state)
    await enqueue({ lot, group: 'inspection', payload: state.inspection, updatedAt })
    await enqueue({ lot, group: 'commercial', payload: state.commercial, updatedAt })
    await enqueue({ lot, group: 'decision', payload: { decision: state.decision, shortlist: state.shortlist }, updatedAt })
  }

  if (navigator.onLine) await drainOutbox()
  localStorage.setItem(MIGRATED_KEY, new Date().toISOString())
  return Object.keys(legacy).length
}
```

The legacy key is **not deleted**. If the import goes wrong the original data is still on the device, which is worth more than a tidy `localStorage`.

- [ ] **Step 4: Run tests**

Run: `npm test -- migrate`
Expected: PASS, 5 tests.

- [ ] **Step 5: Offer the import in `App.tsx`**

```tsx
import { importLegacy, readLegacyState } from './lib/migrate'

const [legacyCount, setLegacyCount] = useState(() => Object.keys(readLegacyState() ?? {}).length)

{legacyCount > 0 && canWrite && (
  <div className="legacy-banner">
    <span>{legacyCount} lot{legacyCount > 1 ? 's' : ''} of inspection data
      from this device has not been uploaded yet.</span>
    <button className="primary" onClick={async () => {
      await importLegacy(); setLegacyCount(0)
    }}>Upload now</button>
  </div>
)}
```

Place it directly under `<nav className="nav-tabs">`. It is gated on `canWrite` because a viewer cannot write state and the RLS policy would reject the push.

- [ ] **Step 6: Add the banner style**

```css
.legacy-banner { display: flex; gap: 12px; align-items: center; justify-content: space-between;
  flex-wrap: wrap; margin: 12px 16px; padding: 12px 14px; border-radius: 10px;
  background: #fff4e0; color: #7a4b06; font-size: 13px; font-weight: 600; }
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: import legacy localStorage inspection data on first run"
```

---

### Task 14: Scripted RLS verification

RLS bugs fail silently toward *too much* access. This is the only test in the plan that proves the security model actually holds.

**Files:**
- Create: `scripts/check-rls.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: the deployed database and all three access codes
- Produces: `npm run check:rls` — exits non-zero if any assertion fails

- [ ] **Step 1: Create `scripts/check-rls.mjs`**

```js
import { createClient } from '@supabase/supabase-js'

const URL = process.env.VITE_SUPABASE_URL
const KEY = process.env.VITE_SUPABASE_ANON_KEY
const CODES = {
  admin:     process.env.RLS_ADMIN_CODE,
  inspector: process.env.RLS_INSPECTOR_CODE,
  viewer:    process.env.RLS_VIEWER_CODE,
}

if (!URL || !KEY || Object.values(CODES).some(v => !v)) {
  console.error('Set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, RLS_ADMIN_CODE, RLS_INSPECTOR_CODE, RLS_VIEWER_CODE')
  process.exit(2)
}

let failures = 0
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) failures++
}

async function asRole(role) {
  const client = createClient(URL, KEY, {
    db: { schema: 'ehs' }, auth: { persistSession: false },
  })
  const { error: authErr } = await client.auth.signInAnonymously()
  if (authErr) throw authErr
  const { data, error } = await client.rpc('redeem_access_code', {
    p_code: CODES[role], p_display_name: `rls-check-${role}`,
  })
  if (error) throw new Error(`${role} redemption failed: ${error.message}`)
  if (data !== role) throw new Error(`${role} code granted "${data}"`)
  return client
}

const lot = async client =>
  (await client.from('machines').select('lot').limit(1).single()).data.lot

// A device with a session but no redeemed code must see nothing.
{
  const anon = createClient(URL, KEY, {
    db: { schema: 'ehs' }, auth: { persistSession: false },
  })
  await anon.auth.signInAnonymously()
  const { data } = await anon.from('machines').select('lot')
  check('no code: cannot read the catalog', (data ?? []).length === 0)
  const { data: c } = await anon.from('comments').select('id')
  check('no code: cannot read comments', (c ?? []).length === 0)
}

const viewer = await asRole('viewer')
const inspector = await asRole('inspector')
const target = await lot(inspector)

{
  const { data } = await viewer.from('machines').select('lot')
  check('viewer: can read the catalog', (data ?? []).length > 0)

  const { data: applied, error } = await viewer.rpc('sync_machine_state', {
    p_lot: target, p_group: 'commercial',
    p_payload: { currentBidEur: 999999 },
    p_client_updated_at: new Date().toISOString(),
  })
  check('viewer: CANNOT write machine state', error !== null || applied === false)

  const { error: mErr } = await viewer.from('machines').update({ notes: 'x' }).eq('lot', target)
  const { data: after } = await viewer.from('machines').select('notes').eq('lot', target).single()
  check('viewer: CANNOT edit the catalog', mErr !== null || after.notes !== 'x')

  const { error: cErr } = await viewer.from('comments').insert({
    lot: target, author_id: (await viewer.auth.getUser()).data.user.id,
    author_name: 'rls-check-viewer', body: 'viewer comment from the RLS check',
  })
  check('viewer: CAN post a comment', cErr === null)

  const { data: codes } = await viewer.from('access_codes').select('*')
  check('viewer: CANNOT read access codes', (codes ?? []).length === 0)
}

{
  const { data: applied, error } = await inspector.rpc('sync_machine_state', {
    p_lot: target, p_group: 'commercial',
    p_payload: { currentBidEur: 4242 },
    p_client_updated_at: new Date().toISOString(),
  })
  check('inspector: CAN write machine state', error === null && applied === true)

  const { data: stale } = await inspector.rpc('sync_machine_state', {
    p_lot: target, p_group: 'commercial',
    p_payload: { currentBidEur: 1 },
    p_client_updated_at: '2020-01-01T00:00:00.000Z',
  })
  check('inspector: a stale write is rejected', stale === false)

  const { error: mErr } = await inspector.from('machines').update({ notes: 'x' }).eq('lot', target)
  const { data: after } = await inspector.from('machines').select('notes').eq('lot', target).single()
  check('inspector: CANNOT edit the catalog', mErr !== null || after.notes !== 'x')

  const { data: codes } = await inspector.from('access_codes').select('*')
  check('inspector: CANNOT read access codes', (codes ?? []).length === 0)
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll RLS checks passed')
process.exit(failures ? 1 : 0)
```

Note the assertion style: a rejected write is confirmed by **re-reading the row**, not by trusting the absence of an error. Postgres silently reports success for an UPDATE that matched zero rows under RLS, so checking `error === null` alone would pass even when the policy is missing.

- [ ] **Step 2: Add the script to `package.json`**

```json
"check:rls": "node scripts/check-rls.mjs"
```

- [ ] **Step 3: Run it**

```bash
set -a && source .env && set +a
RLS_ADMIN_CODE=... RLS_INSPECTOR_CODE=... RLS_VIEWER_CODE=... npm run check:rls
```

Expected: every line prints `PASS`, exit code 0. Any `FAIL` is a security hole — fix `0003_rls.sql` before continuing.

- [ ] **Step 4: Clean up the check's test rows**

```bash
psql "$(scripts/db-url.sh)" -v ON_ERROR_STOP=1 -c "
delete from ehs.comments where author_name like 'rls-check-%';
delete from ehs.profiles where display_name like 'rls-check-%';"
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: add scripted RLS verification across all three roles"
```

---

### Task 15: Deploy to GitHub Pages

**Files:**
- Create: `.github/workflows/deploy.yml`
- Modify: `vite.config.ts`, `README.md`, `public/sw.js`

**Interfaces:**
- Consumes: repo secrets `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- Produces: a live site on every push to `main`

- [ ] **Step 1: Set the Pages base path in `vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_ACTIONS ? '/ehs-auction-inspector/' : '/',
})
```

Replace `ehs-auction-inspector` with the actual repo name if it differs. A wrong base path produces a blank page with 404s on every asset — the most common Pages failure.

- [ ] **Step 2: Create `.github/workflows/deploy.yml`**

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

`npm test` runs before the build on purpose: a failing calc regression should block the deploy, not ship.

- [ ] **Step 3: Verify the service worker before deploy**

`public/sw.js` was fixed for the cache-first staleness defect: it is now network-first for navigations and same-origin scripts/styles (falling back to cache only when the network fails), uses a versioned cache name (`ehs-auction-inspector-v2`) that the `activate` handler purges old copies of, and is only registered in production (`src/main.tsx` guards registration with `import.meta.env.PROD`, and unregisters any worker a dev session may have installed).

Before this deploy: if the app shell changed (anything in `SHELL` in `public/sw.js`, or the precache list), bump the `CACHE` version string so the new shell is installed cleanly. Confirm the fetch handler still returns early for any request that is not same-origin, so `*.supabase.co` requests are never intercepted, cached, or served from cache — caching an API response would show inspectors stale inspection data with no indication it is old.

- [ ] **Step 4: Create the repo and push**

```bash
gh repo create ehs-auction-inspector --public --source=. --remote=origin --push
```

- [ ] **Step 5: Add the secrets**

```bash
gh secret set VITE_SUPABASE_URL
gh secret set VITE_SUPABASE_ANON_KEY
```

- [ ] **Step 6: Enable Pages**

In the repo: **Settings → Pages → Build and deployment → Source → GitHub Actions**.

- [ ] **Step 7: Verify the deploy**

```bash
gh run watch
```

Expected: both jobs green. Open the published URL on a phone, enter the inspector code, score a lot, and confirm it appears for a second device using the viewer code.

- [ ] **Step 8: Update the README**

Replace the "For a static GitHub Pages build, entered inspection data stays on the browser/device" line and the "Static MVP persistence" claims with the shared model: access codes per role, live sync, offline-first, comments. Add a short **Operations** section covering: rotating a code with `set_access_code`, the eu-central-2 region and shared `ehs` schema, and the free-tier 7-day pause risk before an auction.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: deploy to github pages via actions"
git push
```

---

## Post-implementation checklist

- [ ] `npm test` green
- [ ] `npm run check:rls` — every line PASS
- [ ] Two devices, two different codes, live update confirmed both ways
- [ ] Airplane mode: score a lot, take a photo, reconnect, confirm both sync
- [ ] Viewer role: every write control visibly disabled, comment posting works
- [ ] Legacy `localStorage` data imported and visible on a second device
- [ ] Supabase project un-paused (or on a paid plan) before auction day
