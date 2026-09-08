#!/usr/bin/env bash
# Resets a single role's access code, reading it from stdin so it never appears
# in a command line or in shell history.
#
# Usage:  scripts/set-one-code.sh viewer
#         (then type the code and press Enter)
set -euo pipefail
cd "$(dirname "$0")/.."
role="${1:-}"
case "$role" in
  admin|inspector|viewer) ;;
  *) echo "Usage: $0 <admin|inspector|viewer>" >&2; exit 2 ;;
esac

printf 'New %s code (min 12 chars, not echoed): ' "$role" >&2
read -rs code < /dev/tty
echo >&2

code="${code#"${code%%[![:space:]]*}"}"
code="${code%"${code##*[![:space:]]}"}"
if [ ${#code} -lt 12 ]; then
  echo "ERROR: code is ${#code} characters after trimming; minimum is 12." >&2; exit 1
fi

psql "$(scripts/db-url.sh)" -v ON_ERROR_STOP=1 -v code="$code" -v role="$role" <<'SQL'
insert into ehs.access_codes (role, code_hash)
values (:'role', crypt(:'code', gen_salt('bf',12)))
on conflict (role) do update
  set code_hash = excluded.code_hash, updated_at = now();
SQL

echo "Updated. Stored hash only:" >&2
psql "$(scripts/db-url.sh)" -At -c \
  "select role||'  '||left(code_hash,4)||'  '||updated_at from ehs.access_codes where role = '$role';"
