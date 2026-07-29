# Development Environment

## Distrobox (fedora-app)

Node.js, pnpm, PostgreSQL und alle Laufzeit-Tools sind **nur in der Distrobox `fedora-app`** verfügbar. Es gibt kein Docker-Setup.

Alle CLI-Befehle müssen via Distrobox ausgeführt werden:

```bash
distrobox enter fedora-app -- <command>
```

Häufige Befehle:

| Aufgabe | Befehl |
|---------|--------|
| Lint | `distrobox enter fedora-app -- bash -c "CI=true pnpm run lint"` |
| Tests (API) | `distrobox enter fedora-app -- bash -c "CI=true pnpm run test --filter @insura/api"` |
| Tests (alle) | `distrobox enter fedora-app -- bash -c "CI=true pnpm run test"` |
| Prisma migrate | `distrobox enter fedora-app -- bash -c "CI=true pnpm --filter @insura/api exec prisma migrate dev"` |
| Prisma generate | `distrobox enter fedora-app -- bash -c "CI=true pnpm --filter @insura/api exec prisma generate"` |
| Dev-Server | `distrobox enter fedora-app -- bash -c "pnpm run dev"` |

Die Umgebungsvariable `CI=true` verhindert, dass pnpm bei Lockfile-Änderungen nach interaktiver Bestätigung fragt.

## PostgreSQL

PostgreSQL läuft lokal in der Distrobox `fedora-app`. Kein Docker-Container. Verbindung über localhost:5432 (Standard).
