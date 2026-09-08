#!/usr/bin/env node
// Scripted RLS verification.
//
// This is the only automated proof that the Postgres row-level-security
// model actually holds. All enforcement lives in `ehs.*` RLS policies
// (see db/0003_rls.sql) — the client is not a security boundary, and a
// missing policy fails silently in the direction of too much access.
//
// Prerequisite: `ehs.access_codes` must already contain the three live
// codes (admin, inspector, viewer). This script never prints them, or
// any key or connection string.
//
// Usage (supply codes without putting them in shell history):
//   set -a && source .env && set +a
//   read -rs RLS_ADMIN_CODE;     export RLS_ADMIN_CODE
//   read -rs RLS_INSPECTOR_CODE; export RLS_INSPECTOR_CODE
//   read -rs RLS_VIEWER_CODE;    export RLS_VIEWER_CODE
//   npm run check:rls
//
// Each role redemption uses a fresh anonymous auth identity, so a normal
// run should not trip the 10-attempts-per-15-minutes rate limit. If a
// partial run is retried repeatedly against the same identity it can —
// the script reports this plainly (see `redeemedFor`) rather than
// misreporting it as a transport error.
//
// Cleanup: the script deletes the comments and profiles it creates, via
// the API, as the identities that created them. It CANNOT delete the
// anonymous auth.users rows it creates (the anon key has no access to
// auth admin endpoints) — an operator with the service-role key can
// clear them via the Supabase admin API. This script never uses a
// service-role key.

import { createClient } from '@supabase/supabase-js'

const URL = process.env.VITE_SUPABASE_URL
const KEY = process.env.VITE_SUPABASE_ANON_KEY
const CODES = {
  admin: process.env.RLS_ADMIN_CODE,
  inspector: process.env.RLS_INSPECTOR_CODE,
  viewer: process.env.RLS_VIEWER_CODE,
}

if (!URL || !KEY || Object.values(CODES).some(v => !v)) {
  console.error(
    'Set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, RLS_ADMIN_CODE, RLS_INSPECTOR_CODE, RLS_VIEWER_CODE',
  )
  process.exit(2)
}

let failures = 0
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) failures++
}

function newClient() {
  return createClient(URL, KEY, {
    db: { schema: 'ehs' },
    auth: { persistSession: false },
  })
}

// Tracks resources this run created, so we can clean them up at the end
// even if a later assertion throws.
const createdComments = [] // { client, id }
const createdProfiles = [] // { client, uid }  (via redemption)

// Redeems `role`'s code on a brand-new anonymous identity and returns the
// authenticated client. Distinguishes a real transport error from the two
// sentinel strings the RPC can now return instead of raising.
async function asRole(role) {
  const client = newClient()
  const { error: authErr } = await client.auth.signInAnonymously()
  if (authErr) throw new Error(`${role}: could not create anonymous session: ${authErr.message}`)

  const { data, error } = await client.rpc('redeem_access_code', {
    p_code: CODES[role],
    p_display_name: `rls-check-${role}`,
  })
  if (error) throw new Error(`${role}: redemption RPC failed (transport/permission error): ${error.message}`)

  if (data === 'rate_limited') {
    throw new Error(
      `${role}: redemption returned 'rate_limited' — this identity has hit 10 failed attempts ` +
        'in 15 minutes. Wait 15 minutes and re-run, or use a fresh Supabase project for repeated ' +
        'manual testing. This is not a code or transport problem.',
    )
  }
  if (data === 'invalid_code') {
    throw new Error(
      `${role}: redemption returned 'invalid_code' — the RLS_${role.toUpperCase()}_CODE value does ` +
        'not match a live row in ehs.access_codes. (The code itself is never printed.)',
    )
  }
  if (data !== role) {
    throw new Error(`${role}: redemption granted unexpected role "${data}"`)
  }

  const { data: userData } = await client.auth.getUser()
  createdProfiles.push({ client, uid: userData?.user?.id })
  return client
}

const lot = async client =>
  (await client.from('machines').select('lot').limit(1).single()).data.lot

async function main() {
  // --- The most important single assertion: profile self-appointment is
  // blocked. Before the `profiles_insert_self` policy was removed, any
  // authenticated (even anonymous) identity could INSERT into ehs.profiles
  // and choose its own role — including 'admin'. This must be impossible,
  // and confirmed by re-reading (not just trusting the absence of an error).
  {
    const anon = newClient()
    await anon.auth.signInAnonymously()
    const { data: userData } = await anon.auth.getUser()
    const uid = userData?.user?.id

    const { error: insErr } = await anon
      .from('profiles')
      .insert({ id: uid, display_name: 'rls-check-selfappoint', role: 'admin' })
    const { data: row } = await anon.from('profiles').select('id').eq('id', uid).maybeSingle()
    check(
      'no code: CANNOT self-insert an admin profile',
      insErr !== null || row === null,
    )
  }

  // A device with a session but no redeemed code must see nothing.
  {
    const anon = newClient()
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
      p_lot: target,
      p_group: 'commercial',
      p_payload: { currentBidEur: 999999 },
      p_client_updated_at: new Date().toISOString(),
    })
    check('viewer: CANNOT write machine state', error !== null || applied === false)

    const { error: mErr } = await viewer.from('machines').update({ notes: 'x' }).eq('lot', target)
    const { data: after } = await viewer.from('machines').select('notes').eq('lot', target).single()
    check('viewer: CANNOT edit the catalog', mErr !== null || after.notes !== 'x')

    const { data: userData } = await viewer.auth.getUser()
    const { data: inserted, error: cErr } = await viewer
      .from('comments')
      .insert({
        lot: target,
        author_id: userData.user.id,
        author_name: 'rls-check-viewer',
        body: 'viewer comment from the RLS check',
      })
      .select('id')
      .single()
    check('viewer: CAN post a comment', cErr === null)
    if (inserted?.id) createdComments.push({ client: viewer, id: inserted.id })

    // Author-name spoofing: a trigger (comments_stamp_author) must stamp
    // the redeemer's real display name, overriding any client-supplied value.
    const { data: spoofed, error: spoofErr } = await viewer
      .from('comments')
      .insert({
        lot: target,
        author_id: userData.user.id,
        author_name: 'Someone Else',
        body: 'rls-check-viewer spoof attempt',
      })
      .select('id, author_name')
      .single()
    check(
      'viewer: comment author_name is stamped server-side, not spoofable',
      spoofErr === null && spoofed?.author_name === 'rls-check-viewer',
    )
    if (spoofed?.id) createdComments.push({ client: viewer, id: spoofed.id })

    const { data: codes } = await viewer.from('access_codes').select('*')
    check('viewer: CANNOT read access codes', (codes ?? []).length === 0)
  }

  {
    const { data: applied, error } = await inspector.rpc('sync_machine_state', {
      p_lot: target,
      p_group: 'commercial',
      p_payload: { currentBidEur: 4242 },
      p_client_updated_at: new Date().toISOString(),
    })
    check('inspector: CAN write machine state', error === null && applied === true)

    const { data: stale } = await inspector.rpc('sync_machine_state', {
      p_lot: target,
      p_group: 'commercial',
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
}

async function cleanup() {
  console.log('\n--- cleanup ---')
  let commentsRemoved = 0
  let commentsFailed = 0
  for (const { client, id } of createdComments) {
    const { error } = await client.from('comments').delete().eq('id', id)
    if (error) {
      commentsFailed++
      console.log(`could not remove comment ${id}: ${error.message}`)
    } else {
      commentsRemoved++
    }
  }

  // Profiles have no insert/delete-self policy for viewer/inspector — the
  // only mutation path they have on their own row is UPDATE (profiles_update_self).
  // Deleting a profile is intentionally not something these roles can do via
  // the API. We report this rather than attempting to work around it.
  console.log(
    `comments removed: ${commentsRemoved}${commentsFailed ? ` (${commentsFailed} failed)` : ''}`,
  )
  console.log(
    `profiles created by this run (${createdProfiles.length}): left in place — ` +
      'no role can delete its own profile via RLS, by design. An operator with ' +
      'the service-role key (or psql) can remove rows where display_name like \'rls-check-%\'.',
  )
  console.log(
    'anonymous auth.users identities created by this run: cannot be removed with the anon key. ' +
      'An operator with the service-role key can delete them via the Supabase Admin API ' +
      '(supabase.auth.admin.deleteUser) or the Dashboard.',
  )
}

let exitCode = 0
try {
  await main()
} catch (err) {
  console.error(`\nERROR: ${err.message}`)
  exitCode = 2
}
await cleanup()
process.exit(exitCode || (failures ? 1 : 0))
