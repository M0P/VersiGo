-- AP-16: Globale Rollen, lokale Registrierung, OIDC-Bindung
-- =========================================================
-- Daten-erhaltende Migration (ADR-007):
--
-- 1. Neue Enum "GlobalRole" (READ_ONLY, USER, ADMIN) und neuer Status
--    PENDING_APPROVAL auf "UserStatus".
-- 2. users.username (eindeutiger lokaler Login-Identifier), Backfill aus
--    credentials.identifier -> email -> oidcSubject -> user-<id>; E-Mail/
--    Subject-Backfills werden auf max. 24 Zeichen gekuerzt, damit der
--    Login-Identifier die DTO-Grenze (32 Zeichen) sicher einhaelt.
-- 3. users.role (GlobalRole) mit Ableitung aus den bisherigen
--    Household-Rollen (max-wins: OWNER/ADMIN -> ADMIN, MEMBER -> USER,
--    VIEWER -> READ_ONLY); bisheriger lokaler Bootstrap-Admin
--    (oidcIssuer='local') wird explizit ADMIN.
-- 4. E-Mail wird optional (kein Login-Merkmal), users_email_key entfaellt.
-- 5. OIDC-Platzhalter 'local'/'unknown' werden entfernt
--    (oidcIssuer/oidcSubject NULL); Bindungen nur noch ueber echte
--    OIDC-Provider, vergeben durch Admins.
-- 6. credentials.identifier entfaellt (users.username ist die Quelle),
--    household_memberships.role entfaellt (reine Mandantentrennung).
-- 7. "HouseholdRole"-Enum wird entfernt.

-- 1) Neue Enums --------------------------------------------------------------

CREATE TYPE "GlobalRole" AS ENUM ('READ_ONLY', 'USER', 'ADMIN');

ALTER TYPE "UserStatus" ADD VALUE 'PENDING_APPROVAL';

-- 2) Benutzername (nullable anlegen, Backfill, danach NOT NULL) --------------

ALTER TABLE "users" ADD COLUMN "username" TEXT;

-- Vorrang 1: vorhandener lokaler Credential-Identifier (bereits normalisiert)
UPDATE "users" u
SET "username" = lower(trim(c."identifier"))
FROM "credentials" c
WHERE c."userId" = u."id";

-- Vorrang 2: E-Mail (lowercase/getrimmt). Auf max. 24 Zeichen gekuerzt:
-- Der Login-Identifier muss die DTO-Grenze von 32 Zeichen einhalten
-- (LocalLoginDto @Length(3, 32)); ein ungekuerztes langes Mail-Localpart
-- wuerde den User dauerhaft am lokalen Login hindern. Ein enthaltenes "@"
-- ist fuer den Login unschaedlich (das DTO prueft nur die Laenge).
UPDATE "users" u
SET "username" = left(lower(trim(u."email")), 24)
WHERE u."username" IS NULL
  AND u."email" IS NOT NULL
  AND trim(u."email") <> '';

-- Vorrang 3: OIDC-Subject (auf max. 24 Zeichen gekuerzt, s.o.)
UPDATE "users" u
SET "username" = left(lower(trim(u."oidcSubject")), 24)
WHERE u."username" IS NULL
  AND u."oidcSubject" IS NOT NULL
  AND trim(u."oidcSubject") <> '';

-- Vorrang 4: deterministischer Fallback aus der User-ID
UPDATE "users"
SET "username" = 'user-' || left(replace("id", '-', ''), 8)
WHERE "username" IS NULL;

-- Kollisionen aufloesen: doppelte Benutzernamen werden durch eine
-- id-abgeleitete, deterministische Alternative ersetzt
-- ('user-' || erstes Segment der entdachten User-ID), bis keine Duplikate
-- mehr existieren (nur Bestandsdaten; Neuanmeldungen werden durch die
-- UNIQUE-Constraint und die Anwendungsvalidierung geschuetzt).
--
-- Ein einzelner Update-Durchlauf reicht nicht aus: Ein erzeugter Name kann
-- mit einem natuerlichen Benutzernamen kollidieren (z.B. doppeltes "max"
-- und bereits vorhandenes "user-abc123") und so den nachfolgenden
-- CREATE UNIQUE INDEX "users_username_key" scheitern lassen. Die Schleife
-- ersetzt in jeder Runde mit einem laengeren id-abgeleiteten Segment (die
-- entdachte User-ID ist eindeutig), bis alle Benutzernamen eindeutig sind.
--
-- Laengen- und Zeichensatz-Garantie: 'user-' (5 Zeichen) + max. 27 Zeichen
-- id-Segment = max. 32 Zeichen (DTO-Grenze), Zeichensatz [a-z0-9.-].
-- Der Maximalfall (LEAST(segment_len, 27)) ist ab Runde 5 erreicht; sollten
-- danach noch Duplikate verbleiben (praktisch ausgeschlossen, da sich
-- User-IDs unterscheiden), schlaegt die Migration laut fehl.
DO $$
DECLARE
  remaining integer := 1;
  guard integer := 0;
  segment_len integer := 6;
BEGIN
  WHILE remaining > 0 AND guard < 6 LOOP
    UPDATE "users" u
    SET "username" = 'user-' || left(replace(u."id", '-', ''), LEAST(segment_len, 27))
    WHERE u."username" IN (
      SELECT "username"
      FROM "users"
      GROUP BY "username"
      HAVING count(*) > 1
    );

    SELECT count(*) INTO remaining
    FROM (
      SELECT "username"
      FROM "users"
      GROUP BY "username"
      HAVING count(*) > 1
    ) d;

    guard := guard + 1;
    segment_len := segment_len + 6;
  END LOOP;

  IF remaining > 0 THEN
    RAISE EXCEPTION 'AP-16: Benutzernamen-Kollisionen konnten nicht aufgeloest werden (verbleibende Duplikate: %', remaining;
  END IF;
END $$;

ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;

CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- 3) Globale Rolle ------------------------------------------------------------

ALTER TABLE "users" ADD COLUMN "role" "GlobalRole" NOT NULL DEFAULT 'USER';

-- Ableitung aus den bisherigen Household-Rollen (max-wins):
-- OWNER/ADMIN-Mitgliedschaft -> ADMIN
UPDATE "users" u
SET "role" = 'ADMIN'
WHERE EXISTS (
  SELECT 1 FROM "household_memberships" hm
  WHERE hm."userId" = u."id" AND hm."role" IN ('OWNER', 'ADMIN')
);

-- Nur-READ_ONLY-Fall: User mit (ausschliesslich) VIEWER-Mitgliedschaft werden
-- auf READ_ONLY gesetzt. Wichtig: Die Reihenfolge oben stellt sicher, dass
-- ADMIN (aus OWNER/ADMIN) bereits vergeben wurde; hier darf nur herabgestuft
-- werden, wenn der User KEINE hoehere Mitgliedschaft (MEMBER -> USER) besitzt.
-- Ein User mit MEMBER in Household A und VIEWER in Household B bleibt USER
-- (max-wins, verlustfrei), statt durch die VIEWER-Mitgliedschaft in B auf
-- READ_ONLY demotiert zu werden.
UPDATE "users" u
SET "role" = 'READ_ONLY'
WHERE u."role" = 'USER'
  AND EXISTS (
    SELECT 1 FROM "household_memberships" hm
    WHERE hm."userId" = u."id" AND hm."role" = 'VIEWER'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "household_memberships" hm
    WHERE hm."userId" = u."id" AND hm."role" = 'MEMBER'
  );

-- Bisheriger lokaler Bootstrap-Admin (Issuer 'local') bleibt vollwertiger
-- ADMIN, auch ohne OWNER/ADMIN-Mitgliedschaft.
UPDATE "users"
SET "role" = 'ADMIN'
WHERE "oidcIssuer" = 'local';

-- 4) E-Mail optional (kein Login-Merkmal) -------------------------------------

DROP INDEX "users_email_key";

ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;

-- 5) OIDC-Platzhalter entfernen, Spalten nullable -----------------------------

ALTER TABLE "users" ALTER COLUMN "oidcIssuer" DROP NOT NULL;
ALTER TABLE "users" ALTER COLUMN "oidcSubject" DROP NOT NULL;

UPDATE "users"
SET "oidcIssuer" = NULL, "oidcSubject" = NULL
WHERE "oidcIssuer" IN ('local', 'unknown');

-- 6) credentials.identifier und household_memberships.role entfernen ----------

DROP INDEX "credentials_identifier_key";

ALTER TABLE "credentials" DROP COLUMN "identifier";

ALTER TABLE "household_memberships" DROP COLUMN "role";

-- 7) HouseholdRole-Enum entfernen ---------------------------------------------

DROP TYPE "HouseholdRole";
