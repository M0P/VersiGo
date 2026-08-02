# ADR-005: OIDC-Login mit Server-Session statt reinem JWT

## Status
Angenommen (AP-02-identity-access)

## Kontext
VersiGo benoetigt OIDC-Login, Mandantentrennung auf Household-Ebene und
Rollen-Durchsetzung (OWNER/ADMIN/MEMBER/VIEWER) gemaess
`docs/07-security-privacy.md` und dem bestehenden Prisma-Schema.

## Entscheidung
- OIDC-Discovery und Token-Exchange erfolgen ueber `openid-client` (v6.x),
  nicht ueber das veraltete `passport-openidconnect` (letzter Release 2024,
  siehe Maintenance-Pruefung im PR).
- Nach erfolgreichem Login wird eine serverseitige Session
  (`express-session`, HttpOnly-Cookie) angelegt; kein clientseitig lesbares
  JWT im Browser. Das reduziert die Angriffsflaeche fuer XSS-basierten
  Token-Diebstahl.
- Die Session speichert ausschliesslich `userId`; Rollen und Household-
  Zugehoerigkeit werden bei jedem Request frisch aus der Datenbank gelesen
  (kein Rollen-Caching im Cookie), um sofortige Wirksamkeit von
  Rollenaenderungen und Deaktivierungen sicherzustellen.
- Mandantentrennung wird durch zwei Guards durchgesetzt:
  `HouseholdMembershipGuard` (Existenzpruefung) und `RolesGuard`
  (Rollenrang-Pruefung), beide DB-gestuetzt statt Claim-basiert.

## Konsequenzen
- Session-Rotation bei Login schuetzt vor Session-Fixation.
- Jeder geschuetzte Request verursacht einen zusaetzlichen DB-Read fuer
  User-Status und Memberships; akzeptabel fuer die erwartete Nutzerzahl
  einer Haushalts-Anwendung.
- Skalierung auf mehrere API-Instanzen erfordert einen gemeinsamen
  Session-Store (Redis, bereits als Foundation-Abhaengigkeit vorhanden)
  statt In-Memory-Sessions.

## Alternativen (verworfen)
- Reines stateless JWT im Cookie: erschwert sofortigen Rollen-Widerruf und
  Logout-Invalidierung ohne zusaetzliche Blacklist-Infrastruktur.
- `passport-openidconnect`: unzureichende Maintenance-Aktivitaet.
