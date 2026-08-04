# BugFix-05: Feature-Konfiguration über die UI (inkl. Family-Sharing), Portal-URL-Normalisierung, Kosten-Anzeige je Versicherung, unendliche Loading-Spinner, Signout-Button sichtbar, Tab-Reload beim Versicherungswechsel

## Kontext

Nach Abschluss von BugFix-04 (Commit `09e680b`) wurde manuelles Testing auf Ports 2475 (Web) / 2473 (API) durchgeführt (`.env.test-manual`, Login `localadmin` / `CHANGE_ME_FOR_LOCAL_DEVELOPMENT`). Dabei traten acht benutzersichtbare Probleme sowie ein CI/Docker-Produktions-Build-Fehler auf (Befund 9). Befund 9 wurde in dieser Session vollständig umgesetzt und verifiziert; die Befunde 1–8 sind noch offen.

## Befunde

### 1. Features (KI-Assistent, OIDC, …) lassen sich nicht über die UI ein-/ausschalten und konfigurieren

**Ist-Zustand (verifiziert):**

- `AI_ENABLED`, `AI_PROVIDER`, `AI_OLLAMA_BASE_URL`, `AI_OLLAMA_MODEL`, `AI_OPENAI_COMPAT_*`, `AI_EXTRACTION_TIMEOUT_MS`, `AI_MAX_RETRIES` sind `runtime`-Kategorie und über die Roh-Schlüssel-Tabelle `/admin/settings` setzbar (verifiziert: `PUT /admin/system-config/AI_ENABLED` mit `{"value":"true"}` → 200, `source=UI`, `effectiveValue=true`). Es fehlt jedoch eine **benutzerfreundliche Feature-Verwaltung**; der Anwender muss die kryptischen Schlüsselnamen kennen.
- `OIDC_ENABLED`, `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_CALLBACK_URL` sind `bootstrap`-Kategorie (`packages/foundation/src/config/settings-catalog.ts` Z. 401–435) → **keine UI-Änderung möglich**:
  - `PUT /admin/system-config/OIDC_ENABLED` → **403 Forbidden** ("nur ueber Environment/Compose setzbar", `system-config.service.ts` `assertUiConfigurable` Z. 281–285).
  - `GET /admin/system-config` listet **keine** OIDC-Schlüssel (nur 15 Einträge).
  - OIDC-Strategie wird beim Boot initialisiert (`oidc.strategy.ts` `onModuleInit` → `discoverClient()`), Identity-Modul hat Fail-Fast ohne Auth-Methode (`identity.module.ts` Z. 44–54).
- **Inkonsistente Capability-Auflösung:** `CapabilityFlagsService` (`packages/foundation/src/capabilities/capability-flags.service.ts`) liest `config.get('AI_ENABLED'|'OIDC_ENABLED'|…)` = Env-Snapshot (`AppConfigService` = `parseAppConfig(process.env)`), **nicht** den Settings-Resolver (UI > ENV > DEFAULT). Dagegen liest `ai-assist.service.ts` Z. 25 `settings.getEffectiveBoolean('AI_ENABLED')` (Resolver, ehrt UI-Werte). Folge: Ein per UI gesetzter Wert erreicht `capabilities.isEnabled('ai')`/`snapshot()` nicht.
- **Tote Feature-Flags-UI:** `/admin/feature-flags`-Seite + `FeatureFlagsService` (Tabelle `GlobalFeatureFlag`/`global_feature_flags`) existieren, aber **nichts konsumiert die Flags** (nur `admin-settings`-Feature deklariert den Service; keine andere Stelle liest sie). Angelegte Flags haben keinerlei Wirkung → irreführend.
- `/admin/integrations` bietet nur Connectivity-Tests (Paperless/Storage), kein Enable/Disable.

**Erwartung:**

- Admin kann optionale Features (KI-Assistent, OIDC, Paperless, Storage) über die UI **ein-/ausschalten und konfigurieren**:
  - KI: Ein/Aus-Toggle + Provider/Modell/URLs/API-Key/Timeout/Retries (runtime, wirkt sofort).
  - OIDC: Ein/Aus-Toggle + Issuer-URL/Client-ID/Client-Secret/Callback-URL. Dafür müssen die OIDC-Schlüssel von `bootstrap` in eine UI-konfigurierbare Kategorie wechseln (z. B. `restart` mit vorhandenem `pendingRestartValue`-Mechanismus bzw. `preloadRestartSettingsIntoEnv`) oder über einen dedizierten OIDC-Konfigurationsbereich gesetzt werden, der beim nächsten Start wirksam wird. Fail-Fast-Logik darf dabei nicht ausgelöst werden, solange Local Auth aktiv ist.
  - Paperless: Ein/Aus + URL + API-Token (secret).
  - Storage: Ein/Aus (restart).
- `CapabilityFlagsService` muss UI-Overrides widerspiegeln (über den Settings-Resolver auflösen statt Env-Snapshot), damit Toggles überall konsistent wirken (Auth-Config, Monitoring, OIDC-Strategie, AI-Provider-Registry).
- Feature-Flags-Seite entweder mit echter Wirkung verdrahten oder entfernen (keine tote UI).
- Alle neuen Strings in `en.ts` + `de.ts` (Parität), ADMIN-Berechtigung.

### 2. Portal-URL soll `https://` automatisch ergänzen, wenn es fehlt

**Ist-Zustand (verifiziert):**

- Web-Formular `apps/web/src/app/policies/[id]/portal-links-tab.tsx` Z. 150–155: Eingabefeld `type="url"`, `portalUrl` wird roh gesendet.
- API-DTO (`policy-registry.dto.ts` Z. 209, 248): `@IsUrl({ protocols: ['http', 'https'], require_protocol: true })` → Eingabe `www.portal.de` ohne Schema wird mit 400 abgelehnt.
- `portal-connector.service.ts` `parseHttpUrl` (Z. 154ff) reicht nur http(s)-URLs durch.

**Erwartung:**

- Gibt der Benutzer eine Portal-URL ohne Schema ein (z. B. `portal.versicherung.de`), wird automatisch `https://` vorangestellt – sowohl clientseitig vor dem Absenden (portal-links-tab) als auch serverseitig per DTO-Transform als Defense-in-Depth.
- Die Sicherheitsvalidierung bleibt: nur `http`/`https` (kein `javascript:`/`data:`), maximales URL-Längenlimit.

### 3. Kosten je Versicherung anzeigen: bisher gezahlt + jährlich/monatlich (abhängig von der Einstellung)

**Ist-Zustand (verifiziert):**

- Policy-Detail (`apps/web/src/app/policies/[id]/page.tsx`) zeigt im Master-Data-Tab nur die Rohfelder `premiumAmount`/`premiumCurrency`/`paymentFrequency` der Police – **nicht** die Cost-Tracking-Einträge.
- Der Costs-Tab im Policy-Detail ist nur ein Link-Card-Button auf `/policies/[id]/costs` (Z. 209–226) – keine eingebettete Kostenübersicht.
- Kosten-Seite (`/policies/[id]/costs`): lädt `/costs/annual` (annualGross/annualNet auf Basis des aktuellsten Eintrags) + Eintragsliste; **keine "bisher gezahlt"-Summe** (kein `sumPaid`/`paidToDate`/`toDate`-Endpunkt existiert).
- Household-Übersicht (`/household/costs`) aggregiert nur über alle Policies (`totalAnnualGross`, `perType`).

**Erwartung:**

- Auf **jeder Versicherung** werden die Kosten angezeigt (mindestens im Costs-Tab des Policy-Detail, idealerweise auch als kompakte Karte im Detail):
  - **Bisher gezahlte Kosten** (Summe der bereits fälligen Beträge bis heute, basierend auf `validFrom`/`validTo` und `frequency` der Cost-Entries; bei `MONTHLY`/`QUARTERLY`/`SEMI_ANNUAL`/`ANNUAL` anteilig).
  - **Jährliche und monatliche Kosten** – abhängig von der Zahlungsfrequenz-Einstellung der Police (`paymentFrequency` bzw. `frequency` des aktiven Cost-Entry): zeigt z. B. Monatsbetrag bei `MONTHLY`, Jahresbetrag immer, Quartalsbetrag bei `QUARTERLY` usw.
- Dafür ist ein neuer/erweiterter API-Endpunkt nötig (z. B. `GET /costs/overview` mit `annualGross`, `annualNet`, `paidToDate`, `perFrequency`-Beträgen) – nicht nur `annual`.
- i18n für alle neuen Strings (en + de).

### 4. Unendlicher Loading-Spinner in der Versicherungsansicht (besonders bei leeren Masken und beim Anlegen von Einträgen)

**Ist-Zustand (Root Cause gefunden, verifiziert):**

- `covered-persons-tab.tsx`: `const [loading, setLoading] = useState(true)` (Z. 26), `loadPersons()` wird **nur** in `handleSubmit`/`handleDelete` aufgerufen (Z. 86, 112), aber **nie beim Mount** (kein `useEffect`). Öffnet man den Tab bei leerer Liste, bleibt `loading === true` → unendlicher Spinner (Z. 153–156).
- Gleiches Muster in `documents-tab.tsx` (`loadDocuments()` nur in Handlern, kein Mount-Effekt) und `portal-links-tab.tsx` (`loadLinks()` nur in Handlern, kein Mount-Effekt).
- Beim Anlegen eines Eintrags wird zwar `load…()` aufgerufen, aber die Leerzustands-Anzeige (EmptyState) erscheint wegen fehlenden Mount-Loads nie zuverlässig.

**Erwartung:**

- Jeder Tab ruft seine Lade-Funktion beim Mount auf (`useEffect(() => { load…(); }, [policyId])`), mit Abbruch-Guard (`cancelled`) und 401-Redirect.
- Jeder Loading-Zustand **terminiert**: `loading === false` in jedem Pfad (Erfolg, Leerzustand, Fehler). Leere Daten → EmptyState; Fehler → Fehlermeldung.
- Audit aller `Loading`/`InlineSpinner`-Verwendungen in `apps/web/src/app/policies/**` und `apps/web/src/app/household/**` auf Terminierung (kein Zustand, in dem `loading` nie auf `false` gesetzt wird).

### 5. Signout-Button im Menü immer am unteren Rand des sichtbaren Bildschirms

**Ist-Zustand (Root Cause gefunden):**

- `app-shell.tsx` Z. 215–220 rendert den Abmelden-Button innerhalb der Sidebar als `nav-item-logout`; CSS `.nav-item-logout { margin-top: auto; }` (`globals.css` Z. 889–901) pinnt ihn ans Ende der Flex-Spalte.
- Die Sidebar ist aber eine Flex-Spalte mit `overflow-y: auto` (`globals.css` Z. 815–826) und der Container `.app-shell` hat nur `min-height: 100vh` (Z. 809–812). Übersteigt der Inhalt (Logo + Sektionen + Logout) die Viewport-Höhe, wächst die Sidebar über den sichtbaren Bereich und `margin-top: auto` pinnt den Button ans Ende des *Inhalts* – nicht an den sichtbaren Bildschirmrand. Der Button rutscht unter den Fold und ist erst nach Scrollen erreichbar.
- Mobil-Drawer hat zusätzlich `padding-top: var(--versigo-space-16)` (Z. 1113) und `inset: 0` (Z. 1107–1108) – gleicher Effekt.

**Erwartung:**

- Der Signout-Button ist **immer** am unteren Rand des sichtbaren Bildschirms sichtbar, ohne Scrollen – Desktop-Sidebar und Mobil-Drawer.
- Umsetzung z. B.: Sidebar auf `height: 100dvh` (Desktop) fixieren; die Navigationssektionen in einen eigenen scrollbaren Bereich legen (`overflow-y: auto` nur im mittleren Bereich); Logout als festes Footer-Element unterhalb des scrollbaren Bereichs. Kein Layout-Bruch bei READ_ONLY (weniger Items) und bei langen Sektionslisten (Admin).

### 6. Feature-Toggle für Family-Sharing fehlt

**Ist-Zustand (verifiziert):**

- Family-Sharing ist **immer aktiv**, es gibt keinen Schalter:
  - Kein `FAMILY_SHARING_ENABLED` in `packages/foundation/src/config/app-config.schema.ts` (dort nur `STORAGE_ENABLED`, `LOCAL_AUTH_ENABLED`, `OIDC_ENABLED`, `AI_ENABLED`, `PAPERLESS_ENABLED`).
  - `CapabilityFlagsService` kennt nur `'oidc' | 'local' | 'ai' | 'paperless' | 'storage'` (capability-flags.service.ts Z. 4) – kein Family-Sharing-Key.
  - Kein Eintrag im Settings-Katalog (`settings-catalog.ts`).
  - API: `family-sharing.controller.ts` (`/households/:householdId/shares`, CRUD) ist nur über `HouseholdMembershipGuard` + `@Roles` geschützt – ohne Feature-Check immer erreichbar.
  - UI: Nav-Eintrag `nav.shares` ("Familien-Freigaben", `/household/shares`) ist in `nav-config.ts` Z. 31 immer sichtbar.

**Erwartung:**

- `FAMILY_SHARING_ENABLED` als Feature-Toggle in derselben Feature-Verwaltung wie Befund 1 (Default: true, damit Bestandsverhalten erhalten bleibt).
- Bei Deaktivierung: API-Endpunkte des Family-Sharing liefern 403/404 (oder das Modul/Controller ist abgeschaltet), der UI-Nav-Eintrag `/household/shares` wird ausgeblendet, `CapabilityFlagsService.snapshot()` enthält den neuen Key.
- i18n en + de, ADMIN-Berechtigung; Dokuments (ui-control-matrix, 09-ai-agent-implementation-plan, security/privacy) konsistent.

### 7. Kosten-Übersicht zeigt nur den Versicherungstyp, nicht die Kosten je Versicherung

**Ist-Zustand (verifiziert):**

- `/household/costs` (`apps/web/src/app/household/costs/page.tsx` Z. 92–109) zeigt eine Tabelle mit **nur zwei Spalten**: Typ und jährliche Kosten (aggregiert über `summary.perType`). Pro Versicherung ist keine Kostenzeile vorhanden.
- API `GET /households/:householdId/costs/summary` → `getHouseholdSummary` (`cost-tracking.service.ts` Z. 370–440) liefert nur `{ totalAnnualGross, perType, policyCount }` – keine per-Policy-Daten (Name, Typ, Betrag je Versicherung).

**Erwartung:**

- In der Kosten-Übersicht wird **jede Versicherung einzeln** mit ihren Kosten gelistet (Tabelle mit Spalten: Versicherung (Name + Typ), Kosten je Jahr, je Frequenz (monatlich/quartalsweise/halbjährlich je nach Einstellung) und – passend zu Befund 3 – bisher gezahlt).
- API: `getHouseholdSummary` (oder neuer Endpoint) liefert zusätzlich ein `policies`-Array mit `id`, `name`, `type`, `annualGross`, `perFrequency`-Beträgen und `paidToDate` (dieselbe Berechnungslogik wie Befund 3 wiederverwenden, kein Duplikat).
- READ_ONLY-Berechtigung respektieren (nur explizit freigegebene Policies, wie bisher in `getHouseholdSummary`).
- i18n en + de; Mobile-Darstellung der Tabelle bleibt funktional (data-label-Karten).

### 8. Tab-Inhalte werden beim Wechsel zwischen Versicherungen nicht neu geladen (leere/stale Ansichten)

**Ist-Zustand (Root Cause gefunden, verifiziert):**

- Benutzerbericht: Dokument hochgeladen → zu anderer Versicherung gewechselt → ursprüngliche Versicherung erneut geöffnet → Dokumenten-Ansicht **leer**; erst das Anlegen eines **zweiten** Dokuments zeigte das erste an. Gleiches gilt für Portal-Links und "andere Ansichten einer Versicherung" (Covered Persons).
- `page.tsx` (Z. 65–83) ist ein Client-Component, das bei Navigation `/policies/A` → `/policies/B` **gemountet bleibt** (Next.js App Router: gleiches Routen-Segment, nur `useParams().id` ändert sich). Die Tabs erhalten `policyId` als Prop.
- `covered-persons-tab.tsx`, `documents-tab.tsx` (Z. 40–53) und `portal-links-tab.tsx` haben **keinen Mount-`useEffect` und kein `useEffect` mit `[policyId]`-Dependency** – ihre Lade-Funktionen werden nur in Submit/Delete-Handlern aufgerufen (z. B. `documents-tab.tsx` Z. 81/97).
- Folgen beim Wechsel:
  - Bleibt der Tab gemountet (Versicherung A → B bei aktivem Tab), wird der State **nicht zurückgesetzt** und nicht neu geladen → die Daten von Versicherung A erscheinen unter B (stale Daten) bzw. nach einem Full-Page-Reload/Remount bleibt `loading=true` (unendlicher Spinner, vom Nutzer als "leer" wahrgenommen).
  - Nach einem Remount lädt nur eine Nutzeraktion (z. B. zweites Dokument anlegen → `handleSubmit` → `loadDocuments()`) die Daten – deshalb erschien das erste Dokument erst nach dem Anlegen des zweiten.
- Gegenbeispiel (funktioniert korrekt): `coverage-summary-section.tsx` hat `useEffect(…, [householdId, policyId, t])` mit `cancelled`-Guard.

**Erwartung:**

- Jeder Tab (Covered Persons, Documents, Portal Links) lädt beim Mount **und** bei jeder `policyId`-Änderung neu: `useEffect(() => { load…(); }, [policyId])` mit Abbruch-Guard (`cancelled`) und 401-Redirect.
- Beim `policyId`-Wechsel wird der State **zurückgesetzt** (Daten = `[]`, `error = null`, `loading = true`), damit keine Daten der vorherigen Versicherung angezeigt werden (keine stale Ansichten, kein Fremddaten-Leak in der UI).
- Jeder Loading-Zustand terminiert in jedem Pfad; die Anzeige zeigt nach dem Wechsel sofort die Daten der **aktuellen** Versicherung.

### 9. Docker-Produktions-Build (api/worker) schlägt in CI fehl (TS2307 in @versigo/foundation)

**Ist-Zustand (verifiziert, CI-Log `compose-smoke` / GitHub Actions):**

- `docker compose build api web worker` bricht im Worker-Build ab (`[worker build 9/9] RUN pnpm exec prisma generate … && pnpm run build --filter @versigo/worker`):
  - `@versigo/foundation:build: $ tsc -p tsconfig.json` → **TS2307** "Cannot find module '@nestjs/common' / 'zod' / 'vitest' / '@nestjs/bullmq' / 'ioredis'" + **TS7006** (implicit any) in `app-config.schema.ts`.
  - pnpm-Warnung: `[WARN] Local package.json exists, but node_modules missing, did you mean to install?` → `packages/foundation/node_modules` fehlt im Build-Stage.
  - `[ELIFECYCLE] Command failed with exit code 2`, `target worker: failed to solve`; api/web-Builds wurden **CANCELED** (Kaskade). `prisma generate` selbst lief durch (Virtual Store vorhanden).
- **Root Cause (in dieser Session verifiziert):**
  - `apps/api/Dockerfile` und `apps/worker/Dockerfile` installieren im `deps`-Stage **gefiltert**: `pnpm install --frozen-lockfile --filter @versigo/<app>... --prod=false`. pnpm legt dabei die Dependencies in die **Paket-eigenen** `node_modules` (`apps/<app>/node_modules`, `packages/foundation/node_modules`) und verlinkt sie in den Virtual Store (`node_modules/.pnpm`) – **nicht** in die Wurzel-`node_modules`.
  - Der Build-Stage ist `FROM base AS build` und kopiert **nur** `/app/node_modules` (Wurzel) sowie die Quellcode-Verzeichnisse (der Build-Kontext enthält kein `node_modules`, `.dockerignore`). Die Paket-`node_modules` werden also **nicht** in den Build-Stage übernommen.
  - Der Build funktionierte bisher nur über das pnpm-NODE_PATH-Hoisting (`node_modules/.pnpm/node_modules` enthält alle transitiven Deps). Dieses ist nicht garantiert: In CI teilen sich die drei parallel gebauten Services (api/web/worker) **eine** Store-Cache-Mount-ID (`versigo-pnpm-store`); ein race-bedingt unvollständiger Install führt genau zu den TS2307-Fehlern.
  - Lokal nicht reproduzierbar (Einzel-Build mit warmem Store); CI ist parallel + kalter Store. Reproduktion mit vollem Fidelity (realer Lockfile, 4-Paket-Workspace, nur Wurzel-`node_modules` kopiert) bestätigt das fehlende `packages/foundation/node_modules`.
- `apps/web/Dockerfile` ist nicht betroffen (kein `@versigo/foundation`-Dependency; ungefiltertes Install).

**Erwartung (Status: umgesetzt + verifiziert in dieser Session):**

- Build-Stages von `apps/worker/Dockerfile` und `apps/api/Dockerfile` kopieren die Paket-`node_modules` aus `deps` mit: `COPY --from=deps /app/apps/<app>/node_modules ./apps/<app>/node_modules` und `COPY --from=deps /app/packages/foundation/node_modules ./packages/foundation/node_modules` → **selbstenthaltene** Kompilierung, unabhängig vom NODE_PATH-Hoisting.
- Jede Service-Dockerfile nutzt eine **eigene** Store-Cache-Mount-ID (`versigo-pnpm-store-worker` / `-api` / `-web`) in allen Stufen, die einen Store nutzen (bei api/worker: deps- und prod-deps-Stage; bei web: deps- und build-Stage) → keine geteilte Store-Race mehr bei parallelen CI-Builds.
- Verifiziert: `docker compose build --no-cache worker api web` (kalt) erfolgreich (turbo `Tasks: 2 successful` – foundation + App-`tsc`); voller Compose-Testlauf grün (Lint/Typecheck/Test/i18n-Guard); `scripts/compose-smoke-test.sh --build` grün (alle Schritte inkl. Produktions-Erfolgspfad).
- Keine neue Laufzeit-Abhängigkeit, kein neuer Port/Service; BugFix-06 (Release-Verifikation der Image-Größen) bleibt eigenes Paket.

## Auswirkungen

- Feature-Konfiguration (KI, OIDC, Paperless, Storage) ist ohne UI nicht bedienbar; OIDC ist komplett nur über Compose konfigurierbar.
- Portal-Links mit "sauberer" URL ohne Schema schlagen fehl (UX-Bruch).
- Kosten werden pro Versicherung nicht angezeigt, "bisher gezahlt" fehlt komplett; die Kosten-Übersicht listet nur Typen, keine einzelnen Policen.
- Leere Tabs (Covered Persons, Documents, Portal Links) zeigen unendliche Spinner; das blockiert den Eindruck einer funktionierenden App.
- Der Signout-Button ist bei langen Menüs nicht ohne Scrollen erreichbar.
- Family-Sharing lässt sich nicht deaktivieren (kein Datenschutz-Schalter für Haushaltsfreigaben).
- Beim Wechsel zwischen Versicherungen zeigen die Tabs leere oder Daten der vorherigen Versicherung; Daten erscheinen erst nach einer erneuten Nutzeraktion.
- Der Docker-Produktions-Build (api/worker) schlägt in CI fehl → Release-Gate `compose-smoke` ist blockiert.

## Nächste Schritte (Scope für BugFix-05)

1. **Feature-Konfiguration über die UI** – Feature-Verwaltung (mindestens für KI-Assistent und OIDC, idealerweise auch Paperless/Storage) in der Admin-Oberfläche; OIDC-Schlüssel von `bootstrap` auf UI-konfigurierbar (restart) umstellen; `CapabilityFlagsService` auf Settings-Resolver umstellen; tote Feature-Flags-Seite verdrahten oder entfernen.
2. **Portal-URL-Normalisierung** – `https://` ergänzen, falls Schema fehlt (Client + Server-Transform), Sicherheitsvalidierung beibehalten.
3. **Kosten-Anzeige je Versicherung** – neuer Übersichts-Endpunkt (`paidToDate`, Jahres-/Monats-/Frequenz-Beträge) + UI-Anzeige im Policy-Detail/Costs-Tab.
4. **Loading-Spinner fixen** – Mount-Load-Effekte in den drei Tabs ergänzen, Loading-Terminierung auditieren.
5. **Signout-Button fixieren** – Sidebar auf `100dvh` fixieren, Navigation scrollt intern, Logout als sichtbares Footer-Element (Desktop + Mobil-Drawer).
6. **Family-Sharing-Toggle** – `FAMILY_SHARING_ENABLED` in Feature-Verwaltung (Default true), Capability-Key + API-Guard + Nav-Ausblendung + Doku.
7. **Kosten-Übersicht je Police** – `getHouseholdSummary` um `policies`-Array erweitern, Tabelle in `/household/costs` listet jede Versicherung mit Kosten-Spalte(n).
8. **Tab-Reload bei Versicherungswechsel** – `useEffect` mit `[policyId]`-Dependency + State-Reset in den drei Tabs (gehört technisch zu Schritt 4, wird aber separat verifiziert).
9. **Docker-Produktions-Build reparieren** – Paket-`node_modules` in die Build-Stages von api/worker kopieren + eigene Store-Cache-Mount-ID je Service (**in dieser Session umgesetzt und verifiziert**, nur noch Review/Commit).

## Akzeptanzkriterien für BugFix-05

- **KI-Feature:** Admin kann in der Web-UI `AI_ENABLED` ein-/ausschalten und Provider/Modell/URLs speichern; Änderung wirkt sofort (kein Neustart), `GET /admin/system-config` zeigt `source=UI`; `CapabilityFlagsService.snapshot()` spiegelt den UI-Wert (Resolver-basiert).
- **OIDC-Feature:** Admin kann OIDC über die UI ein-/ausschalten und Issuer/Client-ID/Secret/Callback speichern (kein 403 mehr); nach Neustart ist OIDC aktiv (Strategie initialisiert, `/auth/config` meldet `oidcEnabled: true` bei funktionierender Discovery); Fail-Fast tritt nicht auf, solange Local Auth aktiv ist. Geheimnisse werden maskiert und verschlüsselt gespeichert.
- **Feature-Flags-Seite:** keine tote UI mehr (entweder funktional verdrahtet oder entfernt inkl. Modell/Navigation).
- **Portal-URL:** `www.portal.de` wird als `https://www.portal.de` gespeichert; `http://…` bleibt unverändert; `javascript:…` wird weiterhin abgelehnt.
- **Kosten:** Policy-Detail/Costs-Tab zeigt je Versicherung Jahres- und Monatskosten (abhängig von der Frequenz-Einstellung) sowie "bisher gezahlt" (korrekt anteilig pro Frequenz bis heute); neue i18n-Keys en + de.
- **Kosten-Übersicht:** `/household/costs` listet jede Versicherung einzeln (Name + Typ) mit Kosten-Spalte(n) (Jahr + Frequenzbetrag + bisher gezahlt); READ_ONLY sieht nur freigegebene Policen.
- **Spinner:** Covered Persons / Documents / Portal Links Tabs laden beim Mount; leere Listen zeigen EmptyState statt Spinner; nach dem Anlegen eines Eintrags wird die Liste aktualisiert und kein Spinner bleibt hängen.
- **Tab-Reload:** Beim Wechsel von Versicherung A zu B und zurück zeigt jeder Tab sofort die Daten der aktuellen Versicherung (keine stale Daten von A unter B, keine leeren Ansichten); nach Upload eines Dokuments und erneutem Öffnen der Versicherung ist das Dokument ohne weitere Aktion sichtbar. Verifikation wie im Benutzerbericht (Upload → Wechsel → zurück → Dokument sichtbar).
- **Signout:** Der Abmelden-Button ist in der Desktop-Sidebar und im Mobil-Drawer ohne Scrollen immer am unteren Rand des sichtbaren Bildschirms sichtbar (auch bei Admin mit vielen Nav-Items und bei READ_ONLY).
- **Family-Sharing-Toggle:** `FAMILY_SHARING_ENABLED` ist in der Feature-Verwaltung umschaltbar (Default true); bei `false` liefern alle `/households/:householdId/shares`-Endpunkte 403/404 und der Nav-Eintrag `/household/shares` ist ausgeblendet; `CapabilityFlagsService.snapshot()` enthält den Key.
- `pnpm run lint`, `pnpm run typecheck`, `pnpm run test` (737+ Tests) und der i18n-Guard (`pnpm --filter @versigo/web run test:i18n`) laufen fehlerfrei.
- **Docker-Produktions-Build:** `docker compose build api web worker` läuft in CI durch (kein TS2307 in `@versigo/foundation`), lokale Gegenprüfung mit `docker compose build --no-cache worker api web` erfolgreich. (In dieser Session umgesetzt und verifiziert.)
- Keine Regression in den BugFix-04-Features (Audit/Monitoring/Export, Policy-Source-i18n).
- Review-Loop wie üblich: `@code-reviewer` pro Iteration, Befunde verbatim unter `docs/reviews/BugFix-05-review-N.md`, 0 Critical / 0 High / 0 Medium / ≤ 8 Minor.

## Nicht in BugFix-05 (spätere Pakete)

- Neue Features (Notifier, Playwright-E2E, …)
- BugFix-06: Release-Verifikation der BugFix-04-Docker-Optimierungen (Fresh-Clone-Compose, `scripts/compose-smoke-test.sh --build`, Image-Größen ≤ 520/520/230 MB) – **eigenes Paket, nicht hier.**

## Referenzen

- Feature-Katalog: `packages/foundation/src/config/settings-catalog.ts` (OIDC_* Z. 401–435 bootstrap; AI_* Z. 64ff runtime)
- API-Durchsetzung: `apps/api/src/features/system-config/system-config.service.ts` (`assertUiConfigurable` Z. 274–287)
- Capability-Flags: `packages/foundation/src/capabilities/capability-flags.service.ts`
- Restart-Preload: `packages/foundation/src/config/settings-preload.ts` (`preloadRestartSettingsIntoEnv`)
- OIDC-Strategie/Fail-Fast: `apps/api/src/features/identity/oidc.strategy.ts`, `identity.module.ts`
- Feature-Flags (tot): `apps/api/src/features/admin-settings/feature-flags.service.ts`, `prisma/schema.prisma` (`GlobalFeatureFlag` Z. 220–228), `apps/web/src/app/admin/feature-flags/page.tsx`
- Portal-URL: `apps/web/src/app/policies/[id]/portal-links-tab.tsx`, `apps/api/src/features/policy-registry/dto/policy-registry.dto.ts` (Z. 209/248), `apps/api/src/features/portal-connectors/portal-connector.service.ts` (`parseHttpUrl`)
- Kosten: `apps/api/src/features/cost-tracking/` (Controller/Service, `FREQUENCY_MAP`, `getHouseholdSummary` Z. 370–440), `apps/web/src/app/policies/[id]/costs/page.tsx`, `apps/web/src/app/household/costs/page.tsx` (Z. 92–109, nur `perType`-Tabelle)
- Spinner: `apps/web/src/app/policies/[id]/covered-persons-tab.tsx` (Z. 26/38–49/86/112/153–156), `documents-tab.tsx` (Z. 29/40–53/81/97/162–169), `portal-links-tab.tsx` (Z. 28/41–54), `apps/web/src/components/ui/loading.tsx`
- Tab-Reload: `apps/web/src/app/policies/[id]/page.tsx` (Client-Component bleibt bei `/policies/A` → `/policies/B` gemountet, Z. 65–83; `renderTabContent` Z. 102–230), `coverage-summary-section.tsx` (korrektes Muster: `useEffect(…, [householdId, policyId, t])` Z. 69–132)
- Signout: `apps/web/src/components/ui/app-shell.tsx` (Z. 215–220, `nav-item-logout`), `apps/web/src/styles/globals.css` (`app-sidebar` Z. 815–826, `app-shell` Z. 809–812, `.nav-item-logout` Z. 889–901, Mobil-Drawer Z. 1104–1115)
- Family-Sharing: `apps/api/src/features/family-sharing/family-sharing.controller.ts` (nur Membership/Roles-Guard), `packages/foundation/src/config/app-config.schema.ts` (kein FAMILY_SHARING_ENABLED), `packages/foundation/src/capabilities/capability-flags.service.ts` (Key-Set Z. 4), `apps/web/src/components/ui/nav-config.ts` (Z. 31 `nav.shares`)
- Docker-Build (Befund 9): `apps/worker/Dockerfile`, `apps/api/Dockerfile` (Build-Stage `FROM base`, nur Wurzel-`node_modules` kopiert, gefiltertes Install), `apps/web/Dockerfile`, `Dockerfile.test` (CI-proven ungefiltert), `.github/workflows/ci.yml` (`compose-smoke`: `docker compose build api web worker`), `.dockerignore` (`node_modules/` aus Kontext)
