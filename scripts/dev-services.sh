#!/usr/bin/env bash
set -euo pipefail

# Insura – lokale Entwicklungsdienste ohne Docker/systemd.
# Gedacht fuer Umgebungen wie Distrobox, in denen kein systemd als PID 1
# laeuft und Docker nicht verfuegbar ist. Startet PostgreSQL und
# Redis/Valkey manuell im Vordergrund-Modus (Redis/Valkey daemonisiert,
# PostgreSQL via pg_ctl).
#
# Nutzung:
#   ./scripts/dev-services.sh start   # Dienste starten
#   ./scripts/dev-services.sh stop    # Dienste stoppen
#   ./scripts/dev-services.sh status  # Status pruefen

PGDATA="${PGDATA:-/var/lib/pgsql/data}"
PG_LOG="${PG_LOG:-/tmp/insura-postgres.log}"
REDIS_PORT="${REDIS_PORT:-6379}"

start() {
  echo "Starte PostgreSQL (PGDATA=${PGDATA})..."
  if sudo su - postgres -c "pg_ctl status -D ${PGDATA}" >/dev/null 2>&1; then
    echo "PostgreSQL laeuft bereits."
  else
    sudo su - postgres -c "pg_ctl start -D ${PGDATA} -l ${PG_LOG}"
  fi

  echo "Starte Redis/Valkey (Port ${REDIS_PORT})..."
  if redis-cli -p "${REDIS_PORT}" ping >/dev/null 2>&1; then
    echo "Redis/Valkey laeuft bereits."
  else
    valkey-server --daemonize yes --port "${REDIS_PORT}"
  fi

  status
}

stop() {
  echo "Stoppe PostgreSQL..."
  sudo su - postgres -c "pg_ctl stop -D ${PGDATA}" || true

  echo "Stoppe Redis/Valkey..."
  redis-cli -p "${REDIS_PORT}" shutdown nosave || true
}

status() {
  echo "--- Status ---"
  if sudo su - postgres -c "pg_isready -q"; then
    echo "PostgreSQL: up"
  else
    echo "PostgreSQL: down"
  fi

  if redis-cli -p "${REDIS_PORT}" ping >/dev/null 2>&1; then
    echo "Redis/Valkey: up"
  else
    echo "Redis/Valkey: down"
  fi
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *)
    echo "Nutzung: $0 {start|stop|status}"
    exit 1
    ;;
esac
