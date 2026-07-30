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

# Run database migrations (idempotent)
echo "Running database migrations..."
npx prisma migrate deploy

echo "Starting application..."
exec "$@"
