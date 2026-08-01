import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AppConfigService, DatabaseService } from '@insura/foundation';
import { GlobalRole, UserStatus } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import type { AuthenticatedUser } from '../identity/auth.service';

/**
 * GDPR-Export (ohne Binärdateien / Roh-AI-Payloads):
 * - Konto (ohne Passwort-Hash, ohne verschluesselte Werte)
 * - Praeferenzen, Household-Mitgliedschaften
 * - Eigene Policen inkl. versicherter Personen, Kosten, Dokument-Metadaten,
 *   Portal-Links (ohne Zugangsdaten/URLs? -> providerKey reicht), AI-Jobs
 * - Eigene Audit-Events (Metadaten)
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
 * Privacy/GDPR-Slice (AP-19).
 *
 * Berechtigungsgrenzen:
 * - `exportPersonalData` und `deleteAccount` verwenden ausschliesslich die
 *   Session-Identitaet (user.id), niemals Pfad-/Query-Parameter -> kein IDOR.
 * - Rollen-Gate im Controller: @Roles(GlobalRole.USER) -> USER und ADMIN
 *   (hierarchisch), READ_ONLY erhaelt 403 (konsistent zu Profil/Praeferenzen,
 *   ADR-007).
 * - Letzter-Admin-Schutz: Der letzte aktive ADMIN kann sein Konto nicht
 *   selbst loeschen (sonst Lockout des gesamten Systems).
 *
 * Loeschsemantik: In einer Transaktion werden zunaechst alle eigenen Policen
 * (Kaskade auf versicherte Personen/Kosten/Dokumente/Portal-Links/AI-Jobs)
 * geloescht, dann die Household-Mitgliedschaften. Ein Household wird nur
 * geloescht, wenn keine Mitglieder UND keine Policen mehr existieren
 * (Invariante: alle Policen eines Households gehoeren dessen Mitgliedern;
 * die Guard verhindert Datenverlust anderer Nutzer). Abschliessend wird der
 * User geloescht (Kaskade auf Credentials/Praeferenzen; Audit-Referenzen
 * werden per SetNull neutralisiert -> Audit-Trail bleibt erhalten).
 * Physische Dateien der Dokumente werden NACH erfolgreichem DB-Commit aus
 * dem Storage entfernt (safe-path-guarded, ENOENT-tolerant).
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
      throw new NotFoundException('Benutzer nicht gefunden');
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
            'Der letzte aktive Administrator kann sein Konto nicht loeschen',
          );
        }
      }

      // 2. Lokale Dateipfade der eigenen INTERNAL-Dokumente sammeln (fuer
      //    die physische Bereinigung NACH dem DB-Commit).
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

      // 3. Audit-Eintrag VOR der Loeschung (Actor existiert noch; nach dem
      //    User-Delete wird actorUserId per SetNull neutralisiert, der
      //    Eintrag bleibt als revisionssicherer Trail erhalten).
      //
      //    Bewusste Abweichung von der fail-soft-Regel des AuditService.record():
      //    Der Eintrag wird ATOMAR in dieselbe Transaktion geschrieben, die den
      //    User loescht. Ein hier fehlschlagendes Audit-Insert bricht die
      //    gesamte Transaktion ab – kein Konto wird ohne unumstoesslichen
      //    Loesch-Nachweis entfernt (GDPR-Nachweispflicht). Vgl. ADR-008.
      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'User',
          entityId: userId,
          action: 'PRIVACY_ACCOUNT_DELETED',
          diffJson: { selfService: true },
        },
      });

      // 4. Eigene Policen loeschen (Kaskade auf CoveredPerson,
      //    PolicyCostEntry, PolicyDocument, PortalAccountLink,
      //    AiExtractionJob, AiCoverageSummary). Muss VOR dem User-Delete
      //    laufen (FK ownerUserId -> users, Restrict).
      await tx.insurancePolicy.deleteMany({ where: { ownerUserId: userId } });

      // 5. Mitgliedschaften aufloesen; Household nur loeschen, wenn weder
      //    Mitglieder noch Policen verbleiben (kein Datenverlust anderer).
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
            `Household ${membership.householdId} bleibt erhalten ` +
              `(noch ${remainingMembers} Mitglieder, ${remainingPolicies} Policen)`,
          );
        }
      }

      // 6. User loeschen (Kaskade: Credential, UserPreference; Audit-/
      //    Settings-Referenzen via SetNull).
      await tx.user.delete({ where: { id: userId } });
    });

    // 7. Physische Dateien erst nach erfolgreichem DB-Commit entfernen.
    for (const filePath of filesToRemove) {
      await this.removeFileSafely(filePath);
    }
  }

  /**
   * Loescht eine Datei nur, wenn sie nach Aufloesung innerhalb des
   * Storage-Roots liegt (Path-Traversal-Schutz) und tolerant bei ENOENT.
   */
  private async removeFileSafely(filePath: string): Promise<void> {
    const root = this.storagePath + path.sep;
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(root)) {
      this.logger.warn(`Datei ausserhalb des Storage-Pfads, nicht geloescht: ${resolved}`);
      return;
    }
    try {
      await fs.promises.unlink(resolved);
    } catch (error) {
      const nodeErr = error as NodeJS.ErrnoException;
      if (nodeErr.code === 'ENOENT') {
        this.logger.warn(`Datei existiert bereits nicht mehr: ${resolved}`);
      } else {
        this.logger.error(`Datei-Loeschung fehlgeschlagen: ${resolved} (${nodeErr.message})`);
      }
    }
  }
}
