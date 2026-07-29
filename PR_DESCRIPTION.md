# PR: feat(AP-02): identity-access

**Branch:** `feat/AP-02-identity-access` -> `main`
**Merge-Hinweis:** Dieser PR darf NICHT vom erstellenden Modell selbst gemergt werden. Merge erfolgt erst nach unabhaengigem Review und gruener CI (siehe prompts/00-gemeinsame-regeln.md).

## Zweck
Implementierung von OIDC-Login, Benutzerverwaltung, Haushalten, Mitgliedschaften,
Rollen (OWNER/ADMIN/MEMBER/VIEWER) und Session-Schutz gemaess AP-02-identity-access.
Baut auf dem in AP-02.1 geschaffenen Prisma-Schema (oidcIssuer, zusammengesetzte
Fremdschluessel, Household-Mandantentrennung) auf, ohne dieses fachlich zu erweitern.

## Geaenderte / neue Dateien

### Backend (apps/api)
- apps/api/src/features/identity/oidc.strategy.ts (neu)
- apps/api/src/features/identity/auth.service.ts (neu)
- apps/api/src/features/identity/auth.controller.ts (neu)
- apps/api/src/features/identity/auth.guard.ts (neu, SessionAuthGuard + @Public)
- apps/api/src/features/identity/roles.guard.ts (neu)
- apps/api/src/features/identity/roles.decorator.ts (neu, @Roles)
- apps/api/src/features/identity/household-membership.guard.ts (neu)
- apps/api/src/features/identity/current-user.decorator.ts (neu, @CurrentUser)
- apps/api/src/features/identity/dto/user-profile.dto.ts (neu)
- apps/api/src/features/identity/dto/membership.dto.ts (neu)
- apps/api/src/features/identity/identity.module.ts (bearbeitet)
- apps/api/src/features/identity/index.ts (bearbeitet)
- apps/api/src/app.module.ts (bearbeitet: keine strukturelle Aenderung, Guards werden im IdentityModule registriert)
- apps/api/src/main.ts (bearbeitet: express-session + cookie-parser Wiring)
- apps/api/package.json (bearbeitet: neue Abhaengigkeiten)

### Frontend (apps/web)
- apps/web/src/middleware.ts (neu, Session-Cookie-Check)
- apps/web/src/app/(auth)/login/page.tsx (neu)
- apps/web/src/app/(auth)/callback/page.tsx (neu)

### Foundation
- packages/foundation/src/auth/household-role.enum.ts (neu)
- packages/foundation/src/auth/index.ts (neu)

### Dokumentation & Policy
- docs/adr/ADR-005-oidc-session-strategy.md (neu)
- dependency-policy.md (bearbeitet: Maintenance-Pruefung neuer Pakete)
- .env.example (bearbeitet: SESSION_SECRET, OIDC_CALLBACK_URL ergaenzt)

### Tests
- apps/api/src/features/identity/__tests__/auth.service.spec.ts (neu)
- apps/api/src/features/identity/__tests__/roles.guard.spec.ts (neu)
- apps/api/src/features/identity/__tests__/household-membership.guard.spec.ts (neu)
- apps/api/src/features/identity/__tests__/auth.controller.spec.ts (neu)
- apps/api/src/features/identity/__tests__/household-isolation.integration.spec.ts (neu)

## Prisma-Migration
Keine neue Migration erforderlich. Das bestehende Schema aus AP-02.1
(households, users, household_memberships, object_shares, ...) deckt alle
Anforderungen dieses Arbeitspakets bereits vollstaendig ab.

## Nachweis der Akzeptanzkriterien

| Kriterium | Umsetzung |
|---|---|
| OIDC Discovery & Claim-Mapping | OidcStrategy liest Konfiguration vorbereitend aus dem Admin-Settings-Store (AP-02.1); Discovery via openid-client |
| Mandantentrennung auf Household-Ebene | HouseholdMembershipGuard prueft jede :householdId-Route DB-gestuetzt gegen household_memberships |
| Rollen-Durchsetzung (OWNER/ADMIN/MEMBER/VIEWER) | RolesGuard mit hierarchischem Rollenrang, @Roles()-Decorator |
| Session-Schutz | SessionAuthGuard global via APP_GUARD; @Public() fuer Login/Callback; Next.js Middleware fuer UI |
| Tests: Rollen + Isolation | 5 Testdateien, siehe Test-Output unten |

## Test-Output (lokal auszufuehren vor Merge)
```
pnpm install
pnpm turbo run lint test typecheck
```
Erwartetes Ergebnis: alle Pakete gruen. Die beigefuegten Vitest-Suiten decken ab:
- roles.guard.spec.ts: 8 Faelle (Rollenrang OWNER>ADMIN>MEMBER>VIEWER, fehlende Membership, keine Rollen-Anforderung)
- household-membership.guard.spec.ts: 4 Faelle (Isolation, Zugriff erlaubt, kein Param, kein User)
- auth.service.spec.ts: 3 Faelle (Upsert-Schluessel, Membership-Mapping, Issuer-Trennung bei gleichem sub)
- auth.controller.spec.ts: 3 Faelle (/auth/me, Session-Rotation bei Callback, Logout)
- household-isolation.integration.spec.ts: 4 Faelle (zwei Households, symmetrische Isolation)

Hinweis: Die tatsaechliche CI-Ausfuehrung muss durch den Reviewer bzw. die
Pipeline erfolgen; dieser PR liefert die Testdateien und einen definierten
Ausfuehrungsbefehl, kann aber die CI-Umgebung dieses Runs nicht selbst
betreiben.

## Dependency-Pruefung
Siehe dependency-policy.md, Abschnitt "AP-02-identity-access: neu geprüfte
Abhängigkeiten". Zugelassen: openid-client, @nestjs/passport, passport,
express-session, cookie-parser, class-validator, class-transformer.
Explizit verworfen: passport-openidconnect (veraltet), passport-jwt (veraltet).

## Sicherheitsbewertung
- Keine Secrets im Code/Commit/Testdaten; SESSION_SECRET und OIDC_CLIENT_SECRET
  ausschliesslich via .env, Platzhalter in .env.example.
- Session-Cookie: HttpOnly, SameSite=Lax, Secure in Produktion.
- Session-Rotation bei Login verhindert Session-Fixation.
- Mandantentrennung ist doppelt abgesichert: Datenbank-Constraint
  (zusammengesetzter FK auf household_memberships) plus Anwendungs-Guard.
- Rollen werden bei jedem Request frisch aus der DB gelesen, kein
  Rollen-Caching im Cookie/Token, damit Rechteentzug sofort wirkt.
- Nicht authentifizierte Zugriffe auf geschuetzte APIs (SessionAuthGuard)
  und UI-Routen (Next.js Middleware) werden abgewiesen.

## Bekannte Grenzen
- OIDC-Discovery-Konfiguration (Issuer-URL, Claim-Mapping) wird aus dem
  Settings-Store gelesen, dessen Admin-UI erst in einem spaeteren
  Arbeitspaket vollstaendig nutzbar ist; aktuell ueber .env vorbereitet.
- Session-Store ist im aktuellen Setup In-Memory (express-session Default);
  fuer Mehrinstanz-Deployment ist ein Redis-Session-Store nachzuruesten.
- Lokale Ausfuehrung von `pnpm turbo run lint test typecheck` sowie das
  tatsaechliche Anlegen von Branch/PR ueber die GitHub-API konnten in dieser
  Sandbox-Umgebung nicht durchgefuehrt werden; alle Dateien liegen
  vollstaendig und pruefbar im bereitgestellten Artefakt vor.
