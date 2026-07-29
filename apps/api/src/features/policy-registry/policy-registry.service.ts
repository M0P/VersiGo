import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '@insura/foundation';
import { CreatePolicyDto, UpdatePolicyDto, CreateCoveredPersonDto, UpdateCoveredPersonDto, CreatePortalAccountLinkDto, UpdatePortalAccountLinkDto } from './dto/policy-registry.dto';

@Injectable()
export class PolicyRegistryService {
  constructor(private readonly db: DatabaseService) {}

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

    const policy = await this.db.insurancePolicy.create({
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

    await this.db.auditEvent.create({
      data: {
        actorUserId: userId,
        entityType: 'InsurancePolicy',
        entityId: policy.id,
        action: 'CREATE',
        diffJson: { householdId, type: dto.type, insurerName: dto.insurerName },
      },
    });

    return policy;
  }

  async findAll(householdId: string, userId: string) {
    await this.assertHouseholdAccess(householdId, userId);

    return this.db.insurancePolicy.findMany({
      where: { householdId, archivedAt: null },
      include: {
        coveredPersons: true,
        portalLinks: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(householdId: string, userId: string, policyId: string) {
    await this.assertHouseholdAccess(householdId, userId);

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

    return policy;
  }

  async update(householdId: string, userId: string, policyId: string, dto: UpdatePolicyDto) {
    await this.assertHouseholdAccess(householdId, userId);

    const existing = await this.db.insurancePolicy.findFirst({
      where: { id: policyId, householdId },
    });

    if (!existing) {
      throw new NotFoundException('Versicherung nicht gefunden');
    }

    const policy = await this.db.insurancePolicy.update({
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

    await this.db.auditEvent.create({
      data: {
        actorUserId: userId,
        entityType: 'InsurancePolicy',
        entityId: policyId,
        action: 'UPDATE',
        diffJson: { ...dto },
      },
    });

    return policy;
  }

  async remove(householdId: string, userId: string, policyId: string) {
    await this.assertHouseholdAccess(householdId, userId);

    const existing = await this.db.insurancePolicy.findFirst({
      where: { id: policyId, householdId },
    });

    if (!existing) {
      throw new NotFoundException('Versicherung nicht gefunden');
    }

    await this.db.insurancePolicy.update({
      where: { id: policyId },
      data: { archivedAt: new Date() },
    });

    await this.db.auditEvent.create({
      data: {
        actorUserId: userId,
        entityType: 'InsurancePolicy',
        entityId: policyId,
        action: 'ARCHIVE',
        diffJson: { archivedAt: new Date().toISOString() },
      },
    });

    return { success: true };
  }

  async hardDelete(householdId: string, userId: string, policyId: string) {
    await this.assertHouseholdAccess(householdId, userId);

    const existing = await this.db.insurancePolicy.findFirst({
      where: { id: policyId, householdId },
    });

    if (!existing) {
      throw new NotFoundException('Versicherung nicht gefunden');
    }

    await this.db.insurancePolicy.delete({
      where: { id: policyId },
    });

    await this.db.auditEvent.create({
      data: {
        actorUserId: userId,
        entityType: 'InsurancePolicy',
        entityId: policyId,
        action: 'DELETE',
        diffJson: {},
      },
    });

    return { success: true };
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

    const person = await this.db.coveredPerson.create({
      data: {
        policyId,
        personName: dto.personName,
        relationType: dto.relationType,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
      },
    });

    await this.db.auditEvent.create({
      data: {
        actorUserId: userId,
        entityType: 'CoveredPerson',
        entityId: person.id,
        action: 'CREATE',
        diffJson: { policyId, personName: dto.personName },
      },
    });

    return person;
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

    const person = await this.db.coveredPerson.update({
      where: { id: personId },
      data: {
        personName: dto.personName,
        relationType: dto.relationType,
        birthDate: dto.birthDate !== undefined ? (dto.birthDate ? new Date(dto.birthDate) : null) : undefined,
      },
    });

    await this.db.auditEvent.create({
      data: {
        actorUserId: userId,
        entityType: 'CoveredPerson',
        entityId: personId,
        action: 'UPDATE',
        diffJson: { ...dto },
      },
    });

    return person;
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

    await this.db.coveredPerson.delete({
      where: { id: personId },
    });

    return { success: true };
  }

  // Portal Account Links

  async createPortalLink(householdId: string, userId: string, policyId: string, dto: CreatePortalAccountLinkDto) {
    await this.assertHouseholdAccess(householdId, userId);

    const policy = await this.db.insurancePolicy.findFirst({
      where: { id: policyId, householdId },
    });

    if (!policy) {
      throw new NotFoundException('Versicherung nicht gefunden');
    }

    const link = await this.db.portalAccountLink.create({
      data: {
        policyId,
        providerKey: dto.providerKey,
        portalUrl: dto.portalUrl,
        usernameHint: dto.usernameHint,
        mailboxCapability: dto.mailboxCapability ?? false,
        syncStatus: dto.syncStatus ?? 'PENDING',
      },
    });

    await this.db.auditEvent.create({
      data: {
        actorUserId: userId,
        entityType: 'PortalAccountLink',
        entityId: link.id,
        action: 'CREATE',
        diffJson: { policyId, providerKey: dto.providerKey },
      },
    });

    return link;
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

    const link = await this.db.portalAccountLink.update({
      where: { id: linkId },
      data: {
        providerKey: dto.providerKey,
        portalUrl: dto.portalUrl,
        usernameHint: dto.usernameHint,
        mailboxCapability: dto.mailboxCapability,
        syncStatus: dto.syncStatus,
      },
    });

    await this.db.auditEvent.create({
      data: {
        actorUserId: userId,
        entityType: 'PortalAccountLink',
        entityId: linkId,
        action: 'UPDATE',
        diffJson: { ...dto },
      },
    });

    return link;
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

    await this.db.portalAccountLink.delete({
      where: { id: linkId },
    });

    return { success: true };
  }
}
