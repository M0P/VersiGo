import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { DatabaseService, ENCRYPTION_PORT, EncryptionPort } from '@versigo/foundation';
import { GlobalRole, Prisma, PortalAccountLink } from '@prisma/client';
import { AuthService, AuthenticatedUser } from '../identity/auth.service';
import { PortalConnectorService } from '../portal-connectors/portal-connector.service';
import {
  CreatePolicyDto,
  UpdatePolicyDto,
  CreateCoveredPersonDto,
  UpdateCoveredPersonDto,
  CreatePortalAccountLinkDto,
  UpdatePortalAccountLinkDto,
  PortalCredentialsDto,
} from './dto/policy-registry.dto';

@Injectable()
export class PolicyRegistryService {
  private readonly logger = new Logger(PolicyRegistryService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly authService: AuthService,
    @Inject(ENCRYPTION_PORT) private readonly encryption: EncryptionPort,
    private readonly portalConnectors: PortalConnectorService,
  ) {}

  private async assertHouseholdAccess(householdId: string, userId: string): Promise<void> {
    const membership = await this.db.householdMembership.findUnique({
      where: { householdId_userId: { householdId, userId } },
    });
    if (!membership) {
      throw new ForbiddenException('Isolation: kein Zugriff auf fremdes Household');
    }
  }

  async create(householdId: string, userId: string, dto: CreatePolicyDto) {
    await this.assertHouseholdAccess(householdId, userId);

    return this.db.$transaction(async (tx) => {
      const policy = await tx.insurancePolicy.create({
        data: {
          householdId,
          ownerUserId: userId,
          type: dto.type,
          insurerName: dto.insurerName,
          insurerPortalUrl: dto.insurerPortalUrl,
          contractNumber: dto.contractNumber,
          tariffName: dto.tariffName,
          status: dto.status ?? 'ACTIVE',
          startDate: new Date(dto.startDate),
          endDate: dto.endDate ? new Date(dto.endDate) : undefined,
          renewalDate: dto.renewalDate ? new Date(dto.renewalDate) : undefined,
          noticePeriod: dto.noticePeriod,
          paymentFrequency: dto.paymentFrequency,
          premiumAmount: dto.premiumAmount,
          deductibleAmount: dto.deductibleAmount,
          coverageSummaryShort: dto.coverageSummaryShort,
          source: dto.source ?? 'MANUAL',
        },
        include: {
          coveredPersons: true,
          costEntries: true,
          documents: true,
          portalLinks: true,
        },
      });

      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'InsurancePolicy',
          entityId: policy.id,
          action: 'CREATE',
          diffJson: { householdId, type: dto.type, insurerName: dto.insurerName },
        },
      });

      return policy;
    }).catch((err) => {
      this.logger.error(`create policy failed: ${err.message}`, err.stack);
      throw err;
    });
  }

  async findAll(householdId: string, user: AuthenticatedUser) {
    await this.assertHouseholdAccess(householdId, user.id);

    // READ_ONLY: nur explizit freigegebene Policies (ADR-007/AP-16)
    const readableIds = await this.authService.getReadablePolicyIds(user, householdId);
    const where =
      user.role === GlobalRole.READ_ONLY && readableIds
        ? { householdId, archivedAt: null, id: { in: readableIds } }
        : { householdId, archivedAt: null };

    const policies = await this.db.insurancePolicy.findMany({
      where,
      include: {
        coveredPersons: true,
        portalLinks: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // AP-18: Portal-Links anreichern (Deeplink-Aufloesung, Katalog-/Connector-
    // Sicht, credentialsSet). Ein nicht verfuegbarer Connector faellt dabei
    // kontrolliert weg, ohne den Portal-Link zu beeintraechtigen.
    return policies.map((policy) => ({
      ...policy,
      portalLinks: policy.portalLinks.map((link) =>
        this.portalConnectors.enrichPortalLink(link, policy.contractNumber),
      ),
    }));
  }

  async findOne(householdId: string, user: AuthenticatedUser, policyId: string) {
    // Wirft 403/404 je nach Rolle und Freigabe (READ_ONLY nur bei Share)
    await this.authService.assertPolicyReadAccess(user, householdId, policyId);

    const policy = await this.db.insurancePolicy.findFirst({
      where: { id: policyId, householdId },
      include: {
        coveredPersons: true,
        costEntries: { orderBy: { validFrom: 'desc' } },
        documents: true,
        portalLinks: true,
      },
    });

    if (!policy) {
      throw new NotFoundException('Versicherung nicht gefunden');
    }

    // AP-18: Portal-Links anreichern (analog findAll).
    return {
      ...policy,
      portalLinks: policy.portalLinks.map((link) =>
        this.portalConnectors.enrichPortalLink(link, policy.contractNumber),
      ),
    };
  }

  async update(householdId: string, userId: string, policyId: string, dto: UpdatePolicyDto) {
    await this.assertHouseholdAccess(householdId, userId);

    const existing = await this.db.insurancePolicy.findFirst({
      where: { id: policyId, householdId },
    });

    if (!existing) {
      throw new NotFoundException('Versicherung nicht gefunden');
    }

    return this.db.$transaction(async (tx) => {
      const policy = await tx.insurancePolicy.update({
        where: { id: policyId },
        data: {
          type: dto.type,
          insurerName: dto.insurerName,
          insurerPortalUrl: dto.insurerPortalUrl,
          contractNumber: dto.contractNumber,
          tariffName: dto.tariffName,
          status: dto.status,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          endDate: dto.endDate !== undefined ? (dto.endDate ? new Date(dto.endDate) : null) : undefined,
          renewalDate: dto.renewalDate !== undefined ? (dto.renewalDate ? new Date(dto.renewalDate) : null) : undefined,
          noticePeriod: dto.noticePeriod,
          paymentFrequency: dto.paymentFrequency,
          premiumAmount: dto.premiumAmount,
          deductibleAmount: dto.deductibleAmount,
          coverageSummaryShort: dto.coverageSummaryShort,
          source: dto.source,
        },
        include: {
          coveredPersons: true,
          costEntries: true,
          documents: true,
          portalLinks: true,
        },
      });

      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'InsurancePolicy',
          entityId: policyId,
          action: 'UPDATE',
          diffJson: { ...dto },
        },
      });

      // AP-18: Portal-Links anreichern, damit `credentialsEncrypted` nie in
      // der Antwort auftaucht (analog findAll/findOne).
      return {
        ...policy,
        portalLinks: policy.portalLinks.map((link) =>
          this.portalConnectors.enrichPortalLink(link, policy.contractNumber),
        ),
      };
    }).catch((err) => {
      this.logger.error(`update policy ${policyId} failed: ${err.message}`, err.stack);
      throw err;
    });
  }

  async remove(householdId: string, userId: string, policyId: string) {
    await this.assertHouseholdAccess(householdId, userId);

    const existing = await this.db.insurancePolicy.findFirst({
      where: { id: policyId, householdId },
    });

    if (!existing) {
      throw new NotFoundException('Versicherung nicht gefunden');
    }

    return this.db.$transaction(async (tx) => {
      await tx.insurancePolicy.update({
        where: { id: policyId },
        data: { archivedAt: new Date() },
      });

      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'InsurancePolicy',
          entityId: policyId,
          action: 'ARCHIVE',
          diffJson: { archivedAt: new Date().toISOString() },
        },
      });

      return { success: true };
    }).catch((err) => {
      this.logger.error(`remove policy ${policyId} failed: ${err.message}`, err.stack);
      throw err;
    });
  }

  async hardDelete(householdId: string, userId: string, policyId: string) {
    await this.assertHouseholdAccess(householdId, userId);

    const existing = await this.db.insurancePolicy.findFirst({
      where: { id: policyId, householdId },
    });

    if (!existing) {
      throw new NotFoundException('Versicherung nicht gefunden');
    }

    return this.db.$transaction(async (tx) => {
      await tx.insurancePolicy.delete({
        where: { id: policyId },
      });

      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'InsurancePolicy',
          entityId: policyId,
          action: 'DELETE',
          diffJson: {},
        },
      });

      return { success: true };
    }).catch((err) => {
      this.logger.error(`hardDelete policy ${policyId} failed: ${err.message}`, err.stack);
      throw err;
    });
  }

  // Dashboard Pinning (BugFix-06, Teil 4)
  //
  // Policies can be pinned to the dashboard per household. The pin is stored
  // on the policy itself (nullable `pinnedAt`), so all household members see
  // the same pin state; READ_ONLY members only see policies that were shared
  // with them (same rule as findAll).

  async findPinned(householdId: string, user: AuthenticatedUser) {
    await this.assertHouseholdAccess(householdId, user.id);

    const readableIds = await this.authService.getReadablePolicyIds(user, householdId);
    const where =
      user.role === GlobalRole.READ_ONLY && readableIds
        ? { householdId, archivedAt: null, pinnedAt: { not: null }, id: { in: readableIds } }
        : { householdId, archivedAt: null, pinnedAt: { not: null } };

    const policies = await this.db.insurancePolicy.findMany({
      where,
      include: {
        coveredPersons: true,
        portalLinks: true,
      },
      orderBy: { pinnedAt: 'desc' },
    });

    return policies.map((policy) => this.withEnrichedPortalLinks(policy));
  }

  async pin(householdId: string, userId: string, policyId: string) {
    await this.assertHouseholdAccess(householdId, userId);

    const existing = await this.db.insurancePolicy.findFirst({
      where: { id: policyId, householdId },
    });

    if (!existing) {
      throw new NotFoundException('Versicherung nicht gefunden');
    }

    const pinnedAt = new Date();
    return this.db.$transaction(async (tx) => {
      const policy = await tx.insurancePolicy.update({
        where: { id: policyId },
        data: { pinnedAt },
      });

      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'InsurancePolicy',
          entityId: policyId,
          action: 'PIN',
          diffJson: { pinnedAt: pinnedAt.toISOString() },
        },
      });

      return policy;
    });
  }

  async unpin(householdId: string, userId: string, policyId: string) {
    await this.assertHouseholdAccess(householdId, userId);

    const existing = await this.db.insurancePolicy.findFirst({
      where: { id: policyId, householdId },
    });

    if (!existing) {
      throw new NotFoundException('Versicherung nicht gefunden');
    }

    return this.db.$transaction(async (tx) => {
      const policy = await tx.insurancePolicy.update({
        where: { id: policyId },
        data: { pinnedAt: null },
      });

      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'InsurancePolicy',
          entityId: policyId,
          action: 'UNPIN',
          diffJson: {},
        },
      });

      return policy;
    });
  }

  /** AP-18: Portal-Links anreichern (Deeplink-Aufloesung, Katalog-/Connector-Sicht). */
  private withEnrichedPortalLinks(policy: { contractNumber: string | null; portalLinks: PortalAccountLink[] }) {
    return {
      ...policy,
      portalLinks: policy.portalLinks.map((link) =>
        this.portalConnectors.enrichPortalLink(link, policy.contractNumber),
      ),
    };
  }

  // Covered Persons

  async addCoveredPerson(householdId: string, userId: string, policyId: string, dto: CreateCoveredPersonDto) {
    await this.assertHouseholdAccess(householdId, userId);

    const policy = await this.db.insurancePolicy.findFirst({
      where: { id: policyId, householdId },
    });

    if (!policy) {
      throw new NotFoundException('Versicherung nicht gefunden');
    }

    return this.db.$transaction(async (tx) => {
      const person = await tx.coveredPerson.create({
        data: {
          policyId,
          personName: dto.personName,
          relationType: dto.relationType,
          birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        },
      });

      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'CoveredPerson',
          entityId: person.id,
          action: 'CREATE',
          diffJson: { policyId, personName: dto.personName },
        },
      });

      return person;
    }).catch((err) => {
      this.logger.error(`addCoveredPerson failed: ${err.message}`, err.stack);
      throw err;
    });
  }

  async updateCoveredPerson(householdId: string, userId: string, policyId: string, personId: string, dto: UpdateCoveredPersonDto) {
    await this.assertHouseholdAccess(householdId, userId);

    const policy = await this.db.insurancePolicy.findFirst({
      where: { id: policyId, householdId },
    });

    if (!policy) {
      throw new NotFoundException('Versicherung nicht gefunden');
    }

    const existing = await this.db.coveredPerson.findFirst({
      where: { id: personId, policyId },
    });

    if (!existing) {
      throw new NotFoundException('Versicherte Person nicht gefunden');
    }

    return this.db.$transaction(async (tx) => {
      const person = await tx.coveredPerson.update({
        where: { id: personId },
        data: {
          personName: dto.personName,
          relationType: dto.relationType,
          birthDate: dto.birthDate !== undefined ? (dto.birthDate ? new Date(dto.birthDate) : null) : undefined,
        },
      });

      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'CoveredPerson',
          entityId: personId,
          action: 'UPDATE',
          diffJson: { ...dto },
        },
      });

      return person;
    }).catch((err) => {
      this.logger.error(`updateCoveredPerson ${personId} failed: ${err.message}`, err.stack);
      throw err;
    });
  }

  async removeCoveredPerson(householdId: string, userId: string, policyId: string, personId: string) {
    await this.assertHouseholdAccess(householdId, userId);

    const policy = await this.db.insurancePolicy.findFirst({
      where: { id: policyId, householdId },
    });

    if (!policy) {
      throw new NotFoundException('Versicherung nicht gefunden');
    }

    const existing = await this.db.coveredPerson.findFirst({
      where: { id: personId, policyId },
    });

    if (!existing) {
      throw new NotFoundException('Versicherte Person nicht gefunden');
    }

    return this.db.$transaction(async (tx) => {
      await tx.coveredPerson.delete({ where: { id: personId } });

      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'CoveredPerson',
          entityId: personId,
          action: 'DELETE',
          diffJson: { policyId },
        },
      });

      return { success: true };
    }).catch((err) => {
      this.logger.error(`removeCoveredPerson ${personId} failed: ${err.message}`, err.stack);
      throw err;
    });
  }

  // Portal Account Links

  /**
   * Verschluesselt optionale Portal-Zugangsdaten (AP-18).
   * Liefert null, wenn keine Zugangsdaten angegeben sind. Credentials
   * werden NIE im Klartext gespeichert, geloggt oder zurueckgegeben.
   */
  private async encryptCredentials(
    credentials: PortalCredentialsDto | null | undefined,
  ): Promise<string | null> {
    if (!credentials) return null;
    if (!credentials.portalUsername?.trim() && !credentials.portalPassword?.trim()) {
      throw new BadRequestException(
        'Mindestens ein Zugangsdatenfeld (portalUsername oder portalPassword) muss gesetzt sein',
      );
    }
    // `!= null` statt `!== undefined`: null-Werte (leere Felder) werden
    // ebenfalls verworfen, es wird nur echte Strings persistiert.
    // Der Benutzername wird getrimmt; das Passwort wird BEWUSST ungetrimmt
    // gespeichert (fuehrende/abschliessende Leerzeichen koennen signifikant
    // sein). Nur rein-whitespace-Passwoerter entfallen.
    const payload = JSON.stringify({
      ...(credentials.portalUsername != null && credentials.portalUsername.trim() !== ''
        ? { portalUsername: credentials.portalUsername.trim() }
        : {}),
      ...(credentials.portalPassword != null && credentials.portalPassword.trim() !== ''
        ? { portalPassword: credentials.portalPassword }
        : {}),
    });
    return this.encryption.encrypt(payload);
  }

  /**
   * Baut ein redigiertes Audit-Diff fuer Portal-Links. Credentials-Werte
   * duerfen niemals in Audit-Events auftauchen; nur `credentialsSet`.
   * Der Rueckgabetyp ist auf Prisma `InputJsonValue` beschraenkt, damit
   * das Diff direkt als `diffJson` (Json-Feld) nutzbar ist.
   */
  private portalLinkAuditDiff(
    dto: CreatePortalAccountLinkDto | UpdatePortalAccountLinkDto,
  ): Prisma.InputJsonValue {
    const diff: Record<string, Prisma.InputJsonValue> = {};
    for (const key of [
      'providerKey',
      'portalUrl',
      'usernameHint',
      'accessHint',
      'connectorKey',
      'mailboxCapability',
      'syncStatus',
    ] as const) {
      const value = (dto as unknown as Record<string, Prisma.InputJsonValue | undefined>)[key];
      if (value !== undefined) diff[key] = value;
    }
    if ('credentials' in dto && dto.credentials !== undefined) {
      diff.credentialsSet = dto.credentials !== null;
    }
    return diff;
  }

  async createPortalLink(householdId: string, userId: string, policyId: string, dto: CreatePortalAccountLinkDto) {
    await this.assertHouseholdAccess(householdId, userId);

    const policy = await this.db.insurancePolicy.findFirst({
      where: { id: policyId, householdId },
    });

    if (!policy) {
      throw new NotFoundException('Versicherung nicht gefunden');
    }

    const credentialsEncrypted = await this.encryptCredentials(dto.credentials);

    return this.db.$transaction(async (tx) => {
      const link = await tx.portalAccountLink.create({
        data: {
          policyId,
          providerKey: dto.providerKey,
          portalUrl: dto.portalUrl,
          accessHint: dto.accessHint,
          usernameHint: dto.usernameHint,
          connectorKey: dto.connectorKey,
          credentialsEncrypted,
          mailboxCapability: dto.mailboxCapability ?? false,
          syncStatus: dto.syncStatus ?? 'PENDING',
        },
      });

      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'PortalAccountLink',
          entityId: link.id,
          action: 'CREATE',
          diffJson: this.portalLinkAuditDiff(dto),
        },
      });

      return this.portalConnectors.enrichPortalLink(link, policy.contractNumber);
    }).catch((err) => {
      this.logger.error(`createPortalLink failed: ${err.message}`, err.stack);
      throw err;
    });
  }

  async updatePortalLink(householdId: string, userId: string, policyId: string, linkId: string, dto: UpdatePortalAccountLinkDto) {
    await this.assertHouseholdAccess(householdId, userId);

    const policy = await this.db.insurancePolicy.findFirst({
      where: { id: policyId, householdId },
    });

    if (!policy) {
      throw new NotFoundException('Versicherung nicht gefunden');
    }

    const existing = await this.db.portalAccountLink.findFirst({
      where: { id: linkId, policyId },
    });

    if (!existing) {
      throw new NotFoundException('Portal-Link nicht gefunden');
    }

    // Credentials: Objekt => setzen/ersetzen, null => loeschen,
    // nicht angegeben => unveraendert lassen. Nie Klartext speichern.
    let credentialsEncrypted: string | null | undefined;
    if ('credentials' in dto && dto.credentials !== undefined) {
      credentialsEncrypted = await this.encryptCredentials(dto.credentials);
    }

    return this.db.$transaction(async (tx) => {
      const link = await tx.portalAccountLink.update({
        where: { id: linkId },
        data: {
          providerKey: dto.providerKey,
          portalUrl: dto.portalUrl,
          accessHint: dto.accessHint,
          usernameHint: dto.usernameHint,
          connectorKey: dto.connectorKey,
          credentialsEncrypted,
          mailboxCapability: dto.mailboxCapability,
          syncStatus: dto.syncStatus,
        },
      });

      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'PortalAccountLink',
          entityId: linkId,
          action: 'UPDATE',
          diffJson: this.portalLinkAuditDiff(dto),
        },
      });

      return this.portalConnectors.enrichPortalLink(link, policy.contractNumber);
    }).catch((err) => {
      this.logger.error(`updatePortalLink ${linkId} failed: ${err.message}`, err.stack);
      throw err;
    });
  }

  async removePortalLink(householdId: string, userId: string, policyId: string, linkId: string) {
    await this.assertHouseholdAccess(householdId, userId);

    const policy = await this.db.insurancePolicy.findFirst({
      where: { id: policyId, householdId },
    });

    if (!policy) {
      throw new NotFoundException('Versicherung nicht gefunden');
    }

    const existing = await this.db.portalAccountLink.findFirst({
      where: { id: linkId, policyId },
    });

    if (!existing) {
      throw new NotFoundException('Portal-Link nicht gefunden');
    }

    return this.db.$transaction(async (tx) => {
      await tx.portalAccountLink.delete({ where: { id: linkId } });

      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'PortalAccountLink',
          entityId: linkId,
          action: 'DELETE',
          diffJson: { policyId },
        },
      });

      return { success: true };
    }).catch((err) => {
      this.logger.error(`removePortalLink ${linkId} failed: ${err.message}`, err.stack);
      throw err;
    });
  }
}
