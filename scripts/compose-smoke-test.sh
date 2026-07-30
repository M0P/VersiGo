#!/usr/bin/env bash
# ============================================================
# compose-smoke-test.sh
#
# Builds the Compose stack, starts it, waits for health checks,
# runs smoke tests, and shuts down cleanly.
#
# Usage:
#   ./scripts/compose-smoke-test.sh [--build] [--clean]
#
# Options:
#   --build   Rebuild images before starting
#   --clean   Remove volumes and reset before starting
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

# Compose command
COMPOSE="docker compose"
if ! command -v docker &>/dev/null && command -v podman &>/dev/null; then
  COMPOSE="podman-compose"
elif ! command -v docker &>/dev/null; then
  echo "ERROR: Neither docker nor podman found."
  exit 1
fi

cd "${REPO_ROOT}"

# Parse options
BUILD=false
CLEAN=false
for arg in "$@"; do
  case "$arg" in
    --build) BUILD=true ;;
    --clean) CLEAN=true ;;
  esac
done

# Ensure .env exists for compose
if [ ! -f .env ]; then
  echo "Creating .env from .env.example ..."
  cp .env.example .env
fi

# Cleanup function
cleanup() {
  echo ""
  echo "Shutting down stack..."
  $COMPOSE down --remove-orphans 2>/dev/null || true
  if [ "$CLEAN" = true ]; then
    echo "Removing volumes..."
    $COMPOSE down -v --remove-orphans 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Optional clean start
if [ "$CLEAN" = true ]; then
  echo "Cleaning previous state..."
  $COMPOSE down -v --remove-orphans 2>/dev/null || true
fi

# Build images
if [ "$BUILD" = true ]; then
  echo "Building images..."
  $COMPOSE build api web worker 2>&1
fi

# Start stack (excluding optional storage)
echo "Starting Insura stack..."
$COMPOSE up -d db redis

# Source .env for default values
set -a
[ -f .env ] && . .env
set +a

# Wait for db and redis to be healthy
echo "Waiting for database..."
$COMPOSE exec -T db pg_isready -U "${POSTGRES_USER:-insura}" -d "${POSTGRES_DB:-insura}" -t 60 || {
  echo "ERROR: Database not ready within timeout."
  $COMPOSE logs db
  exit 1
}

echo "Waiting for Redis..."
$COMPOSE exec -T redis redis-cli ping | grep -q PONG || {
  echo "ERROR: Redis not ready within timeout."
  $COMPOSE logs redis
  exit 1
}

# Run migration
echo "Running migration..."
$COMPOSE run --rm migration 2>&1 || {
  echo "ERROR: Migration failed."
  $COMPOSE logs migration 2>/dev/null || true
  exit 1
}

# Start API and worker
echo "Starting API and Worker..."
$COMPOSE up -d api worker

# Wait for API health endpoint
echo "Waiting for API health check..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:${APP_PORT:-3001}/health >/dev/null 2>&1; then
    echo "API is healthy."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: API did not become healthy."
    $COMPOSE logs api
    exit 1
  fi
  sleep 2
done

# Wait for API readiness (database + redis check)
echo "Waiting for API readiness check..."
for i in $(seq 1 15); do
  if curl -sf http://localhost:${APP_PORT:-3001}/ready 2>/dev/null | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);process.exit(j.status==='ready'?0:1)})" 2>/dev/null; then
    echo "API is ready."
    break
  fi
  if [ "$i" -eq 15 ]; then
    echo "ERROR: API did not become ready (status degraded)."
    curl -s http://localhost:${APP_PORT:-3001}/ready || true
    $COMPOSE logs api
    exit 1
  fi
  sleep 2
done

# Start web
echo "Starting Web..."
$COMPOSE up -d web

# Wait for web
echo "Waiting for Web..."
for i in $(seq 1 30); do
  WEB_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:${WEB_PORT:-3000}/ 2>/dev/null || echo "000")
  if [ "$WEB_CODE" -ge 200 ] && [ "$WEB_CODE" -lt 400 ]; then
    echo "Web is available (HTTP $WEB_CODE)."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: Web did not become available."
    $COMPOSE logs web
    exit 1
  fi
  sleep 2
done

# Smoke tests
echo ""
echo "=== Smoke Tests ==="

# 1. API health endpoint
echo "1. Testing API health endpoint..."
HEALTH=$(curl -sf http://localhost:${APP_PORT:-3001}/health)
echo "   Response: $HEALTH"
echo "$HEALTH" | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);process.exit(j.status==='ok'?0:1)})" || { echo "FAILED"; exit 1; }
echo "   PASS"

# 2. API readiness endpoint
echo "2. Testing API readiness endpoint..."
READY=$(curl -sf http://localhost:${APP_PORT:-3001}/ready)
echo "   Response: $READY"
echo "$READY" | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);process.exit(j.status==='ready'?0:1)})" || { echo "FAILED"; exit 1; }
echo "   PASS"

# 3. Web availability (accepts 2xx or 3xx redirects)
echo "3. Testing web availability..."
WEB_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:${WEB_PORT:-3000}/)
echo "   HTTP Status: $WEB_STATUS"
if [ "$WEB_STATUS" -ge 200 ] && [ "$WEB_STATUS" -lt 400 ]; then
  echo "   PASS"
else
  echo "FAILED"
  exit 1
fi

# 4. Database-backed request (API /health uses DB indirectly via /ready)
echo "4. Testing database-backed request..."
echo "$READY" | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);process.exit(j.database==='up'?0:1)})" || { echo "FAILED: database is not up"; exit 1; }
echo "   Database status: up"
echo "   PASS"

echo ""
echo "=== All smoke tests passed ==="
