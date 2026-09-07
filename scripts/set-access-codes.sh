#!/usr/bin/env bash
# Sets the three access codes from environment variables, so no quoting is
# involved and the codes never appear in a command line or shell history.
#
# Usage:
#   1. Add these three lines to .env (gitignored), with your own values:
#        EHS_ADMIN_CODE=...
#        EHS_INSPECTOR_CODE=...
#        EHS_VIEWER_CODE=...
#   2. Run: scripts/set-access-codes.sh
#   3. Delete the three lines from .env afterwards - the hashes are in the
#      database now, and the plaintext is not needed again.
#
# Codes must be at least 12 characters. Only bcrypt hashes are stored, so a
# forgotten code cannot be recovered, only replaced by re-running this.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a && source .env && set +a

for v in EHS_ADMIN_CODE EHS_INSPECTOR_CODE EHS_VIEWER_CODE; do
  if [ -z "${!v:-}" ]; then echo "ERROR: $v is not set in .env" >&2; exit 1; fi
done

for v in EHS_ADMIN_CODE EHS_INSPECTOR_CODE EHS_VIEWER_CODE; do
  val="${!v}"
  if [ ${#val} -lt 12 ]; then
    echo "ERROR: $v is ${#val} characters; minimum is 12." >&2; exit 1
  fi
done

psql "$(scripts/db-url.sh)" -v ON_ERROR_STOP=1 \
  -v admin="$EHS_ADMIN_CODE" -v inspector="$EHS_INSPECTOR_CODE" -v viewer="$EHS_VIEWER_CODE" <<'SQL'
insert into ehs.access_codes (role, code_hash) values
  ('admin',     crypt(:'admin',     gen_salt('bf',12))),
  ('inspector', crypt(:'inspector', gen_salt('bf',12))),
  ('viewer',    crypt(:'viewer',    gen_salt('bf',12)))
on conflict (role) do update
  set code_hash = excluded.code_hash, updated_at = now();
SQL

echo
echo "Stored (hashes only):"
psql "$(scripts/db-url.sh)" -At -c \
  "select role || '  ' || left(code_hash,4) || '  ' || updated_at from ehs.access_codes order by role;"
echo
echo "Now remove EHS_ADMIN_CODE / EHS_INSPECTOR_CODE / EHS_VIEWER_CODE from .env."
