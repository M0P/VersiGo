# Next Work Package

## Status
Work package **AP-16** (Rollen, Rechte, lokale Registrierung und Freischaltung) is committed at hash `39ca609` on branch `feat/AP-16-roles-rechte-lokale-registrierung`. Final review verdict: 0 Critical / 0 High / 0 Medium / 0 Minor (rounds 1–5 documented in `docs/reviews/AP-16-review-{1..5}.md`; round 4 returned 1 Minor which was fixed and re-verified in round 5). Both canonical gates are green: the docker-compose test suite passed ("All checks passed!", 34 test files / 414 tests, lint + typecheck + prisma migrate deploy + build) and `./scripts/compose-smoke-test.sh --build` passed all steps including worker startup and the BullMQ round-trip.

AP-13, AP-14, AP-15 and AP-16 are committed. The next work package in rising order is **AP-17 — Profil- und Systemeinstellungen in der UI**.

## Prompt for the next coding-agent

Below is the full content of the next work package. Implement only this work package. Use the same review loop (invoke @code-reviewer, save each result verbatim under `docs/reviews/`, fix Critical/High/Medium findings, iterate until 0 Critical / 0 High / 0 Medium and at most 8 Minor findings, with the canonical Docker Compose test suite green). Do not start any later work package.

---

/prompts/AP-17-profil-und-systemeinstellungen-ui.md

# Feature: Profil- und Systemkonfiguration in der UI

## Ziel

Erweitere Insura um getrennte, sichere und responsive Profil- sowie System-Einstellungen. `USER` und `ADMIN` erhalten persönliche Profileinstellungen; `ADMIN` erhält zusätzlich eine zentrale Systemkonfiguration für alle fachlich und betrieblich konfigurierbaren Optionen. Datenbankgestützte UI-Konfiguration hat Vorrang vor `.env`; `.env` bleibt ausschließlich der dokumentierte Fallback. Für jeden Fallback muss die Admin-UI sichtbar machen, dass, warum und mit welchem effektiven Wert der Fallback greift.

Dies ist ein vollständiger vertikaler Slice aus Settings-Katalog, Prioritätsauflösung, Persistenz/Verschlüsselung, API, Admin- und Profil-UI, Audit, Tests, Compose/CI und Dokumentation. Die Änderung muss auf dem in der Rollen-/Rechte-Funktion etablierten Modell aufbauen; falls diese noch nicht umgesetzt ist, muss der Slice die erforderlichen Berechtigungsgrenzen explizit und kompatibel vorbereiten, ohne konkurrierende Rollenlogik einzuführen.

## Verbindliche Referenzen

Lies vollständig `AGENTS.md`, `prompts/00-gemeinsame-regeln.md`, alle `docs/` und ADRs, `dependency-policy.md`, `.opencode/agents/*`, `prompts/PR-REVIEW.md`, die vorhandene Admin-Settings-Implementierung, Settings-Store/Feature-Flag-/Encryption-Code, Konfigurationsschema, `.env.example`, Docker-Compose-Dateien, API/Web/Worker-Consumers, Health-Checks und Tests.

Beachte alle Repository-Regeln, insbesondere Docker-Compose als verbindlichen Test- und CI-Standard, vertikale Slices, optionale Integrationen mit Degradation, Secret-Handling, Verschlüsselung, Audit, Household-Isolation und unabhängigen Code Review.

## Berechtigungen und UI-Bereiche

| Bereich | `READ_ONLY` | `USER` | `ADMIN` |
|---|---|---|---|
| Profil | Kein Zugriff und keine Änderung | Eigenes Profil und persönliche UI-Präferenzen lesen/ändern | Eigenes Profil und persönliche UI-Präferenzen lesen/ändern |
| Systemeinstellungen | Kein Zugriff | Kein Zugriff | Vollständiger Zugriff auf erlaubte zentrale Einstellungen |
| Nutzerverwaltung | Kein Zugriff | Kein Zugriff | Gemäß Rollen-/Rechte-Modell |

Die API erzwingt diese Grenzen unabhängig von sichtbaren Navigationspunkten. Kein Settings-Endpunkt darf einem `READ_ONLY`- oder `USER`-Konto durch direkte Anfrage Konfigurationswerte, Secrets, Metadaten oder Änderungsmöglichkeiten preisgeben.

## Persönliche Profileinstellungen

`USER` und `ADMIN` dürfen ausschließlich eigene profilbezogene Werte ändern, zum Beispiel Anzeigename, Sprache/Locale, Zeitzone sofern verwendet, Theme/Darstellung und weitere nachweislich persönliche UI-Präferenzen. Die konkrete Liste wird als versionierter Settings-Katalog implementiert und nicht als unvalidiertes JSON-Sammelfeld.

- Änderungen sind auf den aktuellen Nutzer begrenzt und dürfen Household- oder Systemkonfiguration nicht überschreiben.
- `READ_ONLY` kann keine Profileinstellungen aufrufen, lesen oder ändern.
- Validierung, sinnvolle Defaults, sichere Fehlerbehandlung und zugängliche responsive UI sind Pflicht.
- Keine sensiblen Zugangsdaten, Rollen, Freigaben oder Systemwerte über die Profilseite editierbar machen.

## Zentrale Systemkonfiguration

Der Admin erhält eine UI für alle **nicht grundlegenden infrastrukturellen** Konfigurationen. Erfasse vor der Umsetzung einen vollständigen Konfigurationskatalog aus bestehenden `.env`-Variablen, App-Konfigurationsschema, Compose-Dateien, API/Web/Worker-Consumers und Integrationen. Ordne jede Variable genau einer Kategorie zu:

1. **Bootstrap/infrastrukturkritisch – nur Environment/Compose:** z. B. Datenbank- und Redis-Verbindungsstrings, Container-Service-DNS, DB-/Redis-Passwörter, Session-/Verschlüsselungs-Root-Secrets, Port-Bindings, Dateisystempfade, Reverse-Proxy-/TLS- und Startkonfiguration. Diese Werte dürfen nie über UI gespeichert, angezeigt oder überschrieben werden.
2. **Zentral fachlich/betrieblich konfigurierbar – Admin-UI mit `.env`-Fallback:** z. B. Feature Flags, optionale AI-Provider/Modelle, AI-Endpunkte, Paperless-ngx, Portal-Connectoren, Storage-Optionen soweit keine Infrastruktur-Secrets betroffen sind, Limits, Funktionsschalter und weitere bereits vorhandene, zur Laufzeit sicher veränderbare Einstellungen.
3. **Secret-Konfiguration innerhalb einer fachlichen Integration:** über Admin-UI setzbar, verschlüsselt persistiert, niemals als Klartext zurückgegeben, geloggt oder in Audit-Diffs gespeichert. Die UI zeigt nur „gesetzt/nicht gesetzt“, letzten Änderungszeitpunkt und ggf. eine sichere Connectivity-Prüfung.
4. **Nicht dynamisch anwendbar:** Werte, die zwar fachlich konfigurierbar sind, aber einen kontrollierten Neustart benötigen. Die UI muss Änderung, wirksamen Wert, Quelle und „Neustart erforderlich“ anzeigen; der Wert darf nicht fälschlich als bereits aktiv dargestellt werden.

Kein Mechanismus darf beliebige `.env`-Namen, JSON oder unbekannte Schlüssel über die UI in die Laufzeitkonfiguration einschleusen. Der Katalog ist allowlist-basiert, typisiert, versionskontrolliert, mit DTO-/Schema-Validierung versehen und pro Schlüssel mit Datentyp, Scope, Geheimnis-Flag, Default/Fallback, Runtime-Anwendbarkeit, Rechteanforderung und sichtbarer Beschreibung dokumentiert.

## Priorität, Fallback und Transparenz

Für jeden UI-konfigurierbaren Schlüssel gilt deterministisch:

1. Gültiger, aktivierter, datenbankgestützter UI-Wert gewinnt.
2. Fehlt, ist ungültig, deaktiviert oder nicht anwendbar, gilt der validierte `.env`-Wert als Fallback.
3. Fehlt auch dieser, gilt ausschließlich ein sicherer, dokumentierter Code-Default oder die betroffene optionale Funktion wird degradiert/deaktiviert.

- Die Admin-UI zeigt pro Schlüssel mindestens: effektiven Wert (bei Secrets maskiert), Quelle (`UI`, `.env`, `Default`), Fallback-Status und -Grund, letzten UI-Änderungszeitpunkt/Akteur soweit datenschutzkonform, Validierungsstatus, Neustartbedarf und bei Integrationen Connectivity-Status.
- `.env`-Werte dürfen nie vollständig oder als Entropie-verringernde Teilwerte offenbart werden, wenn sie geheim sind. Auch Konfigurationsmetadaten dürfen keine Infrastruktur- oder Secret-Leaks ermöglichen.
- Änderungen müssen atomar validiert werden. Ungültige UI-Werte aktivieren niemals einen defekten effektiven Zustand; die zuvor wirksame Konfiguration bleibt erhalten und der Fehler ist administrativ sichtbar.
- UI-Werte überschreiben nur den jeweiligen katalogisierten Schlüssel, niemals implizit ganze Konfigurationsobjekte.
- Änderungen, Zurücksetzen auf Fallback, Feature-Flag-Änderungen und Connectivity-Tests werden revisionssicher auditiert, ohne Secrets oder Klartextwerte in Audit, Logs oder Responses.

## Laufzeit und Integrationen

- Ergänze eine zentral verwendete Konfigurationsauflösung; API und Worker müssen denselben Prioritätsvertrag verwenden. Vermeide, dass einzelne Features direkt `process.env` lesen und damit UI-Overrides umgehen.
- Optional konfigurierte Funktionen degradieren bei fehlender/ungültiger Konfiguration gezielt, nachvollziehbar und ohne Gesamtausfall.
- Feature-Flags wirken nur auf ihre Feature-Grenze und nicht auf Auth, Datenisolation, Migrationen, Health oder andere Grundfunktionen.
- Connectivity-Tests dürfen nur für die jeweilige Konfiguration laufen, müssen Timeouts/Fehler sicher behandeln und keine geheimen Werte preisgeben.

## UI und Bedienbarkeit

- Erstelle klare, responsive Bereiche für „Mein Profil“ und „Systemeinstellungen“. Admin-Einstellungen werden nach Kategorien gruppiert, mit Suche, Filter für Quelle/Fallback/Fehler/Neustartbedarf und verständlichen Hilfetexten.
- Die UI zeigt bei Fallback auffällig, aber nicht störend, den effektiven Zustand und eine sichere Aktion zum Setzen, Ändern oder Zurücksetzen des UI-Werts.
- Verwende das zentrale Design-System und erfülle Tastaturbedienung, Labels, Fokus, Kontrast, Fehlerzusammenfassungen, mobile/tablet/desktop-Verhalten sowie `prefers-reduced-motion`.

## Tests, Docker und Dokumentation

- Teste pro Einstellungskategorie Berechtigung, Allowlist, Typvalidierung, Vorrang UI vor `.env`, `.env`-Fallback, Default/Degradation, Reset, Maskierung, Verschlüsselung, Audit-Redaction, Runtime-Neuladen bzw. Neustart-Markierung und Fehlerfälle.
- Teste API und Worker gegen denselben Resolver; ergänze Integrations- und UI-Tests für sichtbare Fallback-Quellen und verbotene Zugriffe.
- Führe den vollständigen kanonischen Docker-Compose-Testvertrag einschließlich Prisma/Migrationen, Build und Laufzeit-Smoke-Test aus; keine Host-Node-/pnpm-/DB-/Redis-Abhängigkeit.
- Aktualisiere nach erfolgreichem Test Datenmodell, Architektur, Security/Privacy, Admin Operations, UI/UX, README, `.env.example`, Compose-/CI- und Agenten-/Prompt-Guidance, sofern betroffen. Dokumentiere den vollständigen Konfigurationskatalog und markiere ausdrücklich, welche Werte UI-konfigurierbar und welche aus Sicherheits-/Infrastrukturgründen Environment-only sind.
- Führe den unabhängigen, read-only `@code-reviewer`-Loop durch, speichere Reviews wortgetreu unter `docs/reviews/`, behebe alle Critical/High/Medium-Befunde und committe nur bei 0 Critical, 0 High, 0 Medium, höchstens 8 Minor sowie grüner Compose-CI.

## Akzeptanzkriterien

- `USER` und `ADMIN` können ausschließlich ihr eigenes Profil konfigurieren; `READ_ONLY` kann keinerlei Einstellungen lesen oder ändern.
- Nur `ADMIN` kann zentrale Systemkonfiguration aufrufen oder ändern.
- Jeder bestehende Konfigurationsschlüssel ist inventarisiert, kategorisiert und entweder UI-konfigurierbar mit sicherem Fallback oder begründet Environment-only.
- UI-Werte haben nach Validierung Vorrang vor `.env`; `.env` ist ein sichtbarer Fallback; Default/Degradation ist ebenfalls sichtbar.
- Secrets bleiben verschlüsselt und maskiert, werden nie offenbart oder geloggt und erscheinen nicht in Audits.
- API und Worker verwenden dieselbe zentrale Auflösung; optionale Features degradieren kontrolliert.
- Tests, Dokumentation, Compose-Laufzeit, Compose-Testvertrag, CI und unabhängiger Review sind vollständig erfolgreich.
