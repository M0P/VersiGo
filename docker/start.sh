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

# BugFix-07 (Q6): Migrationen laufen ausschliesslich ueber den Compose-
# Service "migration" (`prisma migrate deploy`); die Laufzeit-Images
# enthalten die Prisma-CLI bewusst nicht mehr. Zusaetzlich zum Compose-
# `depends_on ... service_completed_successfully` wird hier defensiv auf
# wirklich abgeschlossene Migrationen gewartet (finished_at IS NOT NULL,
# nicht nur "Tabelle existiert"), damit die App nie vor dem fertigen
# Schema startet (z. B. bei manuellem `docker run` oder abweichenden
# Compose-Providern ohne Completed-Condition).
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
