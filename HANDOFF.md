# Handoff — `feat/shared-persistence`

**Written:** 2026-09-08 · **Branch:** `feat/shared-persistence` (41 commits ahead of `main`)
**State:** 78 tests passing, typecheck clean, build succeeds, working tree clean.
**Not merged, not deployed.**

---

## What changed

The app was a single-device SPA keeping all state in one `localStorage` key. It is now a
shared, offline-first, multi-user workspace on Supabase, still delivered as a static site.

| Capability | Where |
|---|---|
| Shared persistence | Supabase Postgres, `ehs` schema |
| Live updates between devices | Supabase Realtime |
| Access-code login, three roles | `ehs.redeem_access_code`, RLS policies |
| Offline-first editing | IndexedDB + outbox (`src/lib/db.ts`, `src/lib/sync.ts`) |
| Photo evidence | Private Storage bucket, upload queued when offline |
| Per-lot comment threads | `ehs.comments`, realtime, unread badges |
| Recovery of pre-migration data | `src/lib/migrate.ts` |

### Architecture in one paragraph

The UI reads and writes **IndexedDB only and never awaits the network**. Every edit writes
the local cache, updates React state, and appends a dirty *field group* to an outbox — all
synchronously. A background worker drains that outbox through one idempotent RPC and applies
inbound realtime rows. The outbox is the durable record of unsynced work: it survives reloads,
and it is what stops server data overwriting an inspector's edits. Permissions are enforced
entirely by Postgres row-level security; the client is not a security boundary.

### Conflict model

`machine_states` splits into three independently versioned field groups — `inspection`,
`commercial`, `decision` — each with its own timestamp. `ehs.sync_machine_state(lot, group,
payload, client_updated_at)` applies a write only if the incoming timestamp is newer, so the
call is idempotent and two people editing different aspects of one lot do not clobber each
other. Ordering uses the **client** clock, clamped to `now() + 5 min` server-side.

---

## Live database state

Project `zxfyfigmajlvgbddlbbx` ("VanithaHomeKitchen"), region **eu-central-2**.

**This project is shared with unrelated live applications** — 55 tables in `public`
(VanithaHomeKitchen, taalforge, rudhra, cli-memory) plus their storage buckets. Everything
for this app lives in the `ehs` schema and must stay there. Never run `supabase db push`,
`db reset` or `db pull`: the remote carries 21 migrations owned by those other apps.

- 8 tables in `ehs`, 16 RLS policies, 4 functions, 10 machines seeded
- `access_codes` holds 3 bcrypt hashes (cost 12) — admin, inspector, viewer
- Private bucket `inspection-photos`, policies scoped to `bucket_id` so the other apps'
  `lesson-*` buckets are untouched
- Realtime publishes `ehs.machine_states` and `ehs.comments`
- `ehs.profiles` is currently **empty** — all identities were deleted during test cleanup,
  so every device must re-enter its access code

SQL lives in `db/` and is applied with `psql`, never the Supabase CLI:

```bash
psql "$(scripts/db-url.sh)" -v ON_ERROR_STOP=1 -f db/0001_schema.sql
```

---

## Open items

### 1. Blocking deploy — swap the Supabase key

`VITE_SUPABASE_ANON_KEY` in `.env` currently holds the **`service_role`** key.

`VITE_`-prefixed variables are compiled into the JavaScript bundle and served publicly.
`service_role` bypasses row-level security entirely and reaches the whole database —
including the other applications' 55 tables. Publishing it would hand full read/write/delete
access to anyone who opens the site.

**Fix:** Supabase dashboard → Settings → API → copy the **`anon` / `public`** key (or
`sb_publishable_…`) → replace the value in `.env`. Rotate the service key while there.

A guard in `src/lib/keyGuard.ts` **fails the production build** on a service_role key and warns
in dev, so this cannot ship by accident.

### 2. Task 15 — deploy to GitHub Pages (not started)

Full steps are in the plan, Task 15. Summary:

1. `gh repo create ehs-auction-inspector --public --source=. --remote=origin --push`
2. `gh secret set VITE_SUPABASE_URL` and `gh secret set VITE_SUPABASE_ANON_KEY`
3. Settings → Pages → Source → **GitHub Actions**
4. Confirm `base` in `vite.config.ts` matches the repo name, or assets 404

Deploying also gives HTTPS, which is required for the service worker — so genuine offline
behaviour **cannot be tested over the LAN**, only on the deployed URL.

### 3. Not yet exercised by a human

Everything below was reviewed and unit-tested, but no subagent could log in, so it has only
been reasoned about. Confirmed working by hand: **login, and live two-device sync.**

Priority tests on a real phone, in order:

1. **Cold start on throttled data, typing immediately.** Type into Field notes the instant
   the app paints, then reload. Did the text survive?
2. **A photo through a full offline→online cycle**, killing the connection mid-upload. Shoot
   two photos in airplane mode on lot A, reconnect while on lot B, confirm both reach a viewer.
3. **Lock the phone for an hour, reopen, edit.** Tests JWT refresh, realtime resubscribe, and
   whether pre-lock work survives and pushes.

Also untested: comment threads across devices, unread badges, sign-out gating, and the
migration banner.

### 4. Stranded data to recover

Inspection scores for **lot 667 (JLG 600AJ)** were entered in a browser running a stale
cached build and never reached the server. They are most likely still in that browser's
`localStorage` under `ehs-auction-inspector-state-v1`.

Open the app in that browser and look for the amber banner under the tabs — "N lots of
inspection data from this device has not been uploaded yet" — and click **Upload now**.

**Do not run `localStorage.clear()` in that browser.** The migration never deletes the legacy
key, so the data survives a failed import, but clearing it manually destroys it.

### 5. Catalog is 10 machines

`ehs.machines` is seeded from `src/data.ts` — the starter shortlist. If the real Zevenbergen
catalog has more lots, add them to `src/data.ts` and re-seed:

```bash
npx vite-node scripts/gen-seed.mjs
psql "$(scripts/db-url.sh)" -v ON_ERROR_STOP=1 -f db/seed_machines.sql
```

Note `ehs.machines` is written but **not read at runtime** — the client still uses `src/data.ts`
as its catalog. An admin therefore cannot correct a lot's details mid-auction without a redeploy.

---

## Known limitations (accepted, not defects)

- **Shared codes, not accounts.** Anyone with the link and a code is in. No per-person
  revocation short of deleting their `ehs.profiles` row and their `auth.users` row. Rotating a
  code invalidates only future redemptions, not existing sessions.
- **Rate limiting is weak by design.** Anonymous identities are unlimited, so the per-identity
  limit (10 failures / 15 min) is friction, not protection. **Code length is the real defence** —
  keep them 12+ characters and unpredictable.
- **Identity is per-device.** The same person on phone and laptop is two identities. Clearing
  browser data creates a new one.
- **Two inspectors on one lot will clobber each other.** `inspection` is a single last-write-wins
  blob and ordering uses the client clock, so a phone with a slow clock always loses. The
  practical answer is assigning lots to one inspector each.
- **`useUnreadCounts` refetches all comments on every insert.** Fine at this scale; O(n) per client.
- **Offline comments are not queued.** The draft is kept and an error shown, but the comment is
  not retried automatically. The spec originally promised queuing; this is the smaller fix.
- **`pendingPull` (realtime reconciliation) is in-memory** and lost on reload — a reload does a
  full pull anyway.
- **Free-tier Supabase projects pause after 7 days of inactivity.** Given weeks of quiet before
  a two-day auction, **un-pause the project the day before**, or run the paid plan for that month.
  This project's activity is shared with the other apps, which reduces but does not remove the risk.

---

## Operations

**Set or rotate all three access codes** — put `EHS_ADMIN_CODE`, `EHS_INSPECTOR_CODE`,
`EHS_VIEWER_CODE` in `.env`, then:

```bash
scripts/set-access-codes.sh      # trims whitespace, enforces 12 chars, bcrypt cost 12
```

Delete those lines from `.env` afterwards. Only hashes are stored — **a forgotten code cannot be
recovered, only replaced.**

**Rotate one role's code** (reads from a hidden prompt, never enters shell history):

```bash
scripts/set-one-code.sh viewer
```

**Verify the permission model** — set `RLS_ADMIN_CODE`, `RLS_INSPECTOR_CODE`, `RLS_VIEWER_CODE`
in `.env`, then:

```bash
set -a && source .env && set +a && npm run check:rls
```

All 13 checks passed on 2026-09-08. It leaves `rls-check-%` profiles behind; sweep with:

```bash
psql "$(scripts/db-url.sh)" -c "delete from ehs.comments where author_name like 'rls-check-%';
                                delete from ehs.profiles where display_name like 'rls-check-%';"
```

**Revoke one person's access:** delete their `ehs.profiles` row. Their device now recovers
gracefully — `redeemCode` detects the stale session, signs out, and prompts for a code again.

**A device stuck after its identity was deleted** (raw foreign-key error) is now handled in code.
If an older build is cached, clear only the session keys — never all of `localStorage`:

```js
Object.keys(localStorage).filter(k => k.startsWith('sb-')).forEach(k => localStorage.removeItem(k));
localStorage.removeItem('ehs-profile-v1');
location.reload();
```

---

## Gotchas that cost real time here

- **The service worker was cache-first** and pinned a browser to a build from several commits
  earlier — the app appeared to lose data because it was running obsolete code. It is now
  network-first, versioned (`v2`), registered only in production, and excludes Supabase requests.
  If a device ever behaves like an old build, unregister the worker once.
- **`pgcrypto` lives in the `extensions` schema.** Functions pin `search_path = ehs, public,
  extensions`; dropping `extensions` makes `crypt()` unresolvable and breaks every login, while
  still working from `psql` (whose search path is wider).
- **`sync_machine_state` is `SECURITY INVOKER` deliberately** so RLS binds it. Making it DEFINER
  would silently grant every viewer full write access.
- **`ehs.caller_role()` must stay `STABLE`.** The `profiles_update_self` policy prevents
  self-escalation only because a STABLE function returns the pre-update role inside `WITH CHECK`.
- **macOS smart quotes** break `psql` commands pasted into a terminal. Use the scripts.

---

## Reference

- **Spec:** `docs/superpowers/specs/2026-09-07-shared-persistence-design.md`
- **Plan:** `docs/superpowers/plans/2026-09-07-shared-persistence.md` (15 tasks; 14 complete)
- **Progress ledger:** `.superpowers/sdd/progress.md` (gitignored)
- **Per-task reports:** `.superpowers/sdd/task-*-report.md` (gitignored)

Local development:

```bash
npm install
npm run dev        # binds all interfaces; open http://<your-lan-ip>:5173 on a phone
npm test
npm run build
```
