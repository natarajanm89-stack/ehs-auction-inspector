# Shared Persistence, Access Codes and Team Comments

**Date:** 2026-09-07
**Status:** Approved design, ready for implementation planning
**Project:** EHS Auction Inspector

## Problem

The app is a static Vite SPA on GitHub Pages. All state lives in a single
`localStorage` key (`ehs-auction-inspector-state-v1`) on one device. Photos are
base64 strings inside that same key.

This means the team in India cannot see inspection data being entered at the
Ritchie Bros. Zevenbergen / Moerdijk auction, and has no way to respond to it.
The requirement is shared, live inspection data plus a way for India to comment,
with a lightweight gate so only the team can get in.

## Constraints

- Frontend stays a static build on GitHub Pages. No server of ours to run.
- Inspectors work on mobile in an auction yard with unreliable signal. Losing an
  entered inspection is the worst outcome in this design.
- Closed team, roughly 5-15 people, for a two-day event.
- No account management overhead: no email/password, no self-signup, no invites.
- Existing `Machine`, `InspectionState`, `CommercialState`, `MachineState` types
  and the `calc()` / `autoDecision()` logic stay behaviourally unchanged.

## Decisions

| # | Decision | Rejected alternatives |
|---|---|---|
| 1 | Supabase (Postgres + anonymous auth + realtime + storage), frontend stays on GitHub Pages | Render web service + Postgres; Firebase |
| 2 | Access codes, not user accounts. Anonymous Supabase session per device | Email + password accounts; magic link; Google OAuth |
| 3 | Three roles: `admin`, `inspector`, `viewer` | Single role; two roles |
| 4 | One access code **per role**, hashed, verified server-side | One shared code with self-selected role (makes role an honour system, not a boundary) |
| 5 | Local-first: IndexedDB is the working copy, background sync to Supabase | Server-first online-only; server-first with record locking |
| 6 | Conflict resolution is last-write-wins **per field group**, not per record | Whole-record overwrite; CRDT merge (overkill) |
| 7 | Flat comment thread per lot, realtime, append-mostly | Threaded replies; comments anchored to individual fields |
| 8 | Photos to a private Supabase Storage bucket, blobs held in IndexedDB until uploaded | Keep photos local-only; require connection to capture |

## Architecture

```
Phone / laptop (GitHub Pages, static build)
  React app
    |- IndexedDB ......... working copy + photo blobs (source of truth for UI)
    |- outbox queue ...... dirty field-groups awaiting push
    \- sync worker ....... push on reconnect, pull via realtime
                    |
                    v  HTTPS (anon key + anonymous-session JWT)
              Supabase (eu-central-2, schema: ehs)
                |- Auth ......... anonymous sign-in, session persisted per device
                |- Postgres ..... catalog, state, comments - all behind RLS
                |- Realtime ..... state + comment changes pushed to clients
                \- Storage ...... private bucket, inspection photos
```

**Core property:** the UI reads and writes IndexedDB only, never the network.
Sync is a background process. An inspector with no signal has an app that
behaves exactly as it does today, showing "pending" instead of "synced".

**Security rests entirely on Postgres row-level security.** The anon key ships in
the JS bundle and is meant to be public. What a caller can read or write is
decided server-side against their JWT and their `profiles` row.

**Region:** eu-central-2 (Zurich), inherited from the existing project. Inspectors
in the Netherlands take the fast path; India readers absorb a few hundred ms on a
comment thread, which nobody notices. Region cannot be changed after project
creation.

**Schema:** everything lives in a dedicated `ehs` schema. The project
(`zxfyfigmajlvgbddlbbx`, "VanithaHomeKitchen") already hosts an unrelated
application in `public`, which this work must not touch. Two consequences: the
JS client is constructed with `db: { schema: 'ehs' }`, and `ehs` must be added to
the Data API's exposed schemas. The two apps share the project's quotas and its
free-tier pause timer.

## Data model

### `profiles`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | = `auth.uid()` of the anonymous session |
| `display_name` | text | free text, captured at the gate |
| `role` | text | `admin` \| `inspector` \| `viewer`, set only by `redeem_access_code` |
| `created_at` | timestamptz | |

A device with no `profiles` row can read nothing. Default deny.

### `access_codes`
| column | type | notes |
|---|---|---|
| `role` | text PK | one row per role |
| `code_hash` | text | `pgcrypto` hash; plaintext is never stored |
| `updated_at` | timestamptz | |

Not readable by any client role. Only `redeem_access_code` touches it.

### `machines`
One row per lot, mirroring the existing `Machine` TypeScript type: `lot` (int
PK), `year`, `make`, `model`, `title`, `category`, `power`, `hours`, `serial`,
`location`, `image_url`, `source_url`, `features` (text[]), `notes`, `priority`,
`fleet_fit`, `parts_support`, `rental_demand`, `source_verified`.

Seeded once from `src/data.ts`, which then becomes seed-only and is no longer
read at runtime.

### `machine_states`
| column | type | notes |
|---|---|---|
| `lot` | int PK -> `machines(lot)` | |
| `inspection` | jsonb | the existing `InspectionState` shape, minus photos |
| `inspection_updated_at` | timestamptz | |
| `commercial` | jsonb | the existing `CommercialState` shape |
| `commercial_updated_at` | timestamptz | |
| `decision` | text | |
| `shortlist` | boolean | |
| `decision_updated_at` | timestamptz | covers `decision` + `shortlist` |

Three independently versioned field groups: `inspection`, `commercial`,
`decision`. This is what lets an inspector's scores and a bid-status change land
without clobbering each other.

JSONB keeps the existing TypeScript types intact so `calc()` needs no changes.
The accepted cost: no SQL querying inside the inspection detail. Acceptable at
tens of lots, where the app already computes this in memory.

### `photos`
`id` (uuid PK), `lot`, `storage_path`, `caption`, `taken_by` -> `profiles(id)`,
`created_at`. The image itself lives in Storage; the row holds only the path.

### `comments`
`id` (uuid PK), `lot`, `author_id` -> `profiles(id)`, `author_name` (denormalised
so history stays readable if a profile is removed), `body`, `created_at`,
`edited_at`.

### `comment_reads`
`(profile_id, lot)` PK, `last_read_at`. Drives the unread badge on machine cards.

## Sync protocol

All state pushes go through one function:

```
sync_machine_state(lot int, group text, payload jsonb, client_updated_at timestamptz)
```

It writes only if `client_updated_at` is newer than the stored timestamp for
that group. Two consequences that matter:

- **Idempotent.** A retry after a flaky connection cannot corrupt state, so the
  outbox can retry freely without bookkeeping.
- **Field-group granularity.** Concurrent edits to different groups on the same
  lot both survive.

Timestamps are client-supplied, so a badly-skewed device clock could lose a
write. Accepted: the alternative is server ordering, which cannot express
"this offline edit happened first".

Inbound realtime changes are applied to any lot **not currently dirty in the
local outbox**, so an edit in progress is never yanked out from under the
inspector.

Comments write straight through when online (no merge problem, low value when
stale) but queue in the same outbox when offline.

## Access and permissions

`redeem_access_code(code text, display_name text)` runs with elevated privilege,
compares the hash, and on success writes the caller's `profiles` row. It is the
only path to a role. Failures return nothing useful and are rate-limited per
device to prevent grinding short codes.

RLS policies read the caller's role from `profiles`:

| Table | viewer | inspector | admin |
|---|---|---|---|
| `machines` | read | read | read + write |
| `machine_states` | read | read + write | read + write |
| `photos` | read | read + upload, delete own | full |
| `comments` | read + post, edit own <=5 min | same | same + delete any |
| `profiles` | read all, edit own name | same | same + change roles |
| `access_codes` | none | none | none (rotation via admin function only) |

Storage bucket policies mirror the `photos` table. The bucket is private; reads
go through short-lived signed URLs.

Rotating a code invalidates only future redemptions, not existing sessions. To
eject someone mid-auction an admin deletes their `profiles` row, which locks
them out on the next request.

### Accepted limitations

- Anyone with the link and a code is in. No per-person revocation short of
  deleting their profile row.
- Identity is per-device: the same person on phone and laptop is two identities.
- Clearing browser data produces a new identity and a re-prompt for name.
  Existing comments keep their `author_name`.

## Client structure

`App.tsx` is currently 301 lines handling routing, calculation and all five
tabs. This work splits only what it touches:

```
src/
  lib/
    supabase.ts     client + anonymous session bootstrap
    db.ts           IndexedDB: state cache, photo blobs, outbox
    sync.ts         push outbox -> RPC, pull via realtime, online/offline
    calc.ts         calc() + autoDecision(), lifted out of App.tsx unchanged
  components/
    Gate.tsx        access code + name screen
    SyncBadge.tsx   synced / pending N / offline
    Comments.tsx    thread + composer + unread marker
    Photos.tsx      capture, local preview, upload state
  tabs/             Dashboard, Machines, Inspect, BidBoard, Settings
  App.tsx           routing + shell only
```

`useMachineState(lot)` is where local-first lives. Every mutation synchronously
writes IndexedDB, updates React state, and appends the dirty field-group to the
outbox, then returns. Nothing awaits the network.

**Photos:** capture to an IndexedDB blob with an object-URL preview that renders
immediately, downscale to ~1600px JPEG (a few hundred KB), upload when
connected, then swap to a signed URL. This also removes the current
base64-in-localStorage ceiling, which throws quota errors at roughly 15-20
photos.

## Migration

On first successful code redemption, if `ehs-auction-inspector-state-v1` holds
any non-blank state, the app offers to push it to the server rather than
discarding it silently.

## Testing

Vitest over the parts where a bug is expensive and invisible:

- field-group merge rule in `sync_machine_state` (older timestamp must not win)
- outbox draining, retry idempotency, and ordering
- the localStorage migration reader
- `calc()` / `autoDecision()` regression tests, to prove the lift-and-shift out
  of `App.tsx` changed no behaviour

Plus a scripted RLS check that redeems each of the three codes and asserts a
viewer's write is rejected **by the database**. RLS bugs fail silently in the
direction of too much access, so this cannot be left to manual checking.

## Deployment

- GitHub Actions builds on push and publishes to Pages.
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` injected from repo secrets.
  Both are public in the bundle by design.
- The repo must be public, or private with GitHub Pro, for Pages to serve it.
- Cost: $0 on both free tiers at this scale.

### Operational risk

Free-tier Supabase projects pause after 7 days of inactivity and need a manual
un-pause from the dashboard. Given weeks of quiet before a two-day auction, this
is a live risk on the morning of the event. Either un-pause the day before as a
checklist item, or run the paid plan for the auction month.

## Out of scope

- Multi-auction support. Single event; `machines` has no auction FK yet.
- Threaded or field-anchored comments.
- Push notifications for new comments.
- Per-person revocation beyond deleting a profile row.
- Any refactor of `App.tsx` beyond the split described above.
- A UI for editing a comment inside its 5-minute window. The RLS policy allows
  it; no screen exposes it yet.
- An admin screen for changing roles or rotating codes. Both are done through
  SQL against `profiles` and `set_access_code()` for now.
