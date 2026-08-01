import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService, AppConfigService } from '@insura/foundation';
import { GlobalRole, UserStatus } from '@prisma/client';
import { PasswordHashingService } from './password-hashing.service';
import { normalizeIdentifier } from './auth.service';

/**
 * Idempotenter Bootstrap fuer den initialen lokalen Administrator.
 *
 * Laueft ausschliesslich in lokalen Entwicklungs-/Testumgebungen
 * (NODE_ENV ungleich "production") und nur, wenn die lokale
 * Authentifizierung aktiv ist. Beim ersten Start auf leerer Datenbank
 * wird genau ein Admin aus LOCAL_ADMIN_USERNAME/LOCAL_ADMIN_PASSWORD
 * angelegt; weitere Starts legen kein Duplikat an und ueberschreiben
 * das Passwort eines bereits existierenden Kontos nicht.
 *
 * In Produktion wird der Bootstrap nie ausgefuehrt: Dort ist kein
 * ueber Umgebungsvariablen bekanntes Default-Passwort zulaessig.
 * Passwoerter werden ausschliesslich als bcrypt-Hash gespeichert;
 * Klartextwerte werden weder gespeichert noch geloggt.
 *
 * ADR-007: Der User erhaelt die globale Rolle ADMIN und den Status ACTIVE.
 * Der ehemalige OIDC-Platzhalter-Issuer "local" entfaellt (Bindungen nur
 * noch ueber echte OIDC-Provider, siehe ADR-007).
 */
@Injectable()
export class LocalAdminBootstrapService {
  private readonly logger = new Logger(LocalAdminBootstrapService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: AppConfigService,
    private readonly passwordHashing: PasswordHashingService,
  ) {}

  /**
   * Fuehrt den Bootstrap aus, falls die Voraussetzungen erfuellt sind.
   * Wirft nie: Erwartbare Duplikate (P2002 auf der UNIQUE-Constraint)
   * werden gewarnt, andere Laufzeitfehler (z. B. nicht erreichbare DB)
   * auf ERROR-Stufe protokolliert – beides blockiert den Anwendungsstart
   * nicht (Fail-Fast betrifft nur fehlende Authentifizierungsmethoden
   * im IdentityModule).
   */
  async bootstrap(): Promise<void> {
    if (this.config.isProduction) {
      return;
    }

    // Defense-in-Depth: Der Aufrufer (IdentityModule) ruft den Bootstrap
    // nur bei aktiver lokaler Auth auf; die Pruefung hier schuetzt auch
    // gegen versehentliche Aufrufe aus anderen Kontexten.
    if (!this.config.get('LOCAL_AUTH_ENABLED')) {
      return;
    }

    const username = this.config.get('LOCAL_ADMIN_USERNAME');
    const password = this.config.get('LOCAL_ADMIN_PASSWORD');

    if (!username || !password) {
      this.logger.warn(
        'LOCAL_ADMIN_USERNAME/LOCAL_ADMIN_PASSWORD nicht gesetzt – ' +
          'es wird kein initialer lokaler Administrator angelegt.',
      );
      return;
    }

    const identifier = normalizeIdentifier(username);

    try {
      const existing = await this.db.user.findUnique({
        where: { username: identifier },
        select: { id: true },
      });

      if (existing) {
        this.logger.log(
          'Initialer lokaler Administrator existiert bereits – Bootstrap wird uebersprungen.',
        );
        return;
      }

      const passwordHash = await this.passwordHashing.hash(password);

      await this.db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            username: identifier,
            displayName: identifier,
            role: GlobalRole.ADMIN,
            status: UserStatus.ACTIVE,
          },
        });

        await tx.credential.create({
          data: {
            userId: user.id,
            passwordHash,
          },
        });

        await tx.auditEvent.create({
          data: {
            actorUserId: null,
            entityType: 'User',
            entityId: user.id,
            action: 'BOOTSTRAP_ADMIN',
            diffJson: { username: identifier },
          },
        });
      });

      this.logger.log(
        `Initialer lokaler Administrator angelegt (${identifier}). ` +
          'Passwort wird nur als Hash gespeichert.',
      );
    } catch (error) {
      // P2002 (UNIQUE-Constraint) ist erwartbar: Der Benutzername ist
      // bereits belegt oder ein paralleles Replica hat den Admin
      // zeitgleich angelegt (Check-then-Insert-Race). In dem Fall
      // warnen und ueberspringen.
      if ((error as { code?: string }).code === 'P2002') {
        this.logger.warn(
          `Initialer Admin-Bootstrap uebersprungen (Duplikat): ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
      // Andere Fehler (z. B. DB nicht erreichbar) werden auf ERROR-Stufe
      // protokolliert, blockieren den Start aber nicht – ein Container-
      // bzw. Prozess-Restart wiederholt den Bootstrap.
      this.logger.error(
        `Initialer Admin-Bootstrap fehlgeschlagen: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
