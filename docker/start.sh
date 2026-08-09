#!/usr/bin/env sh
set -e

# Wait for database to be reachable
echo "Waiting for database..."
max_retries=30
retries=0
until pg_isready -d "$DATABASE_URL" -q 2>/dev/null; do
  retries=$((retries + 1))
  if [ $retries -ge $max_retries ]; then
    echo "ERROR: Database not reachable after 60s"
    exit 1
  fi
  sleep 2
done
echo "Database is ready."

# BugFix-07 (Q6): Migrations run exclusively via the compose service
# "migration" (`prisma migrate deploy`); the runtime images deliberately no
# longer contain the Prisma CLI. In addition to the compose
# `depends_on ... service_completed_successfully`, this script defensively
# waits for actually finished migrations (finished_at IS NOT NULL, not just
# "table exists") so the app never starts before the schema is ready (e.g.
# on manual `docker run` or with compose providers lacking the
# completed condition).
echo "Waiting for migrations to be applied..."
mig_retries=0
until psql "$DATABASE_URL" -tAc "SELECT 1 FROM _prisma_migrations WHERE finished_at IS NOT NULL LIMIT 1" >/dev/null 2>&1; do
  mig_retries=$((mig_retries + 1))
  if [ $mig_retries -ge 30 ]; then
    echo "ERROR: Migrations not applied after 60s (is the 'migration' service running?)"
    exit 1
  fi
  sleep 2
done
echo "Migrations are applied."

echo "Starting application..."
exec "$@"
