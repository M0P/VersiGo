# ADR-009: Multi-Language Support – Sprachspeicherung und i18n-Architektur

## Status
Akzeptiert

## Kontext
AP-21 führt eine zweisprachige Oberfläche (Deutsch/Englisch) ein. Englisch
ist der globale Standard. Es gelten folgende Rahmenbedingungen:

1. **READ_ONLY-Konten** besitzen keine Profil-/Präferenz-Persistenz (kein
   Zugriff auf `PATCH /user/profile` oder die User-Preference-Allowlist –
   dort landete die Sprache bisher als `language`-Präferenz mit dem alten
   Locale-Format `de-DE`/`en-US`).
2. Die Sprache war historisch doppelt abgelegt: als `users.locale`
   (Profil-Locale, Allowlist regionaler Locales) und als
   `UserPreference("language")` – zwei redundante, divergente Pfade.
3. Die Anwendung besitzt keine systemweite Sprache und keine
   Übersetzungsverwaltung; Übersetzungen sind ein reines Web-UI-Thema.
4. Es gibt keine neue API-Abhängigkeit (i18n-Bibliothek), da die Kataloge
   klein sind und typsicher bleiben sollen.

## Entscheidungen

### 1. Sprachcodes `en`/`de` statt regionaler Locales

**Entscheidung:** Die Anwendung unterstützt genau zwei Sprachcodes (`en`,
`de`), definiert in `apps/api/src/features/language/language.constants.ts`
bzw. `apps/web/src/i18n/core.ts`. `users.locale` wird auf diese Codes
umgestellt; die Migration normalisiert alle Legacy-/Regionalwerte sicher auf
`en`.

**Begründung:** Regionale Locales (`de-DE`, `en-US`, …) wurden nie für
Formatierung ausgewertet und erzeugten nur falsche Erwartungen. Zwei Codes
halten Katalog, Validierung und Browser-Kommunikation (Accept-Language-
Normalisierung) einfach und testbar. Eine spätere Erweiterung (z. B.
`fr`) ist über dieselben Kataloge möglich, ohne das Modell zu ändern.

### 2. Ein einziger Speicherort: `users.locale` (USER/ADMIN), Sitzung (READ_ONLY)

**Entscheidung:** Die redundante `UserPreference("language")` wird per
Migration entfernt (obsolet, kein erneuter Schreibpfad). Die Sprache wird
ausschließlich über den neuen Endpunkt `GET`/`PUT /user/language`
(`apps/api/src/features/language/`) verwaltet:

- `USER`/`ADMIN`: `users.locale` (persistent, `persistence: "persistent"`).
- `READ_ONLY`: **nur** `express-session`-Feld `language`
  (`persistence: "session"`) – niemals Datenbank, kein Audit, kein Verlauf.

**Begründung:** Ein einzelner Speicherort verhindert künftigen Drift
(doppelt gepflegte Werte). Die Session-Lösung für `READ_ONLY` erfüllt die
AP-21-Freigabe (Sprachauswahl ist die einzige über die Profil-Grenze
hinausgehende READ_ONLY-Funktion), ohne das Datenschutzmodell zu verletzen:
Sitzung = vergänglich, kein Profilzugriff, kein Trailing. Die API erzwingt
die Grenze serverseitig; die Web-UI zeigt für `READ_ONLY` einen
Sitzungshinweis.

### 3. Keine systemweite Sprache, keine Übersetzungs-API

**Entscheidung:** Es gibt keine globale Sprach-Systemeinstellung und keinen
Übersetzungs-Endpunkt. Die Kataloge liegen ausschließlich im Web-Repo
(`apps/web/src/i18n/locales/en.ts`, `de.ts`), Englisch ist die Quelle der
Wahrheit für den Schlüsselbaum; `de.ts` wird per `satisfies Messages` auf
denselben Baum gezwungen.

**Begründung:** Übersetzungen sind Build-Artefakte der UI; eine serverseitige
Übersetzungsverwaltung wäre eine Systemeinstellung, die es laut AP-21 nicht
geben soll. Der Typschutz (`MessagePath<Messages>`) macht `t()`-Aufrufe
compile-time sicher; ein Laufzeit-Parity-Test und ein Guard-Skript
(`test:i18n`) sichern Katalog-Gleichheit und verhindern hartkodierte
deutsche UI-Texte.

### 4. Fallback-Kette, Cookie und Auflösungsreihenfolge

**Entscheidung:** `t()` fällt in der Reihenfolge gewählte Sprache → Englisch →
roher Schlüssel zurück (nie leerer Text, nie Crash). Die Auflösungsreihenfolge
der aktiven Sprache ist: gespeicherte/Konto-Sprache (bzw.
Sitzungssprache bei `READ_ONLY`) → `Accept-Language`-Header → Englisch.

Die initiale Sprache der UI wird serverseitig im Root-Layout
(`apps/web/src/app/layout.tsx`) aus dem Cookie `versigo:locale` aufgelöst;
`<html lang>` und Metadaten folgen der Sprache. Der Cookie wird **nur für
persistente Konten** (`USER`/`ADMIN`) gesetzt:

- `USER`/`ADMIN`: Initialisierung aus dem Cookie; nach der Hydration lädt
  `GET /user/language` die gespeicherte Sprache und gleicht ab.
- `READ_ONLY`: besitzt **keinen** Sprach-Cookie (dieser würde die
  Sitzungs-Sprache über die Sitzung hinaus persistieren). Die Sitzungssprache
  kommt nach der Hydration vom Endpunkt; bis dahin gilt Englisch – bzw. die
  Sprache eines etwaig verbliebenen Cookies aus einer früheren persistenten
  Sitzung (bewusste, dokumentierte UX-Einschränkung: kurzer Flash möglich,
  danach setzt der Endpunkt die Sitzungssprache und löscht den Cookie).
- **Gäste (nicht angemeldet):** Login-/Registrierungsseiten starten bewusst
  mit dem globalen Default Englisch; der `Accept-Language`-Header wird erst
  nach der Anmeldung ausgewertet (kein öffentlicher Sprach-Endpunkt, keine
  clientseitige `navigator.language`-Auswertung – dokumentierte
  Design-Entscheidung, um Hydration und Server-/Client-Konsistenz nicht zu
  gefährden). **Einschränkung:** Liegt auf dem Browser noch ein
  `versigo:locale`-Cookie aus einer früheren persistenten Sitzung
  (USER/ADMIN) vor, so erben Gäste diese Sprache bis zur Anmeldung/Abmeldung
  bzw. bis der Cookie gelöscht wird – das Root-Layout kann Gäste nicht von
  Konten unterscheiden, ohne einen serverseitigen Sitzungs-Round-Trip.

**Begründung:** Der Fallback garantiert robuste Ausgaben auch bei
Katalogfehlern (Deployment-Versatz). Die serverseitige Cookie-Auflösung
macht Server-HTML und erste Client-Hydration deterministisch identisch
(kein Hydration-Mismatch, kein Sprach-Flash für persistente Konten). Der
Cookie wird für `READ_ONLY` bewusst vermieden, weil eine Sitzungssprache
nicht über die Sitzung hinaus überleben darf.

## Konsequenzen
- Die Profil-API (`PATCH /user/profile`) akzeptiert `locale` weiterhin
  (Allowlist `SUPPORTED_PROFILE_LOCALES = ['en', 'de']`), **nur aus
  API-Kompatibilitätsgründen**; die Web-UI nutzt ausschließlich den
  zentralen `/user/language`-Endpunkt (das Locale-Feld im Profil-Formular
  wurde entfernt). Ein künftiger Umbau kann das Feld ohne Client-Änderung
  streichen.
- Die Migration `20260802120000_ap21_multi_language_support` setzt den
  Spalten-Default auf `'en'`, normalisiert Legacy-Werte und löscht obsolete
  `user_preferences`-Zeilen.
- Neue Sprachen = neuer Katalog + `SUPPORTED_LANGUAGES`-Erweiterung +
  Migration nur falls Legacy-Daten existieren; keine neuen Services.
- Compose-Smoke-Tests decken Endpunkt, Persistenz (`users.locale`) und
  READ_ONLY-Sitzungsisolation ab (Schritte 8n/8o/9b).
