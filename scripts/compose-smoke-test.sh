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
  # Temp worker-log capture (also on failure paths; default path is a no-op
  # when the variable was never assigned).
  rm -f "${WORKER_LOG:-/tmp/insura-worker-smoke.log}" 2>/dev/null || true
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

# Load only the keys the smoke test needs from .env. Sourcing the whole
# file as shell code would abort under `set -euo pipefail` on values with
# spaces or metacharacters (e.g. passwords). Existing environment values
# take precedence (same pattern as scripts/dev-services.sh).
if [ -f .env ]; then
  while IFS='=' read -r key value; do
    [ -z "$key" ] && continue
    case "$key" in
      \#*) continue ;;
    esac
    value="${value%$'\r'}"
    case "$key" in
      APP_PORT) APP_PORT="${APP_PORT:-$value}" ;;
      WEB_PORT) WEB_PORT="${WEB_PORT:-$value}" ;;
      POSTGRES_USER) POSTGRES_USER="${POSTGRES_USER:-$value}" ;;
      POSTGRES_DB) POSTGRES_DB="${POSTGRES_DB:-$value}" ;;
      LOCAL_ADMIN_USERNAME) LOCAL_ADMIN_USERNAME="${LOCAL_ADMIN_USERNAME:-$value}" ;;
      LOCAL_ADMIN_PASSWORD) LOCAL_ADMIN_PASSWORD="${LOCAL_ADMIN_PASSWORD:-$value}" ;;
      REDIS_URL) REDIS_URL="${REDIS_URL:-$value}" ;;
      # AP-17: Secret-Werte, die in keiner System-Config-Antwort auftauchen
      # duerfen (Secret-Leak-Smoke-Check weiter unten).
      AI_OPENAI_COMPAT_API_KEY) AI_OPENAI_COMPAT_API_KEY="${AI_OPENAI_COMPAT_API_KEY:-$value}" ;;
      PAPERLESS_API_TOKEN) PAPERLESS_API_TOKEN="${PAPERLESS_API_TOKEN:-$value}" ;;
      # AP-16: TRUST_PROXY wird von der App/Compose ausgewertet (req.ip hinter
      # einem Reverse-Proxy). Der Smoke-Test reicht den Wert nur als Umgebungs-
      # variable an Compose weiter; ein Proxy wird hier nicht aufgebaut.
      TRUST_PROXY) TRUST_PROXY="${TRUST_PROXY:-$value}" ;;
      # AP-16: CORS_ORIGINS wird von der App/Compose ausgewertet (erlaubte
      # Browser-Origins fuer die Web-App). Der Smoke-Test reicht den Wert nur
      # als Umgebungsvariable an Compose weiter (Future-Feature Contract).
      CORS_ORIGINS) CORS_ORIGINS="${CORS_ORIGINS:-$value}" ;;
    esac
  done < .env
fi

# Wait for db and redis to be healthy
echo "Waiting for database..."
# Cold init of a fresh PostgreSQL volume can take a while – poll instead
# of relying on a single pg_isready call.
DB_READY=false
for i in $(seq 1 40); do
  if $COMPOSE exec -T db pg_isready -U "${POSTGRES_USER:-insura}" -d "${POSTGRES_DB:-insura}" -t 5 >/dev/null 2>&1; then
    DB_READY=true
    break
  fi
  sleep 5
done
if [ "$DB_READY" != true ]; then
  echo "ERROR: Database not ready within timeout."
  $COMPOSE logs db
  exit 1
fi

echo "Waiting for Redis..."
REDIS_READY=false
for i in $(seq 1 20); do
  if $COMPOSE exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
    REDIS_READY=true
    break
  fi
  sleep 2
done
if [ "$REDIS_READY" != true ]; then
  echo "ERROR: Redis not ready within timeout."
  $COMPOSE logs redis
  exit 1
fi

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
  if curl -sf http://localhost:${APP_PORT:-3001}/ready 2>/dev/null | grep -q '"status":"ready"'; then
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

# The checks below intentionally avoid `node` on the host: the smoke test
# must run on machines without a local Node.js installation (JSON fields
# are matched with grep -F against the fixed response shapes).

# 1. API health endpoint
echo "1. Testing API health endpoint..."
HEALTH=$(curl -sf http://localhost:${APP_PORT:-3001}/health)
echo "   Response: $HEALTH"
echo "$HEALTH" | grep -q '"status":"ok"' || { echo "FAILED"; exit 1; }
echo "   PASS"

# 2. API readiness endpoint
echo "2. Testing API readiness endpoint..."
READY=$(curl -sf http://localhost:${APP_PORT:-3001}/ready)
echo "   Response: $READY"
echo "$READY" | grep -q '"status":"ready"' || { echo "FAILED"; exit 1; }
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
echo "$READY" | grep -q '"database":"up"' || { echo "FAILED: database is not up"; exit 1; }
echo "   Database status: up"
echo "   PASS"

# 5. Local admin bootstrap + login (if admin credentials are configured)
ADMIN_USERNAME="${LOCAL_ADMIN_USERNAME:-}"
ADMIN_PASSWORD="${LOCAL_ADMIN_PASSWORD:-}"
# The bootstrap stores the username trimmed and lowercased; normalize once
# so all checks below stay consistent even if .env contains surrounding
# whitespace or uppercase letters. The password is intentionally NOT
# trimmed (it is hashed verbatim by the bootstrap).
ADMIN_USERNAME=$(printf '%s' "$ADMIN_USERNAME" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | tr '[:upper:]' '[:lower:]')
# The .env.example placeholder is a well-known value; using it for the
# login smoke check is acceptable for the local dev path, but make it
# visible so it cannot pass unnoticed.
if [ "$ADMIN_PASSWORD" = "CHANGE_ME_FOR_LOCAL_DEVELOPMENT" ]; then
  echo "WARNING: LOCAL_ADMIN_PASSWORD is still the .env.example placeholder (CHANGE_ME_FOR_LOCAL_DEVELOPMENT)."
fi
if [ -n "$ADMIN_USERNAME" ] && [ -n "$ADMIN_PASSWORD" ]; then
  echo "5. Testing local admin login (${ADMIN_USERNAME})..."
  LOGIN_STATUS=$(curl -s -o /tmp/insura-login-response.json -w "%{http_code}" \
    -X POST http://localhost:${APP_PORT:-3001}/auth/local/login \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"${ADMIN_USERNAME}\",\"password\":\"${ADMIN_PASSWORD}\"}" \
    -c /tmp/insura-smoke-cookies.txt)
  if [ "$LOGIN_STATUS" != "200" ]; then
    echo "FAILED: local login returned HTTP $LOGIN_STATUS"
    cat /tmp/insura-login-response.json
    $COMPOSE logs api
    exit 1
  fi
  echo "   Login: HTTP $LOGIN_STATUS"
  grep -qF "\"username\":\"${ADMIN_USERNAME}\"" /tmp/insura-login-response.json || { echo "FAILED: login response username mismatch"; exit 1; }
  grep -qF '"role":"ADMIN"' /tmp/insura-login-response.json || { echo "FAILED: login response role is not ADMIN"; exit 1; }
  echo "   PASS"

  echo "6. Rejecting wrong password..."
  WRONG_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST http://localhost:${APP_PORT:-3001}/auth/local/login \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"${ADMIN_USERNAME}\",\"password\":\"wrong-password\"}")
  if [ "$WRONG_STATUS" != "401" ]; then
    echo "FAILED: wrong password should return 401, got $WRONG_STATUS"
    exit 1
  fi
  echo "   PASS"

  echo "7. Checking exactly one admin user in database..."
  ADMIN_COUNT=$($COMPOSE exec -T db psql -U "${POSTGRES_USER:-insura}" -d "${POSTGRES_DB:-insura}" \
    -tAc "SELECT count(*) FROM users WHERE username = '${ADMIN_USERNAME}' AND role = 'ADMIN' AND status = 'ACTIVE';" | tr -d '[:space:]')
  if [ "$ADMIN_COUNT" != "1" ]; then
    echo "FAILED: expected exactly 1 active admin user, found $ADMIN_COUNT"
    $COMPOSE logs api
    exit 1
  fi
  echo "   Admin count: $ADMIN_COUNT"

  # Stored password must be a bcrypt hash (never plaintext). The
  # credential lookup goes through users.username (AP-16: credentials
  # carries no identifier anymore; users.username is the source of truth).
  ADMIN_HASH=$($COMPOSE exec -T db psql -U "${POSTGRES_USER:-insura}" -d "${POSTGRES_DB:-insura}" \
    -tAc "SELECT c.\"passwordHash\" FROM credentials c JOIN users u ON u.id = c.\"userId\" WHERE u.username = '${ADMIN_USERNAME}';" | tr -d '[:space:]')
  case "$ADMIN_HASH" in
    \$2[aby]\$*) : ;;
    *)
      echo "FAILED: stored password is not a bcrypt hash (got: ${ADMIN_HASH:0:12}...)"
      exit 1
      ;;
  esac
  if printf '%s' "$ADMIN_HASH" | grep -qF "$ADMIN_PASSWORD"; then
    echo "FAILED: stored password hash contains the plaintext password"
    exit 1
  fi
  echo "   Stored password: bcrypt hash, no plaintext"
  echo "   PASS"

  # Restart the API once and confirm no duplicate admin is created
  echo "8. Testing bootstrap idempotency across restart..."
  $COMPOSE restart api >/dev/null 2>&1
  # Wait for the API to be healthy again before checking the database
  # (a fixed sleep could pass before the bootstrap re-ran).
  API_UP=false
  for i in $(seq 1 30); do
    if curl -sf http://localhost:${APP_PORT:-3001}/health >/dev/null 2>&1; then
      API_UP=true
      break
    fi
    sleep 2
  done
  if [ "$API_UP" != true ]; then
    echo "FAILED: API did not become healthy after restart"
    $COMPOSE logs api
    exit 1
  fi
  ADMIN_COUNT_AFTER=$($COMPOSE exec -T db psql -U "${POSTGRES_USER:-insura}" -d "${POSTGRES_DB:-insura}" \
    -tAc "SELECT count(*) FROM users WHERE username = '${ADMIN_USERNAME}' AND role = 'ADMIN';" | tr -d '[:space:]')
  if [ "$ADMIN_COUNT_AFTER" != "1" ]; then
    echo "FAILED: admin count changed after restart (expected 1, found $ADMIN_COUNT_AFTER)"
    $COMPOSE logs api
    exit 1
  fi
  echo "   Admin count after restart: $ADMIN_COUNT_AFTER"
  echo "   PASS"

  # AP-17: Systemeinstellungen (nur ADMIN). Der API-Restart aus Schritt 8
  # invalidiert die In-Memory-Session aus Schritt 5 – daher frischer Login.
  echo "8b. Testing system-config access (ADMIN)..."
  LOGIN2_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST http://localhost:${APP_PORT:-3001}/auth/local/login \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"${ADMIN_USERNAME}\",\"password\":\"${ADMIN_PASSWORD}\"}" \
    -c /tmp/insura-smoke-cookies-2.txt)
  if [ "$LOGIN2_STATUS" != "200" ]; then
    echo "FAILED: fresh admin login returned HTTP $LOGIN2_STATUS"
    exit 1
  fi
  SYSCONFIG_STATUS=$(curl -s -o /tmp/insura-smoke-sysconfig.json -w "%{http_code}" \
    -b /tmp/insura-smoke-cookies-2.txt \
    http://localhost:${APP_PORT:-3001}/admin/system-config)
  if [ "$SYSCONFIG_STATUS" != "200" ]; then
    echo "FAILED: /admin/system-config returned HTTP $SYSCONFIG_STATUS (expected 200 for ADMIN)"
    exit 1
  fi
  grep -qF '"key":"AI_ENABLED"' /tmp/insura-smoke-sysconfig.json || { echo "FAILED: system-config response missing AI_ENABLED"; exit 1; }
  grep -qF '"source"' /tmp/insura-smoke-sysconfig.json || { echo "FAILED: system-config response missing source metadata"; exit 1; }
  # Secrets duerfen niemals im Klartext in der Antwort auftauchen.
  if [ -n "${AI_OPENAI_COMPAT_API_KEY:-}" ] && grep -qF "$AI_OPENAI_COMPAT_API_KEY" /tmp/insura-smoke-sysconfig.json; then
    echo "FAILED: secret AI_OPENAI_COMPAT_API_KEY leaked in system-config response"
    exit 1
  fi
  if [ -n "${PAPERLESS_API_TOKEN:-}" ] && grep -qF "$PAPERLESS_API_TOKEN" /tmp/insura-smoke-sysconfig.json; then
    echo "FAILED: secret PAPERLESS_API_TOKEN leaked in system-config response"
    exit 1
  fi
  echo "   System-config: HTTP 200, Katalog sichtbar, keine Secrets im Klartext"
  echo "   PASS"

  echo "8c. Rejecting unauthenticated system-config access..."
  UNAUTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    http://localhost:${APP_PORT:-3001}/admin/system-config)
  if [ "$UNAUTH_STATUS" != "401" ]; then
    echo "FAILED: unauthenticated /admin/system-config should return 401, got $UNAUTH_STATUS"
    exit 1
  fi
  echo "   PASS"

  echo "8d. Testing system-config update + reset (AI_ENABLED)..."
  PUT_STATUS=$(curl -s -o /tmp/insura-smoke-sysconfig-put.json -w "%{http_code}" \
    -X PUT http://localhost:${APP_PORT:-3001}/admin/system-config/AI_ENABLED \
    -b /tmp/insura-smoke-cookies-2.txt \
    -H 'Content-Type: application/json' \
    -d '{"value":"true"}')
  if [ "$PUT_STATUS" != "200" ]; then
    echo "FAILED: PUT /admin/system-config/AI_ENABLED returned HTTP $PUT_STATUS"
    cat /tmp/insura-smoke-sysconfig-put.json
    exit 1
  fi
  grep -qF '"source":"UI"' /tmp/insura-smoke-sysconfig-put.json || { echo "FAILED: UI-Wert nicht aktiv (source != UI)"; exit 1; }
  grep -qF '"effectiveValue":true' /tmp/insura-smoke-sysconfig-put.json || { echo "FAILED: effektiver Wert nicht true"; exit 1; }
  DELETE_STATUS=$(curl -s -o /tmp/insura-smoke-sysconfig-del.json -w "%{http_code}" \
    -X DELETE http://localhost:${APP_PORT:-3001}/admin/system-config/AI_ENABLED \
    -b /tmp/insura-smoke-cookies-2.txt)
  if [ "$DELETE_STATUS" != "200" ]; then
    echo "FAILED: DELETE /admin/system-config/AI_ENABLED returned HTTP $DELETE_STATUS"
    exit 1
  fi
  grep -qF '"uiValuePresent":false' /tmp/insura-smoke-sysconfig-del.json || { echo "FAILED: Reset hat den UI-Wert nicht entfernt"; exit 1; }
  echo "   Update (UI-Quelle) + Reset (Fallback) erfolgreich"
  echo "   PASS"

  echo "8e. Testing profile endpoint (ADMIN)..."
  PROFILE_STATUS=$(curl -s -o /tmp/insura-smoke-profile.json -w "%{http_code}" \
    -b /tmp/insura-smoke-cookies-2.txt \
    http://localhost:${APP_PORT:-3001}/user/profile)
  if [ "$PROFILE_STATUS" != "200" ]; then
    echo "FAILED: /user/profile returned HTTP $PROFILE_STATUS (expected 200 for ADMIN)"
    exit 1
  fi
  grep -qF "\"username\":\"${ADMIN_USERNAME}\"" /tmp/insura-smoke-profile.json || { echo "FAILED: Profilantwort ohne erwarteten Benutzernamen"; exit 1; }
  grep -qF '"role":"ADMIN"' /tmp/insura-smoke-profile.json || { echo "FAILED: Profilantwort ohne ADMIN-Rolle"; exit 1; }
  echo "   Profil: HTTP 200, korrekter Benutzername/Rolle"
  echo "   PASS"
else
  echo "5. Skipping local admin login check (LOCAL_ADMIN_USERNAME/LOCAL_ADMIN_PASSWORD not configured)."
fi

# Verify the worker started successfully (connects to PostgreSQL/Redis and
# registers its queues) instead of crash-looping unnoticed.
# NOTE: createApplicationContext() never logs Nest's 'Nest application
# successfully started' message (that constant is only emitted by the HTTP
# server path). The worker therefore logs its own ready marker.
# READINESS DETECTION: we do NOT gate on the worker's log output. Podman's
# k8s-file log driver (used on the dev machine via podman-compose) can
# silently drop early boot lines when containers start in quick succession
# - entrypoint echoes, Nest boot lines and the 'Worker bereit' marker were
# observed missing even though the worker was fully functional (it consumed
# BullMQ jobs). Log-based gates therefore produced intermittent false
# failures. Instead we detect readiness by process: the worker's node
# process only starts AFTER the entrypoint finished (DB wait + migrate
# deploy + `exec node`), so pgrep matching that process is a genuine
# 'application process started' signal, independent of log capture.
WORKER_LOG=/tmp/insura-worker-smoke.log
WORKER_READY=false
for i in $(seq 1 30); do
  if $COMPOSE exec -T worker pgrep -f "apps/worker/dist/apps/worker/src/main.js" >/dev/null 2>&1; then
    WORKER_READY=true
    break
  fi
  sleep 2
done
if [ "$WORKER_READY" != true ]; then
  echo "FAILED: Worker process did not start"
  $COMPOSE logs worker
  exit 1
fi
# Crash-loop detection: a restarting worker gets a fresh PID. Capture the
# PID, wait a window, then confirm the same process is still alive (a
# crash-loop slower than this window is caught by the step-10 job
# round-trip, which needs a live worker).
WORKER_PID_1=$($COMPOSE exec -T worker pgrep -f "apps/worker/dist/apps/worker/src/main.js" | head -1)
sleep 5
WORKER_PID_2=$($COMPOSE exec -T worker pgrep -f "apps/worker/dist/apps/worker/src/main.js" | head -1)
if [ -z "$WORKER_PID_2" ] || [ "$WORKER_PID_2" != "$WORKER_PID_1" ]; then
  echo "FAILED: Worker process restarted shortly after starting (crash-loop?)"
  $COMPOSE logs worker
  exit 1
fi
echo "   Worker: process alive, no restart"
echo "   PASS"

# 10. Live queue round-trip: enqueue a BullMQ job and verify the worker
#     consumes it. The api container shares the workspace node_modules
#     (incl. bullmq) and the compose network, so it enqueues through the
#     exact same Redis queue ('ai-extraction') the worker consumes.
#     NOTE: The fachliche Verarbeitung (DB-Statuswechsel bis COMPLETED/
#     SKIPPED) wird durch die Worker-Unit-Tests abgedeckt
#     (apps/worker/src/__tests__/ai-extraction.processor.spec.ts). Die
#     ai_extraction_jobs-Tabelle existiert seit der AP-16-Migration
#     "20260801120000_ap16_ai_extraction_jobs_schema_drift" (behebt einen
#     vorbestehenden Schema-Drift aus AP-09); der Smoke-Test erzeugt fuer
#     den Job dennoch bewusst keinen DB-Eintrag. Der Worker laeuft dann
#     ueber seinen toleranten Pfad (fehlende DB-Zeile => success:false ohne
#     weiteren DB-Zugriff) und der Job erreicht einen terminalen Zustand.
echo "10. Testing worker job consumption (BullMQ round-trip)..."
SMOKE_JOB_ID="smoke-job-$(date +%s)"
# The BullMQ job id must be passed as an add() option; otherwise BullMQ
# generates its own id and the data.jobId field alone is not enough to
# address the job hash for the checks below. The Redis connection uses the
# same REDIS_URL the worker consumes (from .env), not a hardcoded URL.
ENQUEUE_OUT=$($COMPOSE exec -T api node -e "
  const { Queue } = require('bullmq');
  const q = new Queue('ai-extraction', { connection: { url: process.argv[2] } });
  q.add('extract', {
    jobId: process.argv[1],
    policyId: 'smoke-policy',
    documentIds: [],
    providerKey: 'none',
  }, { jobId: process.argv[1] })
    .then(() => q.close())
    .then(() => process.exit(0))
    .catch((err) => { console.error(err); process.exit(1); });
" "$SMOKE_JOB_ID" "${REDIS_URL:-redis://redis:6379}" 2>&1) || {
  echo "FAILED: could not enqueue smoke job on 'ai-extraction' queue"
  printf '%s\n' "$ENQUEUE_OUT"
  exit 1
}
echo "   Enqueued job: $SMOKE_JOB_ID"

# The worker logs a processing line once it picks the job up. Like the
# step-9 ready marker, this log line is unreliable on the dev machine
# (podman's log driver can drop early lines), so it is used only as a
# diagnostic, never as the pass/fail gate. The authoritative proof that
# the worker consumed the job is BullMQ state in Redis (below): the job
# must leave the wait list and reach a terminal state, which only the
# worker's AiExtractionProcessor can achieve.
echo "   Waiting for worker to consume the job (BullMQ terminal state)..."
JOB_PICKED_UP=false
for i in $(seq 1 30); do
  $COMPOSE logs worker > "$WORKER_LOG" 2>/dev/null || true
  if grep -qF "Verarbeite AI-Extraktions-Job ${SMOKE_JOB_ID}" "$WORKER_LOG"; then
    JOB_PICKED_UP=true
    break
  fi
  sleep 2
done
if [ "$JOB_PICKED_UP" = true ]; then
  echo "   Worker consumed the job (processing line observed)"
else
  echo "   (processing log line not observed - checking BullMQ state only)"
fi

# The job must leave the wait list and reach a terminal BullMQ state:
# either its hash is gone (removed on completion) or it carries a
# finishedOn timestamp (kept as failed/completed). This is independent
# of BullMQ's cleanup defaults and of the job's final status. It also
# proves the worker consumed the job without relying on log capture.
# (redis-cli returns 0 even for a missing key, so test the output.)
JOB_TERMINAL=false
for i in $(seq 1 15); do
  WAIT_LEN=$($COMPOSE exec -T redis redis-cli LLEN "bull:ai-extraction:wait" 2>/dev/null || echo 1)
  if [ "$WAIT_LEN" = "0" ]; then
    HASH_STATE=$($COMPOSE exec -T redis redis-cli EXISTS "bull:ai-extraction:${SMOKE_JOB_ID}" 2>/dev/null || echo 1)
    if [ "$HASH_STATE" = "0" ]; then
      JOB_TERMINAL=true
    else
      FINISHED_ON=$($COMPOSE exec -T redis redis-cli HGET "bull:ai-extraction:${SMOKE_JOB_ID}" finishedOn 2>/dev/null || true)
      [ -n "$FINISHED_ON" ] && JOB_TERMINAL=true
    fi
  fi
  [ "$JOB_TERMINAL" = true ] && break
  sleep 2
done
if [ "$JOB_TERMINAL" != true ]; then
  echo "FAILED: job was not fully processed (still pending in Redis)"
  $COMPOSE exec -T redis redis-cli LLEN "bull:ai-extraction:wait" 2>/dev/null || true
  $COMPOSE logs worker
  exit 1
fi
echo "   Job reached terminal BullMQ state (queue drained)"

# Clean up the smoke job keys from Redis so repeated runs stay clean.
$COMPOSE exec -T redis redis-cli DEL "bull:ai-extraction:${SMOKE_JOB_ID}" >/dev/null 2>&1 || true
$COMPOSE exec -T redis redis-cli ZREM "bull:ai-extraction:failed" "$SMOKE_JOB_ID" >/dev/null 2>&1 || true
$COMPOSE exec -T redis redis-cli ZREM "bull:ai-extraction:completed" "$SMOKE_JOB_ID" >/dev/null 2>&1 || true
# NOTE: The DB-success path (RUNNING -> SKIPPED/COMPLETED) is covered by
# the worker unit tests (apps/worker/src/__tests__/ai-extraction.processor
# .spec.ts); the smoke round-trip deliberately verifies only the queue
# lifecycle (the ai_extraction_jobs table is created by the AP-16
# schema-drift migration, but the smoke job intentionally has no DB row).
echo "   PASS"

echo ""
echo "=== All smoke tests passed ==="
