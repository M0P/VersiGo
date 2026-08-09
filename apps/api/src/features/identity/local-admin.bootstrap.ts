import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService, AppConfigService } from '@versigo/foundation';
import { GlobalRole, UserStatus } from '@prisma/client';
import { PasswordHashingService } from './password-hashing.service';
import { normalizeIdentifier } from './auth.service';

/**
 * Fixed ID of the beta reference household. The web UI addresses
 * household-scoped endpoints consistently via /households/default/...,
 * so the household must carry exactly this ID (not a UUID).
 */
export const DEFAULT_HOUSEHOLD_ID = 'default';

/**
 * Idempotent bootstrap for the initial local administrator.
 *
 * Runs when local authentication is enabled and LOCAL_ADMIN_USERNAME and
 * LOCAL_ADMIN_PASSWORD are explicitly set. On first start against an
 * empty database exactly one admin is created from these variables;
 * further starts do not create a duplicate and do not overwrite the
 * password of an existing account.
 *
 * In production LOCAL_AUTH_ENABLED defaults to false
 * (app-config.schema.ts: `LOCAL_AUTH_ENABLED ?? NODE_ENV !== 'production'`),
 * so `true` there is always an explicit configuration: a default admin is
 * never created automatically, only an explicitly configured initial
 * administrator (AP-20 P5). In production the .env.example placeholder
 * password is also rejected.
 *
 * ADR-007: the user gets the global role ADMIN and status ACTIVE. The
 * former OIDC placeholder issuer "local" is gone (bindings only via real
 * OIDC providers, see ADR-007).
 *
 * AP-20: in addition to the admin, the beta reference household with the
 * fixed ID "default" is created (the web UI consistently uses
 * /households/default/...) and the admin receives a membership. Only then
 * are the household-scoped business functions (policies, costs, shares,
 * AI) reachable via the UI. Both steps are idempotent (upsert).
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
   * Runs the bootstrap if the prerequisites are met. Never throws:
   * expected duplicates (P2002 on the UNIQUE constraint) are logged as
   * warnings, other runtime errors (e.g. unreachable DB) at ERROR level –
   * neither blocks the application start (fail-fast only applies to
   * missing authentication methods in the IdentityModule).
   */
  async bootstrap(): Promise<void> {
    // Defense-in-depth: the caller (IdentityModule) only invokes the
    // bootstrap when local auth is active; the check here also protects
    // against accidental calls from other contexts. In production
    // LOCAL_AUTH_ENABLED defaults to false – true there always means an
    // explicit configuration (no automatic default admin).
    if (!this.config.get('LOCAL_AUTH_ENABLED')) {
      return;
    }

    const username = this.config.get('LOCAL_ADMIN_USERNAME');
    const password = this.config.get('LOCAL_ADMIN_PASSWORD');

    if (!username || !password) {
      this.logger.warn(
        'LOCAL_ADMIN_USERNAME/LOCAL_ADMIN_PASSWORD not set – ' +
          'no initial local administrator will be created.',
      );
      return;
    }

    // AP-20 (P5): in production the known .env.example placeholder
    // password must never be used for bootstrapping. If the placeholder
    // is detected, the bootstrap is refused (no admin, no default
    // household) and the error is logged clearly.
    if (
      this.config.isProduction &&
      password === 'CHANGE_ME_FOR_LOCAL_DEVELOPMENT'
    ) {
      this.logger.error(
        'LOCAL_ADMIN_PASSWORD matches the .env.example placeholder. ' +
          'No initial administrator will be created in production – ' +
          'please set your own strong password.',
      );
      return;
    }

    const identifier = normalizeIdentifier(username);

    try {
      // Phase 1: find an existing admin (idempotent; an existing
      // password is never overwritten on a later start).
      const existing = await this.db.user.findUnique({
        where: { username: identifier },
        select: { id: true, role: true, status: true },
      });

      if (existing) {
        this.logger.log(
          'Initial local administrator already exists – skipping bootstrap.',
        );
        await this.repairDefaultHouseholdFor(existing);
        return;
      }

      // Phase 2: create the admin (check-then-insert with P2002 race protection).
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
        // P2002 (UNIQUE constraint) is expected: the username was taken
        // in the meantime because a parallel replica created the admin
        // simultaneously (check-then-insert race). In that case the
        // existing administrator is reused.
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
            `Username "${identifier}" was created in parallel – ` +
              'reusing the existing local administrator.',
          );
          userId = raced.id;
        } else {
          this.logger.warn(
            `Bootstrap skipped: username "${identifier}" is already taken, ` +
              'but no active administrator was found.',
          );
          return;
        }
      }

      if (!userId) {
        return;
      }

      // Phase 3: ensure the beta reference household + membership.
      // If only this step fails, the admin already exists – this is logged
      // separately (no misleading "bootstrap failed" although the admin
      // was created successfully).
      try {
        await this.ensureDefaultHousehold(userId);
      } catch (error) {
        this.logger.error(
          `Administrator (${identifier}) exists, but the beta reference ` +
            `household "${DEFAULT_HOUSEHOLD_ID}" including the membership ` +
            `could not be ensured: ` +
            `${error instanceof Error ? error.message : String(error)}. ` +
            'A restart repeats the step.',
        );
        return;
      }

      if (createdAdmin) {
        this.logger.log(
          `Initial local administrator created (${identifier}). ` +
            'The password is only stored as a hash.',
        );
      }
    } catch (error) {
      // Other errors (e.g. unreachable DB) are logged at ERROR level but
      // do not block the start – a container or process restart repeats
      // the bootstrap.
      this.logger.error(
        `Initial admin bootstrap failed: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Repair path (AP-20): if the configured local administrator already
   * exists (e.g. after upgrading an installation with an existing admin),
   * it is ensured that they are a member of the beta reference household –
   * without touching the password. Without this step the household-scoped
   * UI (policies, costs, shares, AI) would remain permanently unusable
   * after upgrades.
   *
   * A default household membership is only granted to an active ADMIN: an
   * existing user who merely matches LOCAL_ADMIN_USERNAME by username but
   * has a different role or status receives no membership.
   */
  private async repairDefaultHouseholdFor(user: {
    id: string;
    role: GlobalRole;
    status: UserStatus;
  }): Promise<void> {
    if (user.role !== GlobalRole.ADMIN || user.status !== UserStatus.ACTIVE) {
      this.logger.warn(
        `Existing user matches LOCAL_ADMIN_USERNAME but is not an active ` +
          `administrator (role=${user.role}, status=${user.status}) – ` +
          'no membership in the beta reference household is granted.',
      );
      return;
    }
    await this.ensureDefaultHousehold(user.id);
  }

  /**
   * AP-20: ensure the beta reference household "default" idempotently and
   * add the given user as a member. Called both in the initial creation
   * path and as a repair path (when the admin already exists, e.g. after
   * upgrading an installation with an existing admin). Without this
   * membership all /households/default/... UI calls would fail at the
   * HouseholdMembershipGuard.
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

      // Ensure the membership idempotently. If it is newly created here
      // (e.g. repair path with an existing admin or household), this is
      // also recorded in the audit log.
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
