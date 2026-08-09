#!/bin/sh
# Entrypoint script for VersiGo Web
# Generates runtime configuration at container startup

set -e

# Explicit API base URL override (e.g. a TLS-terminating reverse proxy whose
# public URL does not follow the auto-detection scheme below). Empty/unset:
# the browser derives the URL from the page it was loaded with, so the stack
# works over direct IP/HTTP access AND through a reverse proxy at the same
# time (see the auto-detection block below).
API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL:-}"
# API port for the direct IP/HTTP path: the browser uses the host it loaded
# the page from and only swaps the port (WEB_PORT -> API port).
API_PORT="${NEXT_PUBLIC_API_PORT:-3001}"
# Runtime application version (BugFix-11/R7), shown in the UI footer
APP_VERSION="${NEXT_PUBLIC_APP_VERSION:-unknown}"

# Ensure public directory exists (standalone output structure)
mkdir -p /app/apps/web/public

if [ -n "${API_BASE_URL}" ]; then
  # Explicit override wins (quoted string).
  API_BASE_JS="\"${API_BASE_URL}\""
  echo "Generated runtime config with explicit API base URL: ${API_BASE_URL}"
else
  # Auto-detection (BugFix-14): the browser computes the API base URL from
  # window.location, so both access modes work with one deployment:
  #   - HTTPS via reverse proxy: same origin + /api prefix
  #     (Caddy strips /api and forwards to the API container), e.g.
  #     https://versicherung.home -> https://versicherung.home/api
  #   - Direct IP/HTTP access: same host, API port, e.g.
  #     http://192.168.24.8:2670  -> http://192.168.24.8:2669
  API_BASE_JS="(function(){var p=window.location.protocol,h=window.location.hostname,pt=window.location.port;if(p==='https:'){return p+'//'+h+(pt?':'+pt:'')+'/api';}return 'http://'+h+':'+'${API_PORT}';})()"
  echo "Generated runtime config with auto-detected API base URL (HTTP: port ${API_PORT}, HTTPS: same-origin /api)"
fi

# Generate runtime config
cat > /app/apps/web/public/runtime-config.js <<EOF
// Runtime configuration for VersiGo Web
// This file is generated at container startup by the entrypoint script
// Do not commit the generated version - only the template

window.__VERSIGO_RUNTIME_CONFIG__ = {
  apiBaseUrl: ${API_BASE_JS},
  appVersion: "${APP_VERSION}"
};
EOF

# Execute the main command
exec "$@"
