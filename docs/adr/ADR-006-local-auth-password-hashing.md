# ADR-006: Lokale Authentifizierung und Passwort-Hashing

## Status
Akzeptiert

## Kontext
AP-14 führt eine lokale Benutzername/Passwort-Authentifizierung als Alternative zum bestehenden OIDC-Login ein. Dafür sind folgende architekturelle Entscheidungen zu treffen:

1. Passwort-Hashing-Algorithmus und Parameter
2. Speicherung lokaler Credentials im Datenmodell
3. Multi-Provider Session-Modell
4. Brute-Force-Schutz

## Entscheidungen

### 1. Passwort-Hashing mit bcrypt (Kostenfaktor 12)

**Entscheidung:** bcrypt mit Kostenfaktor 12.

**Begründung:**
- bcrypt ist der am weitesten verbreitete, am besten geprüfte Passwort-Hashing-Algorithmus für Node.js
- Baut automatisch einen eindeutigen Salt pro Passwort ein (kein separater Salt-Speicher nötig)
- Kostenfaktor 12 bietet ein ausgewogenes Verhältnis zwischen Sicherheit und Performance (~250ms auf aktueller Hardware)
- Keine zusätzliche Abhängigkeit außer der gut gewarteten `bcrypt`-Bibliothek
- Node.js-interne Alternativen (scrypt, pbkdf2) wurden erwogen, erfordern aber manuelles Salt-Management

**Abgelehnte Alternativen:**
- scrypt (Node.js built-in): Erfordert manuelles Salt-Management, keine Standardbibliothek für einfaches Verify
- argon2: Moderner, aber weniger verbreitet im Node.js-Ökosystem; bei Bedarf später migrierbar
- pbkdf2: Von NIST empfohlen, aber bcrypt bietet bessere Resistenz gegen GPU-Attacken

### 2. Separates Credential-Modell (keine Erweiterung des User-Modells)

**Entscheidung:** Credentials werden in einer eigenen Tabelle `credentials` gespeichert, 1:1-Relation zu `users`.

**Begründung:**
- Credential-Felder (identifier, passwordHash) sind fachlich unabhängig von OIDC-Identitätsdaten
- Ein User kann beide Authentifizierungsmethoden nutzen (OIDC und lokal)
- Die klare Trennung erleichtert spätere Erweiterungen (z. B. Passwort-Reset-Tokens, MFA)
- Das User-Modell bleibt auf OIDC-Identität fokussiert

**Normalisierung:** Der Identifier wird vor Speicherung und Lookup normalisiert: lowercase + trim. Dies gewährleistet case-insensitive Eindeutigkeit ohne separate Index-Logik.

### 3. Multi-Provider Session-Modell

**Entscheidung:** Beide Authentifizierungsmethoden nutzen dasselbe Session-Modell (express-session, `versigo.sid`-Cookie).

**Begründung:**
- Nach erfolgreichem Login wird in beiden Fällen `req.session.userId = user.id` gesetzt
- Der SessionAuthGuard prüft ausschließlich `req.session.userId` und löst den User über `authService.findById()` auf
- Es gibt keinen Unterschied zwischen einer OIDC- und einer lokalen Session aus Sicht der Autorisierung
- Session-Fixation-Schutz (session.regenerate) wird in beiden Fällen angewendet

### 4. Brute-Force-Schutz

**Entscheidung:** Redis-basierter IP-bezogener Rate-Limiter für fehlgeschlagene Login-Versuche.

**Begründung:**
- Redis ist bereits im Stack vorhanden und wird für Queue/BullMQ genutzt
- IP-basierte Begrenzung verhindert Massen-Angriffe, ohne Account-Existenz preiszugeben
- Standard: 5 Fehlversuche pro 15 Minuten pro IP (konfigurierbar)
- Bei Redis-Ausfall wird Fail-Open verwendet (kein Blockieren), da ein Redis-Ausfall bereits andere Funktionen beeinträchtigt
- Der Zähler wird nach erfolgreichem Login zurückgesetzt

## Konsequenzen

- bcrypt ist als neue Abhängigkeit in `apps/api/package.json` aufgenommen und im dependency-policy.md dokumentiert
- Die startup-Logik prüft, ob mindestens eine Authentifizierungsmethode aktiviert ist, und verweigert den Start mit einer klaren Fehlermeldung
- Passwort-Reset per E-Mail ist nicht implementiert (deferred); ein Token-Lifecycle müsste für eine sichere Umsetzung aufgebaut werden
- Zukünftige Migration auf argon2 ist durch die gekapselte `PasswordHashingService`-Klasse einfach möglich
