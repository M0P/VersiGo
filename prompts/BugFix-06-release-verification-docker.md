# BugFix-06: Release-Verifikation der Docker-Optimierungen (BugFix-04 + BugFix-05)

## Kontext

BugFix-04 (Commit `09e680b`) hat die Docker-Images verkleinert (API 839→493 MB, Worker 828→488 MB, Web 241→206 MB) und BugFix-05 (Commit `e1ca357`) hat den Docker-Produktions-Build von api/worker repariert (parallele Store-Cache-Race in der CI + selbstenthaeltender Build durch Mitkopieren der Paket-`node_modules`).

Vor dem nächsten Feature-Arbeitsschritt muss **von einem frischen Clone** bewiesen werden, dass die gesamte Docker-Lieferkette funktioniert (AGENTS.md „Required Future-Feature Contract": *Every feature must leave `docker compose up --build` working from a fresh clone*). Dieses Paket ist eine reine **Verifikations- und Dokumentationsaufgabe** – es enthält keine neuen Features. Die offenen BugFix-05-Befunde 1–8 (Feature-Verwaltung, Portal-URL-Normalisierung, Kosten je Versicherung, Spinner, Signout, Tab-Reload, Family-Sharing) sind **nicht** Teil dieses Pakets und werden separat bearbeitet.

## Umfang (Checkliste)

1. **Fresh-Clone-Compose:** In einem frischen Arbeitsverzeichnis (git clone bzw. `git clean -fdx`-äquivalenter Zustand, kein `node_modules`, keine alten Volumes):
   - `cp .env.example .env` (mit gültigen Platzhalterwerten für lokale Entwicklung)
   - `docker compose down -v` (Altlasten entfernen)
   - `docker compose up --build` → alle Services starten: db, redis, migration (one-shot, läuft durch), api, worker, web.
   - Healthchecks werden `healthy`: api `/health` 200 (Port 3001), web 2xx/3xx (Port 3000), worker Liveness (3100, nur im Container).
   - Login mit dem initialen lokalen Administrator funktioniert.
2. **Compose-Smoke-Test:** `./scripts/compose-smoke-test.sh --build` läuft komplett durch (alle 12 Schritte, inkl. Produktions-Erfolgspfad).
3. **CI-Build-Szenario (BugFix-05-Regression):** `docker compose build api web worker` läuft fehlerfrei – zusätzlich einmal **kalt** (`--no-cache`) für api/worker, um die Store-Race-Variante (TS2307 in `@versigo/foundation:build`) auszuschließen.
4. **Image-Größen (Zielwerte aus BugFix-04):** `api ≤ 520 MB`, `worker ≤ 520 MB`, `web ≤ 230 MB` (`podman image ls` / `docker image ls`; geprüft nach `docker compose build`).
5. **Voller Test-Gate:** `docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from test` → grün (Lint, Typecheck, Unit/Integration, i18n-Guard, Turbo 5/5).
6. **Dokumentation:** `docs/docker-image-guide.md` spiegelt den Ist-Stand (Befehle, Ports, Image-Größen, Hinweis auf den Cache-Store je Service). Bei Abweichungen dokumentieren/korrigieren.
7. **Keine offenen Docker-Bauchschmerzen:** `.dockerignore` deckt `node_modules/`, `.env*`, `.git` ab; keine `.env`-Datei im Image (Prüfung: `podman run --rm --entrypoint sh <image> -c 'ls -la /app | grep -c .env'` liefert 0 Treffer).

## Akzeptanzkriterien

- `docker compose up --build` startet den kompletten Stack aus einem frischen Clone fehlerfrei (alle Services `healthy`, Web http://localhost:3000, API http://localhost:3001).
- `scripts/compose-smoke-test.sh --build` grün (12/12).
- `docker compose build api web worker` sowie die Kalt-Builds (`--no-cache`) für api/worker grün ohne TS2307.
- Image-Größen: api ≤ 520 MB, worker ≤ 520 MB, web ≤ 230 MB.
- Volles Test-Gate grün (Lint, Typecheck, Tests, i18n).
- Keine unverschmutzten Images: keine `.env`-Dateien, keine Host-`node_modules` im Kontext.
- Review-Loop: 0 Critical / 0 High / 0 Medium, ≤ 8 Minor; alle Pflicht-Checks grün oder Abweichung dokumentiert.

## Nächste Schritte

1. Fresh-Clone-Szenario lokal durchspielen (siehe Umfang 1–4), Befunde protokollieren.
2. `scripts/compose-smoke-test.sh --build` ausführen.
3. Volles Test-Gate ausführen.
4. Bei Fehlern: Root Cause analysieren und beheben **innerhalb** dieses Pakets (nur Docker/Verifikation betreffend).
5. `docs/docker-image-guide.md` auf Ist-Stand bringen.
6. Review-Loop wie gehabt (@code-reviewer, Ergebnis verbatim nach `docs/reviews/BugFix-06-review-<n>.md`).
7. Am Ende: alle Podman/Docker-Artefakte aufräumen (AGENTS.md Regeln 9–11), Commit `BugFix-06: ...`.

## Referenzen

- AGENTS.md (Docker Compose primary, Required Future-Feature Contract, Podman-Hinweise 1–11)
- `docs/docker-image-guide.md` (Liefer-/Deploy-Dokumentation)
- `scripts/compose-smoke-test.sh` (Smoke-Gate inkl. `--build`)
- `Dockerfile`, `Dockerfile.test`, `apps/{api,web,worker}/Dockerfile` (BugFix-04/05-Änderungen)
- `docker-compose.yml`, `docker-compose.test.yml`, `docker-compose.override.yml`
- `.dockerignore`
- `.github/workflows/ci.yml` (`compose-smoke`-Job: `docker compose build api web worker`)
- BugFix-04 (Commit `09e680b`), BugFix-05 (Commit `e1ca357`) inkl. `docs/reviews/BugFix-04-review-*.md`, `docs/reviews/BugFix-05-review-*.md`
