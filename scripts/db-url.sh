#!/usr/bin/env bash
# Composes the Postgres connection URL from the parts in .env and prints it.
# Kept separate so the password lives in exactly one place (.env, gitignored).
#
# Usage:  psql "$(scripts/db-url.sh)" -v ON_ERROR_STOP=1 -f db/0001_schema.sql
set -euo pipefail
cd "$(dirname "$0")/.."
set -a && source .env && set +a
: "${VITE_SUPABASE_URL:?}" "${SUPABASE_DB_PASSWORD:?}" "${SUPABASE_DB_POOLER_HOST:?}"
python3 -c "
import os, urllib.parse as u
ref = os.environ['VITE_SUPABASE_URL'].split('//')[1].split('.')[0]
pw  = u.quote(os.environ['SUPABASE_DB_PASSWORD'], safe='')
print('postgresql://postgres.%s:%s@%s:5432/postgres' % (ref, pw, os.environ['SUPABASE_DB_POOLER_HOST']))
"
