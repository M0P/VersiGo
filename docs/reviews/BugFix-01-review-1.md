# BugFix-01 Review – Runde 1

Datum: 2026-07-31
Reviewer: `@code-reviewer` (DeepSeek, read-only)
Scope: uncommitted BugFix-01 changes (`fix/BugFix-01-docker-setup`) gegen den Work Package `prompts/BugFix-01-docker-setup.md`.

## Ergebnis: CHANGES REQUIRED

| Schweregrad | Anzahl |
|-------------|--------|
| Critical    | 0      |
| High        | 0      |
| Medium      | 2      |
| Minor       | 8      |

> Hinweis: Die Originalausgabe des Review-Tools wurde in der Mitte der
> Minor-Liste abgeschnitten (verlorener Output). Dieses Dokument ist die
> treue Rekonstruktion aus dem erfassten Teil (beide Medium-Findings
> vollständig) und der aus dem Review abgeleiteten Fix-Liste. Die
> Runde-2-Ausgabe (vollständig) folgt in `BugFix-01-review-2.md`.

## Medium Findings

### M1 – `apps/api/src/features/identity/local-admin.bootstrap.ts:38-107` – P2002 stürzt die API beim Start ab

`User.email` ist `@unique`. Hält bereits ein bestehender (z. B. OIDC-)Benutzer
die E-Mail `LOCAL_ADMIN_EMAIL`, wirft `tx.user.create` einen P2002-Fehler, der
durch `IdentityModule.onModuleInit` bis an die NestJS-Bootstrap-Sequenz
propagiert – die API startet nicht oder restartet in einer Schleife. Zusätzlich
besteht eine Check-then-Insert-Race zwischen mehreren Replicas (beide lesen
"kein Credential vorhanden", beide inserten, der zweite erhält P2002).

Fix: Bootstrap-Body in try/catch kapseln, Fehler nur warnen; zusätzlich
E-Mail-Uniqueness vorab prüfen.

### M2 – `scripts/compose-smoke-test.sh:239-249` – Schritt 8 kann falsch grün werden

Nach `$COMPOSE restart api` wird mit fixem `sleep 5` gewartet. Auf langsamen
Engines kann der API-Prozess nach 5 s noch nicht neu gestartet sein, sodass der
anschließende Admin-Count noch den Zustand vor dem Restart zeigt und der Test
fälschlich besteht (false PASS).

Fix: API-Health-Endpunkt pollen, bis der neu gestartete Prozess antwortet,
bevor der Admin-Count geprüft wird; bei Timeout `logs api` ausgeben.

## Minor Findings

| # | Bereich | Befund |
|---|---------|--------|
| 1 | `local-admin.bootstrap.spec.ts` | Spec nutzt das bekannte Passwort `correct horse battery staple` aus dem xkcd-Comic – besser synthetischen, nicht publik bekannten Wert verwenden. |
| 2 | `apps/api/nest-cli.json` / `tsconfig.json` | Der verschachtelte Ausgabepfad `dist/apps/api/src/main.js` ist ohne Erklärung; Kommentar mit Begründung ergänzen. |
| 3 | Build-Artefakte | Specs/`__tests__` werden in `dist` mitkompiliert; `tsconfig.build.json` (exclude `**/*.spec.ts`, `**/__tests__/**`) einführen und `build`-Skript darauf zeigen lassen (api + worker). |
| 4 | `apps/web/package.json` | `docker-start`-Skript wird nirgends mehr referenziert (Compose nutzt den direkten node-Aufruf) – tote Konfiguration entfernen. |
| 5 | `Dockerfile` | `/app/.npmrc` (`verify-deps-before-run=false`) und das appuser-`corepack prepare` sind obsolet, da zur Laufzeit nur noch `node`/`npx` verwendet werden; `.npmrc` erzeugt zudem `npm warn Unknown project config` in den api/worker-Logs. |
| 6 | `scripts/compose-smoke-test.sh` Schritt 7 | Es wird nicht geprüft, dass das gespeicherte Passwort ein bcrypt-Hash (und kein Klartext) ist. |
| 7 | `identity.module.ts` | Das `onModuleInit`-Verhalten (Throw bei fehlender Auth-Methode, Bootstrap-Aufruf) ist ungetestet – `identity.module.spec.ts` fehlt. |
| 8 | `local-admin.bootstrap.ts` | `LOCAL_ADMIN_EMAIL` wird ungetrimmt als `user.email` gespeichert; getrimmt speichern, damit E-Mail und normalisierter Identifier konsistent bleiben. |

## Fazit

Keine Critical-/High-Befunde; die zwei Medium-Findings und die acht
Minor-Findings müssen vor dem Commit behoben werden.
