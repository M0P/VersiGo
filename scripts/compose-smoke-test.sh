#!/bin/bash

set -e

echo "Running Compose Smoke Test..."

# Build and start the stack
echo "Building and starting Docker Compose stack..."
docker compose up -d --build

# Wait a bit for services to start
echo "Waiting for services to be ready..."
sleep 10

# Check health of key services
echo "Checking service health..."

# Check database health
if docker compose exec db pg_isready -U insura -d insura; then
  echo "✓ Database is healthy"
else
  echo "✗ Database is not healthy"
  docker compose logs db
  exit 1
fi

# Check Redis health  
if docker compose exec redis redis-cli ping | grep -q PONG; then
  echo "✓ Redis is healthy"
else
  echo "✗ Redis is not healthy"
  docker compose logs redis
  exit 1
fi

# Check API health endpoint
if curl -f http://localhost:3001/health; then
  echo "✓ API is healthy"
else
  echo "✗ API is not healthy"
  docker compose logs api
  exit 1
fi

# Check Web health endpoint
if curl -f http://localhost:3000/health; then
  echo "✓ Web is healthy"
else
  echo "✗ Web is not healthy"
  docker compose logs web
  exit 1
fi

# Check that we can make a simple request to the web app
if curl -f http://localhost:3000/ | grep -q "Insura"; then
  echo "✓ Web application is responding"
else
  echo "✗ Web application is not responding correctly"
  docker compose logs web
  exit 1
fi

# Clean up
echo "Cleaning up..."
docker compose down -v

echo "✓ All tests passed!"