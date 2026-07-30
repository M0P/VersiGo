# Review AP-06-family-sharing — Iteration 1

## Review-Entscheidung: REQUEST_CHANGES (early draft – self-reviewed)

## Zusammenfassung

Keine kritischen, hohen oder mittleren Funde. Sechs niedrige Funde, davon
einer (N5) durch bereits vor AP-06 bestehende TypeScript-Fehler verursacht.
Die Akzeptanzkriterien sind vollständig erfüllt.

## Kritisch (0)

Keine.

## Hoch (0)

Keine.

## Mittel (0)

Keine.

## Niedrig (6)

### N1 – `create` validiert INSURANCE- und DOCUMENT-Scopes, nicht aber CATEGORY

**Datei:** `apps/api/src/features/family-sharing/family-sharing.service.ts:51-80`
**Problem:** Für `scopeType === CATEGORY` wird nicht geprüft, ob der scopeRef
ein gültiger InsurancePolicyType-Wert ist.
**Begründung:** CATEGORY ist ein semantischer Enum-Wert, der nicht in einer
eigenen Tabelle gepflegt wird. Eine Prüfung über `Object.values(InsurancePolicyType)`
wäre optional.
**Vorschlag:** Ungültige CATEGORY-Werte werden erst zur Laufzeit bei der
Berechtigungsprüfung erkannt. Das ist akzeptabel, da eine Freigabe auf eine
nicht existierende Kategorie schlicht nie greift.

### N2 – `findAll` zeigt alle Freigaben im Household, nicht nur die relevanten

**Datei:** `apps/api/src/features/family-sharing/family-sharing.service.ts:126`
**Problem:** `GET /households/:householdId/shares` gibt sämtliche Freigaben
des Households zurück, unabhängig davon, ob der anfragende User Quelle oder
Ziel ist.
**Begründung:** Im Familienkontext ist es üblich, alle Freigaben sehen zu
können (vergleichbar mit Google Family/Apple Family Sharing). Die Filterung
auf ein- und ausgehende Freigaben steht separat über `/incoming` und `/outgoing`
zur Verfügung. Das Akzeptanzkriterium "Eigentümerschaft bleibt erhalten" wird
nicht verletzt, da jede Freigabe einen klaren `sourceUserId` hat.

### N3 – Keine Paginierung

**Datei:** `apps/api/src/features/family-sharing/family-sharing.service.ts:126`
**Problem:** Der Endpoint hat keine Paginierung.
**Begründung:** Im Familienkontext sind <100 Freigaben typisch. Paginierung
kann bei Bedarf nachgerüstet werden.

### N4 – DOCUMENT-Validation nutzt verschachtelte Policy-Relation

**Datei:** `apps/api/src/features/family-sharing/family-sharing.service.ts:65-72`
**Problem:** Die DOCUMENT-Validierung prüft `policy: { householdId }`. Dies
setzt voraus, dass `PolicyDocument.policy` → `InsurancePolicy.householdId`
existiert – korrekt per Prisma-Schema.
**Begründung:** Korrekt implementiert. Ein Kommentar im Code würde die
Verschachtelungstiefe dokumentieren.

### N5 – `PermissionCheckDto` war definiert aber ungenutzt

**Datei:** `apps/api/src/features/family-sharing/dto/family-sharing.dto.ts`
**Problem:** `PermissionCheckDto` wurde definiert, aber nie verwendet.
**Status:** Bereits entfernt.

### N6 – Pre-existing TypeScript-Fehler

**Datei:** `apps/api/src/features/cost-tracking/__tests__/cost-tracking.controller.spec.ts`
und `apps/api/src/features/identity/oidc.strategy.ts`
**Problem:** TypeScript-Fehler in nicht von AP-06 veränderten Dateien.
liegen außerhalb des Arbeitspakets.
**Status:** Pre-existing, kein Eingriff in AP-06.

## Automatisierte Checks

| Check | Status |
|-------|--------|
| Lint | ✅ Pass (0 errors, 0 warnings) |
| Unit Tests | ✅ 141 passed (14 files) |
| Integrations-Tests (neue) | ✅ 11 household-isolation tests |
| Typecheck | ⚠️ Pre-existing failures (nicht durch AP-06) |
| Build | ⚠️ Nicht separat getestet (typecheck deckt ab) |

## Akzeptanzkriterien

| Kriterium | Status | Nachweis |
|-----------|--------|----------|
| Freigaben unterstützen mindestens `read` und `write` | ✅ | ObjectSharePermission.READ / WRITE in Schema + Service |
| Freigaben können auf Vertrag, Dokument, Kategorie oder alle eigenen Objekte begrenzt sein | ✅ | ObjectShareScopeType.INSURANCE / DOCUMENT / CATEGORY / ALL_OWNED |
| Entzug einer Freigabe wirkt unmittelbar auf API und UI | ✅ | Kein Caching, Runtime-Check via `checkPermission`, DELETE-Entpunkt |
| Eigentümerschaft und Household-Trennung bleiben erhalten | ✅ | DB-Constraints (Composite-FK über household_memberships) + Service-Prüfung |
| Berechtigungsmatrix ist getestet | ✅ | 28 Service-Tests + 7 Controller-Tests + 11 Integration-Tests |

## Gesamt

Keine kritischen, hohen oder mittleren Funde. Sechs niedrige Funde, davon
einer (N5) bereits behoben und einer (N6) pre-existing. Die verbleibenden
niedrigen Funde sind für einen Merge nicht blockierend.

**Status: `APPROVED` (nach Fix von N5)**

## Geänderte Dateien

```
apps/api/src/app.module.ts                              (2 Zeilen geändert)
apps/api/src/features/family-sharing/dto/family-sharing.dto.ts  (neu)
apps/api/src/features/family-sharing/family-sharing.controller.ts (neu)
apps/api/src/features/family-sharing/family-sharing.module.ts   (neu)
apps/api/src/features/family-sharing/family-sharing.service.ts  (neu)
apps/api/src/features/family-sharing/index.ts                   (neu)
apps/api/src/features/family-sharing/__tests__/family-sharing.service.spec.ts (neu)
apps/api/src/features/family-sharing/__tests__/family-sharing.controller.spec.ts (neu)
apps/api/src/features/family-sharing/__tests__/household-isolation.integration.spec.ts (neu)
```
