#!/usr/bin/env bash
set -euo pipefail

# scripts/dev-services.sh
#
# Startet die lokalen Entwicklungsabhaengigkeiten (PostgreSQL, Redis/Valkey)
# fuer Umgebungen ohne systemd und ohne Docker, z. B. innerhalb einer
# Distrobox (Fedora) auf Bazzite/Silverblue-Hosts.
#
# Hintergrund: docker-compose.yml bleibt die primaere, dokumentierte
# lokale Entwicklungsumgebung (siehe docs/03-architecture.md). Dieses
# Skript ist ein Fallback fuer Systeme ohne Docker/Podman und ersetzt
# NICHT die Compose-Topologie. Es dient ausschliesslich der lokalen
# Entwicklung, nicht Produktion und nicht CI (CI nutzt GitHub Actions
# Service-Container, siehe .github/workflows/ci.yml).
#
# Nutzung:
#   ./scripts/dev-services.sh start
#   ./scripts/dev-services.sh stop
#   ./scripts/dev-services.sh status

PGDATA_DIR="${PGDATA_DIR:-/var/lib/pgsql/data}"
PG_LOG="${PG_LOG:-/var/lib/pgsql/logfile}"
VALKEY_PORT="${VALKEY_PORT:-6379}"

action="${1:-status}"

start_postgres() {
  if pg_isready -q -h localhost -p 5432 2>/dev/null; then
    echo "[dev-services] PostgreSQL läuft bereits."
    return
  fi

  if [ ! -d "${PGDATA_DIR}" ] || [ -z "$(ls -A "${PGDATA_DIR}" 2>/dev/null)" ]; then
    echo "[dev-services] Kein initialisiertes PGDATA gefunden unter ${PGDATA_DIR}."
    echo "[dev-services] Einmalige Initialisierung erforderlich, siehe README-Abschnitt"
    echo "[dev-services] 'Lokale Entwicklung ohne Docker'."
    exit 1
  fi

  echo "[dev-services] Starte PostgreSQL..."
  sudo su - postgres -c "/usr/bin/pg_ctl start -D ${PGDATA_DIR} -l ${PG_LOG}"
}

start_valkey() {
  if redis-cli -p "${VALKEY_PORT}" ping >/dev/null 2>&1; then
    echo "[dev-services] Redis/Valkey läuft bereits."
    return
  fi

  echo "[dev-services] Starte Valkey (Redis-kompatibel) auf Port ${VALKEY_PORT}..."
  valkey-server --daemonize yes --port "${VALKEY_PORT}"
}

stop_postgres() {
  if pg_isready -q -h localhost -p 5432 2>/dev/null; then
    echo "[dev-services] Stoppe PostgreSQL..."
    sudo su - postgres -c "/usr/bin/pg_ctl stop -D ${PGDATA_DIR}"
  else
    echo "[dev-services] PostgreSQL läuft nicht."
  fi
}

stop_valkey() {
  if redis-cli -p "${VALKEY_PORT}" ping >/dev/null 2>&1; then
    echo "[dev-services] Stoppe Valkey..."
    redis-cli -p "${VALKEY_PORT}" shutdown nosave || true
  else
    echo "[dev-services] Valkey läuft nicht."
  fi
}

status() {
  if pg_isready -q -h localhost -p 5432 2>/dev/null; then
    echo "[dev-services] PostgreSQL: up"
  else
    echo "[dev-services] PostgreSQL: down"
  fi

  if redis-cli -p "${VALKEY_PORT}" ping >/dev/null 2>&1; then
    echo "[dev-services] Redis/Valkey: up"
  else
    echo "[dev-services] Redis/Valkey: down"
  fi
}

case "${action}" in
  start)
    start_postgres
    start_valkey
    status
    ;;
  stop)
    stop_postgres
    stop_valkey
    ;;
  status)
    status
    ;;
  *)
    echo "Nutzung: $0 {start|stop|status}"
    exit 1
    ;;
esac
