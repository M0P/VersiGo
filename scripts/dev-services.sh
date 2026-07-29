#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

ENV_FILE="${REPO_ROOT}/.env"
ENV_EXAMPLE_FILE="${REPO_ROOT}/.env.example"

log() {
  printf '[dev-services] %s\n' "$*"
}

die() {
  log "$*"
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

load_env_defaults() {
  local src=""
  if [[ -f "${ENV_FILE}" ]]; then
    src="${ENV_FILE}"
  elif [[ -f "${ENV_EXAMPLE_FILE}" ]]; then
    src="${ENV_EXAMPLE_FILE}"
  fi

  if [[ -n "${src}" ]]; then
    while IFS='=' read -r key value; do
      [[ -z "${key}" ]] && continue
      [[ "${key}" =~ ^# ]] && continue
      value="${value%$'\r'}"
      case "${key}" in
        POSTGRES_DB) POSTGRES_DB="${POSTGRES_DB:-$value}" ;;
        POSTGRES_USER) POSTGRES_USER="${POSTGRES_USER:-$value}" ;;
        POSTGRES_PASSWORD) POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$value}" ;;
        REDIS_URL) REDIS_URL="${REDIS_URL:-$value}" ;;
      esac
    done < "${src}"
  fi

  POSTGRES_DB="${POSTGRES_DB:-insura}"
  POSTGRES_USER="${POSTGRES_USER:-insura}"
  POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-change-me}"
  PGPORT="${PGPORT:-5432}"
  REDIS_PORT="${REDIS_PORT:-6379}"
}

resolve_paths() {
  local default_pgdata="${HOME}/.local/share/insura/postgres"
  local default_state="${HOME}/.local/state/insura"
  local default_runtime="${XDG_RUNTIME_DIR:-${HOME}/.cache}/insura"

  if [[ -n "${PGDATA:-}" ]]; then
    PGDATA="${PGDATA}"
  elif [[ -d "/var/lib/pgsql/data" && -f "/var/lib/pgsql/data/PG_VERSION" ]]; then
    PGDATA="/var/lib/pgsql/data"
  else
    PGDATA="${default_pgdata}"
  fi

  INSURA_STATE_DIR="${INSURA_STATE_DIR:-${default_state}}"
  INSURA_RUNTIME_DIR="${INSURA_RUNTIME_DIR:-${default_runtime}}"
  PGSOCK_DIR="${PGSOCK_DIR:-${INSURA_RUNTIME_DIR}/postgres}"
  PGLOG="${PGLOG:-${INSURA_STATE_DIR}/postgres.log}"
  REDIS_LOG="${REDIS_LOG:-${INSURA_STATE_DIR}/redis.log}"
  REDIS_PIDFILE="${REDIS_PIDFILE:-${INSURA_RUNTIME_DIR}/redis.pid}"

  mkdir -p "${PGDATA}" "${INSURA_STATE_DIR}" "${INSURA_RUNTIME_DIR}" "${PGSOCK_DIR}"
  chmod 700 "${PGDATA}" "${PGSOCK_DIR}" || true
}

postgres_bin() {
  if command_exists "$1"; then
    printf '%s' "$1"
    return 0
  fi
  return 1
}

require_postgres_tools() {
  INITDB_BIN="$(postgres_bin initdb || true)"
  PG_CTL_BIN="$(postgres_bin pg_ctl || true)"
  PSQL_BIN="$(postgres_bin psql || true)"
  CREATEDB_BIN="$(postgres_bin createdb || true)"
  PG_ISREADY_BIN="$(postgres_bin pg_isready || true)"

  [[ -n "${INITDB_BIN}" ]] || die "initdb nicht gefunden. Bitte PostgreSQL-Client/Server installieren."
  [[ -n "${PG_CTL_BIN}" ]] || die "pg_ctl nicht gefunden."
  [[ -n "${PSQL_BIN}" ]] || die "psql nicht gefunden."
  [[ -n "${CREATEDB_BIN}" ]] || die "createdb nicht gefunden."
  [[ -n "${PG_ISREADY_BIN}" ]] || die "pg_isready nicht gefunden."
}

ensure_postgres_conf() {
  local conf="${PGDATA}/postgresql.conf"
  touch "${conf}"

  if ! grep -q "^listen_addresses = '127.0.0.1'" "${conf}" 2>/dev/null; then
    printf "\nlisten_addresses = '127.0.0.1'\n" >> "${conf}"
  fi

  if grep -q '^port = ' "${conf}" 2>/dev/null; then
    sed -i "s/^port = .*/port = ${PGPORT}/" "${conf}" || true
  else
    printf "port = %s\n" "${PGPORT}" >> "${conf}"
  fi

  if grep -q '^unix_socket_directories = ' "${conf}" 2>/dev/null; then
    sed -i "s|^unix_socket_directories = .*|unix_socket_directories = '${PGSOCK_DIR}'|" "${conf}" || true
  else
    printf "unix_socket_directories = '%s'\n" "${PGSOCK_DIR}" >> "${conf}"
  fi
}

init_postgres_if_needed() {
  if [[ -f "${PGDATA}/PG_VERSION" ]]; then
    return 0
  fi

  log "Kein initialisiertes PGDATA gefunden unter ${PGDATA}."
  log "Initialisiere lokales PostgreSQL-Cluster fuer den aktuellen Benutzer ..."
  "${INITDB_BIN}" -D "${PGDATA}" --auth-local=trust --auth-host=scram-sha-256 >/dev/null
  ensure_postgres_conf
}

postgres_running() {
  "${PG_CTL_BIN}" -D "${PGDATA}" status >/dev/null 2>&1
}

wait_for_postgres() {
  local tries=30
  while (( tries > 0 )); do
    if "${PG_ISREADY_BIN}" -h "${PGSOCK_DIR}" -p "${PGPORT}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    tries=$((tries - 1))
  done
  return 1
}

start_postgres() {
  require_postgres_tools
  init_postgres_if_needed
  ensure_postgres_conf

  if postgres_running; then
    log "PostgreSQL laeuft bereits."
    return 0
  fi

  log "Starte PostgreSQL mit PGDATA=${PGDATA}"
  if ! "${PG_CTL_BIN}" -D "${PGDATA}" -l "${PGLOG}" start >/dev/null 2>&1; then
    log "PostgreSQL konnte nicht gestartet werden. Letzte Log-Zeilen:"
    tail -n 50 "${PGLOG}" 2>/dev/null || true
    exit 1
  fi

  if ! wait_for_postgres; then
    log "PostgreSQL antwortet nicht rechtzeitig. Letzte Log-Zeilen:"
    tail -n 50 "${PGLOG}" 2>/dev/null || true
    exit 1
  fi

  ensure_postgres_role_and_db
  log "PostgreSQL gestartet."
}

ensure_postgres_role_and_db() {
  local role_exists db_exists
  role_exists="$("${PSQL_BIN}" -h "${PGSOCK_DIR}" -p "${PGPORT}" -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='${POSTGRES_USER}'" || true)"
  if [[ "${role_exists}" != "1" ]]; then
    "${PSQL_BIN}" -h "${PGSOCK_DIR}" -p "${PGPORT}" -d postgres -v ON_ERROR_STOP=1 \
      -c "CREATE ROLE ${POSTGRES_USER} LOGIN PASSWORD '${POSTGRES_PASSWORD}';" >/dev/null
  else
    "${PSQL_BIN}" -h "${PGSOCK_DIR}" -p "${PGPORT}" -d postgres -v ON_ERROR_STOP=1 \
      -c "ALTER ROLE ${POSTGRES_USER} WITH LOGIN PASSWORD '${POSTGRES_PASSWORD}';" >/dev/null
  fi

  db_exists="$("${PSQL_BIN}" -h "${PGSOCK_DIR}" -p "${PGPORT}" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${POSTGRES_DB}'" || true)"
  if [[ "${db_exists}" != "1" ]]; then
    "${CREATEDB_BIN}" -h "${PGSOCK_DIR}" -p "${PGPORT}" -O "${POSTGRES_USER}" "${POSTGRES_DB}"
  else
    "${PSQL_BIN}" -h "${PGSOCK_DIR}" -p "${PGPORT}" -d postgres -v ON_ERROR_STOP=1 \
      -c "ALTER DATABASE ${POSTGRES_DB} OWNER TO ${POSTGRES_USER};" >/dev/null
  fi
}

stop_postgres() {
  require_postgres_tools
  if postgres_running; then
    "${PG_CTL_BIN}" -D "${PGDATA}" stop >/dev/null
    log "PostgreSQL gestoppt."
  else
    log "PostgreSQL: down"
  fi
}

postgres_status() {
  require_postgres_tools
  if postgres_running; then
    log "PostgreSQL: up (PGDATA=${PGDATA}, socket=${PGSOCK_DIR}, port=${PGPORT})"
  else
    log "PostgreSQL: down"
  fi
}

detect_redis_server() {
  if command_exists valkey-server; then
    REDIS_SERVER_BIN="valkey-server"
    REDIS_CLI_BIN="$(command -v valkey-cli || true)"
    return 0
  fi
  if command_exists redis-server; then
    REDIS_SERVER_BIN="redis-server"
    REDIS_CLI_BIN="$(command -v redis-cli || true)"
    return 0
  fi
  return 1
}

redis_running() {
  if [[ -n "${REDIS_CLI_BIN:-}" ]] && command_exists "${REDIS_CLI_BIN}"; then
    "${REDIS_CLI_BIN}" -p "${REDIS_PORT}" ping >/dev/null 2>&1
  else
    [[ -f "${REDIS_PIDFILE}" ]] && kill -0 "$(cat "${REDIS_PIDFILE}")" >/dev/null 2>&1
  fi
}

start_redis() {
  if ! detect_redis_server; then
    log "Valkey/Redis nicht gefunden, ueberspringe Start."
    return 0
  fi

  if redis_running; then
    log "Redis/Valkey laeuft bereits."
    return 0
  fi

  mkdir -p "${INSURA_STATE_DIR}" "${INSURA_RUNTIME_DIR}"

  "${REDIS_SERVER_BIN}" \
    --daemonize yes \
    --bind 127.0.0.1 \
    --port "${REDIS_PORT}" \
    --dir "${INSURA_STATE_DIR}" \
    --pidfile "${REDIS_PIDFILE}" \
    --logfile "${REDIS_LOG}" >/dev/null 2>&1 || {
      log "Redis/Valkey konnte nicht gestartet werden. Letzte Log-Zeilen:"
      tail -n 50 "${REDIS_LOG}" 2>/dev/null || true
      exit 1
    }

  if redis_running; then
    log "Redis/Valkey gestartet."
  else
    log "Redis/Valkey konnte nicht bestaetigt werden."
    exit 1
  fi
}

stop_redis() {
  if ! detect_redis_server; then
    log "Redis/Valkey: down"
    return 0
  fi

  if redis_running; then
    if [[ -n "${REDIS_CLI_BIN:-}" ]] && command_exists "${REDIS_CLI_BIN}"; then
      "${REDIS_CLI_BIN}" -p "${REDIS_PORT}" shutdown >/dev/null 2>&1 || true
      sleep 1
    fi
    if [[ -f "${REDIS_PIDFILE}" ]]; then
      kill "$(cat "${REDIS_PIDFILE}")" >/dev/null 2>&1 || true
      rm -f "${REDIS_PIDFILE}"
    fi
    log "Redis/Valkey gestoppt."
  else
    log "Redis/Valkey: down"
  fi
}

redis_status() {
  if detect_redis_server && redis_running; then
    log "Redis/Valkey: up (port=${REDIS_PORT})"
  else
    log "Redis/Valkey: down"
  fi
}

usage() {
  cat <<EOF
Verwendung:
  ./scripts/dev-services.sh start
  ./scripts/dev-services.sh stop
  ./scripts/dev-services.sh restart
  ./scripts/dev-services.sh status

Umgebungsvariablen:
  PGDATA            Optionaler PostgreSQL-Datenpfad
  PGPORT            Optionaler PostgreSQL-Port (Standard: 5432)
  PGSOCK_DIR        Optionaler Unix-Socket-Pfad
  REDIS_PORT        Optionaler Redis/Valkey-Port (Standard: 6379)
EOF
}

main() {
  load_env_defaults
  resolve_paths

  case "${1:-}" in
    start)
      start_postgres
      start_redis
      ;;
    stop)
      stop_redis
      stop_postgres
      ;;
    restart)
      stop_redis || true
      stop_postgres || true
      start_postgres
      start_redis
      ;;
    status)
      postgres_status
      redis_status
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "${1:-}"
