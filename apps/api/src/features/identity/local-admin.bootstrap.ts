import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService, AppConfigService } from '@insura/foundation';
import { UserStatus } from '@prisma/client';
import { PasswordHashingService } from './password-hashing.service';
import { normalizeIdentifier } from './auth.service';

/**
 * Idempotenter Bootstrap fuer den initialen lokalen Administrator.
 *
 * Laueft ausschliesslich in lokalen Entwicklungs-/Testumgebungen
 * (NODE_ENV ungleich "production") und nur, wenn die lokale
 * Authentifizierung aktiv ist. Beim ersten Start auf leerer Datenbank
 * wird genau ein Admin aus LOCAL_ADMIN_* angelegt; weitere Starts
 * legen kein Duplikat an und ueberschreiben das Passwort eines
 * bereits existierenden Kontos nicht.
 *
 * In Produktion wird der Bootstrap nie ausgefuehrt: Dort ist kein
 * ueber Umgebungsvariablen bekanntes Default-Passwort zulaessig.
 * Passwoerter werden ausschliesslich als bcrypt-Hash gespeichert;
 * Klartextwerte werden weder gespeichert noch geloggt.
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

    const email = this.config.get('LOCAL_ADMIN_EMAIL');
    const password = this.config.get('LOCAL_ADMIN_PASSWORD');

    if (!email || !password) {
      this.logger.warn(
        'LOCAL_ADMIN_EMAIL/LOCAL_ADMIN_PASSWORD nicht gesetzt – ' +
          'es wird kein initialer lokaler Administrator angelegt.',
      );
      return;
    }

    const identifier = normalizeIdentifier(email);

    try {
      const existing = await this.db.credential.findUnique({
        where: { identifier },
        select: { id: true },
      });

      if (existing) {
        this.logger.log(
          'Initialer lokaler Administrator existiert bereits – Bootstrap wird uebersprungen.',
        );
        return;
      }

      const passwordHash = await this.passwordHashing.hash(password);
      const displayName = [
        this.config.get('LOCAL_ADMIN_FIRST_NAME'),
        this.config.get('LOCAL_ADMIN_LAST_NAME'),
      ]
        .filter((part): part is string => Boolean(part))
        .join(' ')
        .trim();

      await this.db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            // Getrimmt gespeichert, damit E-Mail und normalisierter
            // Credential-Identifier konsistent bleiben.
            email: email.trim(),
            displayName: displayName || email.trim(),
            // Lokale Benutzer haben keine OIDC-Identitaet. Der Issuer
            // "local" und der normalisierte Identifier als Subject
            // halten die UNIQUE-Constraint (oidcIssuer, oidcSubject) ein.
            oidcIssuer: 'local',
            oidcSubject: identifier,
            status: UserStatus.ACTIVE,
          },
        });

        await tx.credential.create({
          data: {
            userId: user.id,
            identifier,
            passwordHash,
          },
        });
      });

      this.logger.log(
        `Initialer lokaler Administrator angelegt (${email.trim()}). ` +
          'Passwort wird nur als Hash gespeichert.',
      );
    } catch (error) {
      // P2002 (UNIQUE-Constraint) ist erwartbar: users.email ist bereits
      // durch einen OIDC-Benutzer belegt oder ein paralleles Replica hat
      // den Admin zeitgleich angelegt (Check-then-Insert-Race). In dem
      // Fall warnen und ueberspringen.
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
