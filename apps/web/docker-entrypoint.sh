#!/bin/sh
# Entrypoint script for VersiGo Web
# Generates runtime configuration at container startup

set -e

# Default API base URL (can be overridden by environment variable)
API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL:-http://localhost:3001}"
# Runtime application version (BugFix-11/R7), shown in the UI footer
APP_VERSION="${NEXT_PUBLIC_APP_VERSION:-unknown}"

# Ensure public directory exists (standalone output structure)
mkdir -p /app/apps/web/public

# Generate runtime config
cat > /app/apps/web/public/runtime-config.js <<EOF
// Runtime configuration for VersiGo Web
// This file is generated at container startup by the entrypoint script
// Do not commit the generated version - only the template

window.__VERSIGO_RUNTIME_CONFIG__ = {
  apiBaseUrl: "${API_BASE_URL}",
  appVersion: "${APP_VERSION}"
};
EOF

echo "Generated runtime config with API base URL: ${API_BASE_URL}"

# Execute the main command
exec "$@"