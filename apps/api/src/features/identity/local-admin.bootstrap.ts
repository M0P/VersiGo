import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService, AppConfigService } from '@versigo/foundation';
import { GlobalRole, UserStatus } from '@prisma/client';
import { PasswordHashingService } from './password-hashing.service';
import { normalizeIdentifier } from './auth.service';

/**
 * Fixe ID des Beta-Referenz-Households. Die Web-UI adressiert household-
 * gescopte Endpunkte durchgaengig ueber /households/default/..., daher muss
 * das Household genau diese ID tragen (kein UUID).
 */
export const DEFAULT_HOUSEHOLD_ID = 'default';

/**
 * Idempotenter Bootstrap fuer den initialen lokalen Administrator.
 *
 * Laueft, wenn die lokale Authentifizierung aktiv ist und LOCAL_ADMIN_USERNAME
 * sowie LOCAL_ADMIN_PASSWORD explizit gesetzt sind. Beim ersten Start auf
 * leerer Datenbank wird genau ein Admin aus diesen Variablen angelegt;
 * weitere Starts legen kein Duplikat an und ueberschreiben das Passwort
 * eines bereits existierenden Kontos nicht.
 *
 * In Produktion ist LOCAL_AUTH_ENABLED per Default false
 * (app-config.schema.ts: `LOCAL_AUTH_ENABLED ?? NODE_ENV !== 'production'`),
 * daher ist `true` dort immer eine ausdrueckliche Konfiguration: Es wird
 * nie ein Default-Admin automatisch angelegt, sondern nur ein explizit
 * konfigurierter initialer Administrator (AP-20 P5). Zusaetzlich wird in
 * Produktion das .env.example-Platzhalter-Passwort abgelehnt.
 *
 * ADR-007: Der User erhaelt die globale Rolle ADMIN und den Status ACTIVE.
 * Der ehemalige OIDC-Platzhalter-Issuer "local" entfaellt (Bindungen nur
 * noch ueber echte OIDC-Provider, siehe ADR-007).
 *
 * AP-20: Neben dem Admin wird das Beta-Referenz-Household mit der fixen
 * ID "default" angelegt (die Web-UI verwendet durchgaengig
 * /households/default/...) und der Admin erhaelt eine Mitgliedschaft.
 * Erst dadurch sind die household-gescopten Fachfunktionen (Policen,
 * Kosten, Freigaben, AI) ueber die UI erreichbar. Beide Schritte sind
 * idempotent (Upsert).
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
    // Defense-in-Depth: Der Aufrufer (IdentityModule) ruft den Bootstrap
    // nur bei aktiver lokaler Auth auf; die Pruefung hier schuetzt auch
    // gegen versehentliche Aufrufe aus anderen Kontexten. In Produktion
    // ist LOCAL_AUTH_ENABLED per Default false – true bedeutet dort immer
    // eine ausdrueckliche Konfiguration (kein automatischer Default-Admin).
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

    // AP-20 (P5): In Produktion darf niemals mit dem bekannten
    // .env.example-Platzhalter-Passwort bootstrapped werden. Wird der
    // Platzhalter dort erkannt, wird der Bootstrap verweigert (kein
    // Admin, kein Default-Household) und der Fehler klar protokolliert.
    if (
      this.config.isProduction &&
      password === 'CHANGE_ME_FOR_LOCAL_DEVELOPMENT'
    ) {
      this.logger.error(
        'LOCAL_ADMIN_PASSWORD entspricht dem .env.example-Platzhalter. ' +
          'In Produktion wird kein initialer Administrator angelegt – ' +
          'bitte ein eigenes, starkes Passwort setzen.',
      );
      return;
    }

    const identifier = normalizeIdentifier(username);

    try {
      // Phase 1: Bestehenden Admin ermitteln (idempotent, ein bestehendes
      // Passwort wird bei erneutem Start nie ueberschrieben).
      const existing = await this.db.user.findUnique({
        where: { username: identifier },
        select: { id: true, role: true, status: true },
      });

      if (existing) {
        this.logger.log(
          'Initialer lokaler Administrator existiert bereits – Bootstrap wird uebersprungen.',
        );
        await this.repairDefaultHouseholdFor(existing);
        return;
      }

      // Phase 2: Admin neu anlegen (Check-then-Insert mit P2002-Race-Absicherung).
      const passwordHash = await this.passwordHashing.hash(password);

      let userId: string | undefined;
      let createdAdmin = false;

      try {
        userId = await this.db.$transaction(async (tx) => {
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

          return user.id;
        });
        createdAdmin = true;
      } catch (error) {
        // P2002 (UNIQUE-Constraint) ist erwartbar: Der Benutzername ist
        // zwischenzeitlich vergeben worden, weil ein paralleles Replica den
        // Admin zeitgleich angelegt hat (Check-then-Insert-Race). In dem
        // Fall wird der vorhandene Administrator weiterverwendet.
        if ((error as { code?: string }).code !== 'P2002') {
          throw error;
        }
        const raced = await this.db.user.findUnique({
          where: { username: identifier },
          select: { id: true, role: true, status: true },
        });
        if (
          raced &&
          raced.role === GlobalRole.ADMIN &&
          raced.status === UserStatus.ACTIVE
        ) {
          this.logger.warn(
            `Benutzername "${identifier}" wurde parallel angelegt – ` +
              'vorhandener lokaler Administrator wird weiterverwendet.',
          );
          userId = raced.id;
        } else {
          this.logger.warn(
            `Bootstrap uebersprungen: Benutzername "${identifier}" ist bereits ` +
              'vergeben, aber es wurde kein aktiver Administrator gefunden.',
          );
          return;
        }
      }

      if (!userId) {
        return;
      }

      // Phase 3: Beta-Referenz-Household + Mitgliedschaft sicherstellen.
      // Schlaegt nur dieser Schritt fehl, ist der Admin bereits vorhanden –
      // das wird separat protokolliert (kein irrefuehrendes "Bootstrap
      // fehlgeschlagen", obwohl der Admin erfolgreich angelegt wurde).
      try {
        await this.ensureDefaultHousehold(userId);
      } catch (error) {
        this.logger.error(
          `Administrator (${identifier}) ist vorhanden, aber das Beta-Referenz-` +
            `Household "${DEFAULT_HOUSEHOLD_ID}" samt Mitgliedschaft konnte ` +
            `nicht sichergestellt werden: ` +
            `${error instanceof Error ? error.message : String(error)}. ` +
            'Ein Neustart wiederholt den Schritt.',
        );
        return;
      }

      if (createdAdmin) {
        this.logger.log(
          `Initialer lokaler Administrator angelegt (${identifier}). ` +
            'Passwort wird nur als Hash gespeichert.',
        );
      }
    } catch (error) {
      // Andere Fehler (z. B. DB nicht erreichbar) werden auf ERROR-Stufe
      // protokolliert, blockieren den Start aber nicht – ein Container-
      // bzw. Prozess-Restart wiederholt den Bootstrap.
      this.logger.error(
        `Initialer Admin-Bootstrap fehlgeschlagen: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Reparaturpfad (AP-20): Existiert der konfigurierte lokale Administrator
   * bereits (z. B. nach einem Upgrade einer Installation mit Bestands-Admin),
   * wird sichergestellt, dass er Mitglied im Beta-Referenz-Household ist –
   * ohne das Passwort anzufassen. Ohne diesen Schritt bliebe die
   * household-gescopte UI (Policen, Kosten, Freigaben, AI) bei Upgrades
   * dauerhaft unbenutzbar.
   *
   * Eine Default-Household-Mitgliedschaft wird ausschliesslich einem aktiven
   * ADMIN zuerkannt: Ein bestehender Nutzer, der lediglich dem Benutzernamen
   * nach zum LOCAL_ADMIN_USERNAME passt, aber eine abweichende Rolle oder
   * einen abweichenden Status hat, erhaelt keine Mitgliedschaft.
   */
  private async repairDefaultHouseholdFor(user: {
    id: string;
    role: GlobalRole;
    status: UserStatus;
  }): Promise<void> {
    if (user.role !== GlobalRole.ADMIN || user.status !== UserStatus.ACTIVE) {
      this.logger.warn(
        `Bestehender Nutzer passt zu LOCAL_ADMIN_USERNAME, ist aber kein ` +
          `aktiver Administrator (role=${user.role}, status=${user.status}) – ` +
          'es wird keine Mitgliedschaft im Beta-Referenz-Household vergeben.',
      );
      return;
    }
    await this.ensureDefaultHousehold(user.id);
  }

  /**
   * AP-20: Beta-Referenz-Household "default" idempotent sicherstellen und
   * den uebergebenen User als Mitglied aufnehmen. Wird sowohl im Erst-
   * Anlage-Pfad als auch als Reparaturpfad aufgerufen (wenn der Admin
   * bereits existiert, z. B. nach einem Upgrade von einer Installation
   * mit Bestands-Admin). Ohne diese Mitgliedschaft wuerden alle
   * /households/default/...-Aufrufe der UI an der HouseholdMembershipGuard
   * scheitern.
   */
  private async ensureDefaultHousehold(userId: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const existingHousehold = await tx.household.findUnique({
        where: { id: DEFAULT_HOUSEHOLD_ID },
        select: { id: true },
      });

      if (!existingHousehold) {
        await tx.household.create({
          data: { id: DEFAULT_HOUSEHOLD_ID, name: 'Default Household' },
        });
        await tx.auditEvent.create({
          data: {
            actorUserId: userId,
            entityType: 'Household',
            entityId: DEFAULT_HOUSEHOLD_ID,
            action: 'BOOTSTRAP_DEFAULT_HOUSEHOLD',
            diffJson: { householdId: DEFAULT_HOUSEHOLD_ID, memberUserId: userId },
          },
        });
      }

      // Mitgliedschaft idempotent sicherstellen. Wird sie dabei neu angelegt
      // (z. B. Reparaturpfad bei Bestands-Admin oder Bestands-Household),
      // wird auch das im Audit-Log festgehalten.
      const existingMembership = await tx.householdMembership.findUnique({
        where: {
          householdId_userId: {
            householdId: DEFAULT_HOUSEHOLD_ID,
            userId,
          },
        },
        select: { householdId: true },
      });

      await tx.householdMembership.upsert({
        where: {
          householdId_userId: {
            householdId: DEFAULT_HOUSEHOLD_ID,
            userId,
          },
        },
        create: {
          householdId: DEFAULT_HOUSEHOLD_ID,
          userId,
        },
        update: {},
      });

      if (!existingMembership) {
        await tx.auditEvent.create({
          data: {
            actorUserId: userId,
            entityType: 'Household',
            entityId: DEFAULT_HOUSEHOLD_ID,
            action: 'BOOTSTRAP_DEFAULT_HOUSEHOLD_MEMBERSHIP',
            diffJson: { householdId: DEFAULT_HOUSEHOLD_ID, memberUserId: userId },
          },
        });
      }
    });
  }
}
