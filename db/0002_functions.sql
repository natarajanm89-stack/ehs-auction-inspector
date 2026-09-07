-- Reads the caller's role without triggering the profiles RLS policy.
-- Named caller_role, not current_role: current_role is a reserved SQL keyword
-- and a built-in Postgres function.
-- SECURITY DEFINER is required: policies on profiles will themselves call
-- this function, and a plain query would recurse infinitely.
create or replace function ehs.caller_role()
returns text
language sql
security definer
set search_path = ehs, public
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
set search_path = ehs, public
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

  -- Rate limit: 10 attempts per 15 minutes per anonymous identity.
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
set search_path = ehs, public
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
set search_path = ehs, public
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
