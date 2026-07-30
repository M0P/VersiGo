#!/bin/sh

set -e

# Function to wait for a service to be ready
wait_for_service() {
  local host="$1"
  local port="$2"
  local max_retries="${3:-30}"
  local retry_count=0
  
  echo "Waiting for $host:$port..."
  while ! nc -z "$host" "$port"; do
    retry_count=$((retry_count + 1))
    if [ $retry_count -gt $max_retries ]; then
      echo "Timeout waiting for $host:$port"
      exit 1
    fi
    echo "Waiting for $host:$port... ($retry_count/$max_retries)"
    sleep 2
  done
  echo "$host:$port is ready"
}

# Function to wait for database to be ready
wait_for_db() {
  local max_retries="${1:-30}"
  local retry_count=0
  
  echo "Waiting for database..."
  until pg_isready -h db -p 5432 -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
    retry_count=$((retry_count + 1))
    if [ $retry_count -gt $max_retries ]; then
      echo "Timeout waiting for database"
      exit 1
    fi
    echo "Waiting for database... ($retry_count/$max_retries)"
    sleep 2
  done
  echo "Database is ready"
}

# Function to run database migrations
run_migrations() {
  echo "Running database migrations..."
  pnpm --filter @insura/api exec prisma migrate deploy
  echo "Migrations completed"
}

# Main startup logic
echo "Starting Insura service: $SERVICE"

case "$SERVICE" in
  "web")
    echo "Starting Web Application..."
    # Web doesn't need special startup handling
    exec pnpm --filter @insura/web start
    ;;
    
  "api")
    echo "Starting API Server..."
    # Wait for database to be ready
    wait_for_db
    
    # Run database migrations
    run_migrations
    
    # Start API service
    exec pnpm --filter @insura/api start
    ;;
    
  "worker")
    echo "Starting Worker Process..."
    # Wait for database to be ready
    wait_for_db
    
    # Run database migrations (if needed)
    run_migrations
    
    # Start worker service
    exec pnpm --filter @insura/worker start
    ;;
    
  *)
    echo "Unknown SERVICE: $SERVICE"
    exit 1
    ;;
esac