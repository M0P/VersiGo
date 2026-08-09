import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AppConfigService, DatabaseService } from '@versigo/foundation';
import { GlobalRole, UserStatus } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import type { AuthenticatedUser } from '../identity/auth.service';

/**
 * GDPR export (without binaries / raw AI payloads):
 * - Account (without password hash, without encrypted values)
 * - Preferences, household memberships
 * - Own policies incl. insured persons, costs, document metadata, portal
 *   links (without access data/URLs? -> providerKey suffices), AI jobs
 * - Own audit events (metadata)
 */
export interface PrivacyExport {
  exportedAt: string;
  user: {
    id: string;
    username: string;
    displayName: string;
    email: string | null;
    locale: string;
    role: GlobalRole;
    status: UserStatus;
    oidcIssuer: string | null;
    oidcSubject: string | null;
    createdAt: string;
  };
  preferences: { key: string; value: string; updatedAt: string }[];
  households: { householdId: string; householdName: string }[];
  policies: Array<{
    id: string;
    type: string;
    insurerName: string;
    contractNumber: string;
    tariffName: string | null;
    status: string;
    startDate: string;
    endDate: string | null;
    renewalDate: string | null;
    premiumAmount: string | null;
    deductibleAmount: string | null;
    source: string;
    createdAt: string;
    updatedAt: string;
    coveredPersons: { personName: string; relationType: string; birthDate: string | null }[];
    costEntries: {
      validFrom: string;
      validTo: string | null;
      grossAmount: string;
      netAmount: string | null;
      frequency: string;
      bookingSource: string | null;
      note: string | null;
    }[];
    documents: {
      fileName: string;
      mimeType: string | null;
      fileSize: number | null;
      storageType: string;
      category: string | null;
      documentDate: string | null;
      uploadedAt: string;
    }[];
    portalLinks: {
      providerKey: string;
      mailboxCapability: boolean;
      lastSyncAt: string | null;
      syncStatus: string;
    }[];
    aiExtractionJobs: {
      id: string;
      providerKey: string;
      model: string | null;
      status: string;
      retryCount: number;
      createdAt: string;
      updatedAt: string;
      completedAt: string | null;
    }[];
  }>;
  auditEvents: { action: string; entityType: string; entityId: string; createdAt: string }[];
}

/**
 * Privacy/GDPR slice (AP-19).
 *
 * Permission boundaries:
 * - `exportPersonalData` and `deleteAccount` use exclusively the session
 *   identity (user.id), never path/query parameters -> no IDOR.
 * - Role gate in the controller: @Roles(GlobalRole.USER) -> USER and
 *   ADMIN (hierarchical), READ_ONLY gets 403 (consistent with
 *   profile/preferences, ADR-007).
 * - Last-admin protection: the last active ADMIN cannot delete itself
 *   (otherwise a lockout of the whole system).
 *
 * Deletion semantics: inside one transaction, first all own policies
 * (cascade to insured persons/costs/documents/portal links/AI jobs) are
 * deleted, then the household memberships. A household is only deleted
 * when neither members nor policies remain (invariant: all policies of a
 * household belong to its members; the guard prevents data loss for
 * other users). Finally, the user is deleted (cascade to
 * credentials/preferences; audit references are neutralized via SetNull
 * -> the audit trail is preserved). Physical document files are removed
 * from storage AFTER a successful DB commit (safe-path-guarded,
 * ENOENT-tolerant).
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);
  private readonly storagePath: string;

  constructor(
    private readonly db: DatabaseService,
    config: AppConfigService,
  ) {
    this.storagePath = path.resolve(config.get('DOCUMENTS_STORAGE_PATH'));
  }

  async exportPersonalData(userId: string): Promise<PrivacyExport> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      include: {
        userPreferences: true,
        memberships: { include: { household: true } },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const policies = await this.db.insurancePolicy.findMany({
      where: { ownerUserId: userId },
      orderBy: { createdAt: 'asc' },
      include: {
        coveredPersons: true,
        costEntries: true,
        documents: {
          select: {
            fileName: true,
            mimeType: true,
            fileSize: true,
            storageType: true,
            category: true,
            documentDate: true,
            uploadedAt: true,
          },
        },
        portalLinks: {
          select: {
            providerKey: true,
            mailboxCapability: true,
            lastSyncAt: true,
            syncStatus: true,
          },
        },
        aiExtractionJobs: {
          select: {
            id: true,
            providerKey: true,
            model: true,
            status: true,
            retryCount: true,
            createdAt: true,
            updatedAt: true,
            completedAt: true,
          },
        },
      },
    });

    const auditEvents = await this.db.auditEvent.findMany({
      where: { actorUserId: userId },
      orderBy: { createdAt: 'asc' },
      take: 500,
      select: { action: true, entityType: true, entityId: true, createdAt: true },
    });

    return {
      exportedAt: new Date().toISOString(),
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        locale: user.locale,
        role: user.role,
        status: user.status,
        oidcIssuer: user.oidcIssuer,
        oidcSubject: user.oidcSubject,
        createdAt: user.createdAt.toISOString(),
      },
      preferences: user.userPreferences.map((p) => ({
        key: p.key,
        value: p.value,
        updatedAt: p.updatedAt.toISOString(),
      })),
      households: user.memberships.map((m) => ({
        householdId: m.householdId,
        householdName: m.household.name,
      })),
      policies: policies.map((policy) => ({
        id: policy.id,
        type: policy.type,
        insurerName: policy.insurerName,
        contractNumber: policy.contractNumber,
        tariffName: policy.tariffName,
        status: policy.status,
        startDate: policy.startDate.toISOString(),
        endDate: policy.endDate?.toISOString() ?? null,
        renewalDate: policy.renewalDate?.toISOString() ?? null,
        premiumAmount: policy.premiumAmount?.toString() ?? null,
        deductibleAmount: policy.deductibleAmount?.toString() ?? null,
        source: policy.source,
        createdAt: policy.createdAt.toISOString(),
        updatedAt: policy.updatedAt.toISOString(),
        coveredPersons: policy.coveredPersons.map((cp) => ({
          personName: cp.personName,
          relationType: cp.relationType,
          birthDate: cp.birthDate?.toISOString() ?? null,
        })),
        costEntries: policy.costEntries.map((ce) => ({
          validFrom: ce.validFrom.toISOString(),
          validTo: ce.validTo?.toISOString() ?? null,
          grossAmount: ce.grossAmount.toString(),
          netAmount: ce.netAmount?.toString() ?? null,
          frequency: ce.frequency,
          bookingSource: ce.bookingSource,
          note: ce.note,
        })),
        documents: policy.documents.map((d) => ({
          fileName: d.fileName,
          mimeType: d.mimeType,
          fileSize: d.fileSize,
          storageType: d.storageType,
          category: d.category,
          documentDate: d.documentDate?.toISOString() ?? null,
          uploadedAt: d.uploadedAt.toISOString(),
        })),
        portalLinks: policy.portalLinks.map((pl) => ({
          providerKey: pl.providerKey,
          mailboxCapability: pl.mailboxCapability,
          lastSyncAt: pl.lastSyncAt?.toISOString() ?? null,
          syncStatus: pl.syncStatus,
        })),
        aiExtractionJobs: policy.aiExtractionJobs.map((job) => ({
          id: job.id,
          providerKey: job.providerKey,
          model: job.model,
          status: job.status,
          retryCount: job.retryCount,
          createdAt: job.createdAt.toISOString(),
          updatedAt: job.updatedAt.toISOString(),
          completedAt: job.completedAt?.toISOString() ?? null,
        })),
      })),
      auditEvents: auditEvents.map((e) => ({
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  async deleteAccount(user: AuthenticatedUser): Promise<void> {
    const userId = user.id;

    let filesToRemove: string[] = [];
    await this.db.$transaction(async (tx) => {
      // 1. Letzter-Admin-Schutz
      if (user.role === GlobalRole.ADMIN) {
        const activeAdmins = await tx.user.count({
          where: { role: GlobalRole.ADMIN, status: UserStatus.ACTIVE },
        });
        if (activeAdmins <= 1) {
          throw new ConflictException(
            'The last active administrator cannot delete their account',
          );
        }
      }

      // 2. Collect local file paths of own INTERNAL documents (for the
      //    physical cleanup AFTER the DB commit).
      const ownedPolicies = await tx.insurancePolicy.findMany({
        where: { ownerUserId: userId },
        select: {
          id: true,
          documents: {
            select: { storageRef: true, storageType: true },
          },
        },
      });
      filesToRemove = ownedPolicies.flatMap((policy) =>
        policy.documents
          .filter((doc) => doc.storageType === 'INTERNAL' && doc.storageRef)
          .map((doc) => doc.storageRef as string),
      );

      // 3. Audit entry BEFORE the deletion (the actor still exists; after
      //    user delete actorUserId is neutralized via SetNull, the entry
      //    remains as an auditable trail).
      //
      //    Deliberate deviation from the fail-soft rule of
      //    AuditService.record(): the entry is written ATOMICALLY into the
      //    same transaction that deletes the user. A failing audit insert
      //    here aborts the entire transaction - no account is deleted
      //    without a deletion proof (GDPR proof obligation). Cf. ADR-008.
      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'User',
          entityId: userId,
          action: 'PRIVACY_ACCOUNT_DELETED',
          diffJson: { selfService: true },
        },
      });

      // 4. Delete own policies (cascade to CoveredPerson,
      //    PolicyCostEntry, PolicyDocument, PortalAccountLink,
      //    AiExtractionJob, AiCoverageSummary). Must run BEFORE the user
      //    delete (FK ownerUserId -> users, Restrict).
      await tx.insurancePolicy.deleteMany({ where: { ownerUserId: userId } });

      // 5. Resolve memberships; delete the household only when neither
      //    members nor policies remain (no data loss for others).
      const memberships = await tx.householdMembership.findMany({
        where: { userId },
        select: { householdId: true },
      });
      await tx.householdMembership.deleteMany({ where: { userId } });
      for (const membership of memberships) {
        const remainingMembers = await tx.householdMembership.count({
          where: { householdId: membership.householdId },
        });
        const remainingPolicies = await tx.insurancePolicy.count({
          where: { householdId: membership.householdId },
        });
        if (remainingMembers === 0 && remainingPolicies === 0) {
          await tx.household.delete({ where: { id: membership.householdId } });
        } else {
          this.logger.warn(
            `Household ${membership.householdId} kept ` +
              `(${remainingMembers} members, ${remainingPolicies} policies remaining)`,
          );
        }
      }

      // 6. Delete the user (cascade: Credential, UserPreference;
      //    audit/settings references via SetNull).
      await tx.user.delete({ where: { id: userId } });
    });

    // 7. Remove physical files only after a successful DB commit.
    for (const filePath of filesToRemove) {
      await this.removeFileSafely(filePath);
    }
  }

  /**
   * Deletes a file only when, after resolution, it lies within the
   * storage root (path-traversal protection) and is tolerant of ENOENT.
   */
  private async removeFileSafely(filePath: string): Promise<void> {
    const root = this.storagePath + path.sep;
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(root)) {
      this.logger.warn(`File outside the storage path, not deleted: ${resolved}`);
      return;
    }
    try {
      await fs.promises.unlink(resolved);
    } catch (error) {
      const nodeErr = error as NodeJS.ErrnoException;
      if (nodeErr.code === 'ENOENT') {
        this.logger.warn(`File no longer exists: ${resolved}`);
      } else {
        this.logger.error(`File deletion failed: ${resolved} (${nodeErr.message})`);
      }
    }
  }
}
