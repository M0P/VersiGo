import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '@versigo/foundation';
import { GlobalRole, PaymentFrequency } from '@prisma/client';
import { AuthService, AuthenticatedUser } from '../identity/auth.service';
import { CreateCostEntryDto, UpdateCostEntryDto } from './dto/cost-tracking.dto';

/**
 * BugFix-08 (Q4): Kosten-Overhaul.
 *
 * - Abrechnungsperioden: MONTHLY / QUARTERLY / ANNUAL fuer neue Eintraege.
 *   SEMI_ANNUAL bleibt als Legacy-Wert fuer Bestandsdaten im Enum erhalten
 *   und wird in allen Berechnungen korrekt unterstuetzt (6-Monats-Periode).
 *   Dokumentierte, verlustfreie Entscheidung: KEINE Datenmigration noetig.
 * - Kosten-Erhoehung ab einem Datum = neuer Eintrag mit spaeterem validFrom;
 *   der bisher gueltige Eintrag wird beim Anlegen automatisch beendet
 *   (validTo = letzter Millisekunde vor dem neuen validFrom). Zu jedem
 *   Zeitpunkt gilt genau ein Eintrag: der mit dem groessten validFrom
 *   <= Periodenbeginn (und ohne explizites Ende davor).
 * - "Bisher gezahlt" (paidToDate) = Summe der vollen Betraege aller
 *   begonnenen Abrechnungsperioden (Periodenbeginn <= heute, Faelligkeit zu
 *   Periodenbeginn). KEINE Tagesanteile – BugFix-06 (Teil 3) Semantik bleibt
 *   erhalten.
 * - Geldbetraege: Intern in Cent (Ganzzahl) summieren; alle ausgegebenen
 *   Betraege auf 2 Dezimalen gerundet. Es werden niemals Gleitkomma-Summen
 *   gebildet.
 */

/** Periodenlaenge je Zahlungsfrequenz in Monaten (Basis aller Berechnungen). */
const FREQUENCY_MONTHS: Record<PaymentFrequency, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMI_ANNUAL: 6,
  ANNUAL: 12,
};

/** Perioden pro Jahr je Frequenz (z. B. MONTHLY = 12 -> Jahresbetrag). */
const FREQUENCY_PER_YEAR: Record<PaymentFrequency, number> = {
  MONTHLY: 12,
  QUARTERLY: 4,
  SEMI_ANNUAL: 2,
  ANNUAL: 1,
};

/**
 * Kalender-Addition von Monaten mit Tageswert-Clamping. WICHTIG: Jeder Aufruf
 * geht IMMER vom uebergebenen Anker-Datum aus (nie von einem bereits
 * geclemmten Zwischenergebnis) – so realignen sich Perioden nach kurzen
 * Monaten automatisch wieder am Anker: Aus Anker 31.01. + 1 Monat wird
 * 28./29.02., + 2 Monate wieder 31.03., + 3 Monate 30.04. usw. (kein Drift).
 */
function addMonthsClamped(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDayOfMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDayOfMonth));
  return result;
}

/** Rundet auf 2 Dezimalen (Anzeige-/Einzelbetraege). */
function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** Betrag -> Ganzzahl-Cent (Basis fuer verlustfreie Summen). */
function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Ganzzahl-Cent -> Betrag mit 2 Dezimalen. */
function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/** Ein Kosten-Eintrag, wie ihn die Berechnungslogik benoetigt. */
type CostEntryLike = {
  id?: string;
  createdAt?: Date | string | null;
  grossAmount: unknown;
  netAmount?: unknown;
  frequency: PaymentFrequency;
  validFrom: Date;
  validTo: Date | null;
};

/** Billing-Daten einer Versicherung (Anker + Abrechnungsfrequenz). */
type BillingPlan = {
  anchor: Date;
  frequency: PaymentFrequency;
  stepMonths: number;
};

/** Eine Abrechnungsperiode in der Kosten-Tabelle (incurred/expected). */
type BillingPeriod = {
  periodIndex: number;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  status: 'incurred' | 'expected';
  entryId: string | null;
};

@Injectable()
export class CostTrackingService {
  private readonly logger = new Logger(CostTrackingService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly authService: AuthService,
  ) {}

  private async assertHouseholdAccess(householdId: string, userId: string): Promise<void> {
    const membership = await this.db.householdMembership.findUnique({
      where: { householdId_userId: { householdId, userId } },
    });
    if (!membership) {
      throw new ForbiddenException('Isolation: kein Zugriff auf fremdes Household');
    }
  }

  private async assertPolicyAccess(householdId: string, userId: string, policyId: string): Promise<void> {
    await this.assertHouseholdAccess(householdId, userId);

    const policy = await this.db.insurancePolicy.findFirst({
      where: { id: policyId, householdId },
    });

    if (!policy) {
      throw new NotFoundException('Versicherung nicht gefunden');
    }
  }

  /**
   * Relevanter Kosten-Eintrag fuer eine Periode: der Eintrag mit dem
   * groessten validFrom <= Periodenbeginn, sofern er nicht vor dem
   * Periodenbeginn explizit beendet wurde (validTo < Periodenbeginn).
   * Liefert null, wenn vor periodStart noch gar kein Eintrag existiert oder
   * der letzte Eintrag bereits beendet ist (Kostenrueckgang/Luecke).
   * Bei identischem validFrom entscheidet der juengere Eintrag (createdAt).
   */
  private entryForPeriod<T extends CostEntryLike>(entries: T[], periodStart: Date): T | null {
    const startMs = periodStart.getTime();
    return (
      entries
        .filter(
          (e) =>
            e.validFrom.getTime() <= startMs &&
            (!e.validTo || e.validTo.getTime() >= startMs),
        )
        .sort((a, b) => {
          const byFrom = b.validFrom.getTime() - a.validFrom.getTime();
          if (byFrom !== 0) return byFrom;
          const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return bCreated - aCreated;
        })[0] ?? null
    );
  }

  /** Aktiven (sonst letzten) Kosten-Eintrag ermitteln – gemeinsame Basis der Uebersichten. */
  private selectActiveOrLatestEntry<T extends CostEntryLike>(entries: T[], now: Date): T | null {
    if (entries.length === 0) return null;
    return (
      entries
        .filter((e) => e.validFrom.getTime() <= now.getTime() && (!e.validTo || e.validTo.getTime() >= now.getTime()))
        .sort((a, b) => {
          const byFrom = b.validFrom.getTime() - a.validFrom.getTime();
          if (byFrom !== 0) return byFrom;
          const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return bCreated - aCreated;
        })[0] ?? entries[entries.length - 1]
    );
  }

  /**
   * Ermittelt Anker (Versicherungsbeginn, Fallback: fruehester Eintrag) und
   * Abrechnungsfrequenz (paymentFrequency der Versicherung, Fallback:
   * Frequenz des aktiven/letzten Eintrags, sonst MONTHLY).
   */
  private resolveBilling<T extends CostEntryLike>(
    policy: { startDate?: Date | null; paymentFrequency?: PaymentFrequency | null },
    entries: T[],
    now: Date,
  ): BillingPlan {
    const active = this.selectActiveOrLatestEntry(entries, now);
    const anchor = policy.startDate ?? entries[0].validFrom;
    const frequency = policy.paymentFrequency ?? active?.frequency ?? PaymentFrequency.MONTHLY;
    return { anchor, frequency, stepMonths: FREQUENCY_MONTHS[frequency] };
  }

  /**
   * Faelliger Betrag eines Kosten-Eintrags in einer Abrechnungsperiode der
   * Schritt-Frequenz `stepFrequency`. Weicht die eigene Frequenz des
   * Eintrags von der Schritt-Frequenz ab (z. B. Versicherung MONTHLY,
   * Eintrag QUARTERLY), wird der Betrag proportional auf die Periode
   * umgerechnet, damit die Jahres-Summe konsistent bleibt
   * (300 QUARTERLY = 100/Monat).
   */
  private periodAmount(entry: CostEntryLike, stepFrequency: PaymentFrequency): number {
    const stepMonths = FREQUENCY_MONTHS[stepFrequency];
    const entryMonths = FREQUENCY_MONTHS[entry.frequency];
    if (stepMonths === entryMonths) {
      return roundMoney(Number(entry.grossAmount));
    }
    return roundMoney(Number(entry.grossAmount) * (stepMonths / entryMonths));
  }

  /**
   * Erzeugt alle Abrechnungsperioden vom Anker bis `horizonEnd` (inklusiv).
   * Past-Perioden (Periodenbeginn <= now) sind 'incurred' (Beitrag faellig zu
   * Periodenbeginn), Zukunft 'expected' (projiziert aus dem aktuell gueltigen
   * Eintrag). Je Periode zaehlt der relevante Kosten-Eintrag (aktiv zu
   * Periodenbeginn, sonst letzter davor – siehe entryForPeriod).
   */
  private iteratePeriods<T extends CostEntryLike>(
    policy: { startDate?: Date | null; paymentFrequency?: PaymentFrequency | null },
    entries: T[],
    now: Date,
    horizonEnd: Date,
  ): BillingPeriod[] {
    if (entries.length === 0) return [];
    const { anchor, frequency, stepMonths } = this.resolveBilling(policy, entries, now);
    const horizonMs = horizonEnd.getTime();

    const periods: BillingPeriod[] = [];
    let index = 0;
    for (;;) {
      const periodStart = addMonthsClamped(anchor, index * stepMonths);
      if (periodStart.getTime() > horizonMs) break;
      const periodEndExclusive = addMonthsClamped(anchor, (index + 1) * stepMonths);
      // Inklusives Periodenende = letzter Moment vor der naechsten Periode.
      const periodEnd = new Date(periodEndExclusive.getTime() - 1);

      const entry = this.entryForPeriod(entries, periodStart);
      const amount = entry ? this.periodAmount(entry, frequency) : 0;

      periods.push({
        periodIndex: index,
        periodLabel: `${String(periodStart.getMonth() + 1).padStart(2, '0')}/${periodStart.getFullYear()}`,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        amount: roundMoney(amount),
        status: periodStart.getTime() <= now.getTime() ? 'incurred' : 'expected',
        entryId: entry?.id ?? null,
      });
      index++;
    }
    return periods;
  }

  /**
   * "Bisher gezahlt": Summe der vollen Periodenbetraege aller begonnenen
   * Abrechnungsperioden (Periodenbeginn <= now). Jede begonnene Periode
   * zaehlt komplett – es gibt KEINE Tagesanteile (BugFix-06 Teil 3).
   * Summation in Cent (Ganzzahl), Ergebnis auf 2 Dezimalen.
   */
  private calculatePaidToDate<T extends CostEntryLike>(
    policy: { startDate?: Date | null; paymentFrequency?: PaymentFrequency | null },
    entries: T[],
    now: Date,
  ): number {
    if (entries.length === 0) return 0;
    const { anchor, frequency, stepMonths } = this.resolveBilling(policy, entries, now);

    let totalCents = 0;
    let index = 0;
    for (;;) {
      const periodStart = addMonthsClamped(anchor, index * stepMonths);
      if (periodStart.getTime() > now.getTime()) break;
      const entry = this.entryForPeriod(entries, periodStart);
      if (entry) totalCents += toCents(this.periodAmount(entry, frequency));
      index++;
    }
    return fromCents(totalCents);
  }

  /** Jahresbetrag eines Eintrags (Periodenbetrag * Perioden/Jahr). */
  private annualize(entry: CostEntryLike): number {
    return roundMoney(Number(entry.grossAmount) * FREQUENCY_PER_YEAR[entry.frequency]);
  }

  /** Monats-/Quartals-/Jahresbetrag abgeleitet aus dem Jahresbetrag. */
  private derivePerFrequency(annualGross: number) {
    return {
      MONTHLY: roundMoney(annualGross / 12),
      QUARTERLY: roundMoney(annualGross / 4),
      ANNUAL: roundMoney(annualGross),
    };
  }

  /**
   * Beendet den zum Zeitpunkt `validFrom` gueltigen VORGAENGER-Eintrag
   * automatisch (validTo = letzte Millisekunde vor `validFrom`). Liefert
   * true, wenn ein Eintrag beendet wurde. `excludeEntryId` wird bei Updates
   * auf den bearbeiteten Eintrag selbst gesetzt.
   */
  private async endPredecessor(
    tx: {
      policyCostEntry: {
        findMany: (args: unknown) => Promise<CostEntryLike[]>;
        update: (args: unknown) => Promise<unknown>;
      };
    },
    policyId: string,
    validFrom: Date,
    excludeEntryId?: string,
  ): Promise<boolean> {
    const existing = (await tx.policyCostEntry.findMany({
      where: { policyId },
      orderBy: { validFrom: 'asc' },
    })) ?? [];
    const predecessor = this.entryForPeriod(
      existing.filter((e) => e.id !== excludeEntryId),
      validFrom,
    );
    if (!predecessor) return false;

    const end = new Date(validFrom.getTime() - 1);
    if (predecessor.validTo && predecessor.validTo.getTime() <= end.getTime()) return false;

    await tx.policyCostEntry.update({
      where: { id: predecessor.id },
      data: { validTo: end },
    });
    return true;
  }

  /** Stellt sicher, dass kein ANDERER Eintrag dasselbe validFrom besitzt. */
  private async assertNoValidFromCollision(
    db: { policyCostEntry: { findFirst: (args: unknown) => Promise<{ id: string } | null> } },
    policyId: string,
    validFrom: Date,
    excludeEntryId?: string,
  ): Promise<void> {
    const collision = await db.policyCostEntry.findFirst({
      where: {
        policyId,
        validFrom,
        ...(excludeEntryId ? { id: { not: excludeEntryId } } : {}),
      },
      select: { id: true },
    });
    if (collision) {
      throw new BadRequestException('Zu diesem Zeitpunkt existiert bereits ein anderer Kosten-Eintrag');
    }
  }

  /**
   * Oeffnet den Vorgaenger-Eintrag wieder, der beim Anlegen des Eintrags mit
   * `validFrom` automatisch beendet wurde (validTo == validFrom - 1ms).
   *
   * Nötig, wenn ein Erhoehungs-Eintrag nach hinten verschoben oder geloescht
   * wird: Sonst entstaende zwischen dem alten und dem neuen validFrom ein
   * Zeitraum OHNE gueltigen Eintrag ("zu jedem Zeitpunkt gilt genau ein
   * Eintrag" – BugFix-08, Review 2). Die anschliessende endPredecessor-Sync
   * beendet den Vorgaenger bei Bedarf am NEUEN validFrom korrekt neu.
   */
  private async restorePredecessor(
    tx: {
      policyCostEntry: {
        findFirst: (args: unknown) => Promise<{ id: string } | null>;
        update: (args: unknown) => Promise<unknown>;
      };
    },
    policyId: string,
    validFrom: Date,
  ): Promise<boolean> {
    const oldEnd = new Date(validFrom.getTime() - 1);
    const predecessor = await tx.policyCostEntry.findFirst({
      where: { policyId, validTo: oldEnd },
      select: { id: true },
    });
    if (!predecessor) return false;

    await tx.policyCostEntry.update({
      where: { id: predecessor.id },
      data: { validTo: null },
    });
    return true;
  }

  async create(householdId: string, userId: string, policyId: string, dto: CreateCostEntryDto) {
    await this.assertPolicyAccess(householdId, userId, policyId);

    const validFrom = new Date(dto.validFrom);
    const validTo = dto.validTo ? new Date(dto.validTo) : null;
    if (validTo && validTo.getTime() <= validFrom.getTime()) {
      throw new BadRequestException('validTo muss nach validFrom liegen');
    }

    return this.db.$transaction(async (tx) => {
      await this.assertNoValidFromCollision(tx, policyId, validFrom);

      const entry = await tx.policyCostEntry.create({
        data: {
          policyId,
          validFrom,
          validTo,
          grossAmount: dto.grossAmount,
          netAmount: dto.netAmount,
          frequency: dto.frequency,
          bookingSource: dto.bookingSource,
          note: dto.note,
        },
      });

      // BugFix-08: Kosten-Erhoehung ab validFrom – der bisher gueltige
      // Eintrag wird automatisch beendet (validTo = letzte Millisekunde vor
      // dem neuen validFrom). Zu jedem Zeitpunkt gilt genau ein Eintrag.
      // WICHTIG: entry.id wird ausgeschlossen, da in der interaktiven
      // Transaktion findMany sonst auch den eben erzeugten Eintrag sieht und
      // dieser faelschlich als sein eigener Vorgaenger beendet wuerde.
      const predecessorEnded = await this.endPredecessor(tx, policyId, validFrom, entry.id);

      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'PolicyCostEntry',
          entityId: entry.id,
          action: 'CREATE',
          diffJson: {
            policyId,
            validFrom: dto.validFrom,
            validTo: dto.validTo ?? null,
            grossAmount: dto.grossAmount,
            netAmount: dto.netAmount ?? null,
            frequency: dto.frequency,
            bookingSource: dto.bookingSource ?? null,
            note: dto.note ?? null,
            predecessorEnded,
          },
        },
      });

      return entry;
    }).catch((err) => {
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err;
      this.logger.error(`create cost entry failed: ${err.message}`, err.stack);
      throw err;
    });
  }

  async findAll(householdId: string, user: AuthenticatedUser, policyId: string) {
    // Wirft 403/404 je nach Rolle und Freigabe (READ_ONLY nur bei Share)
    await this.authService.assertPolicyReadAccess(user, householdId, policyId);

    return this.db.policyCostEntry.findMany({
      where: { policyId },
      orderBy: { validFrom: 'desc' },
    });
  }

  async findOne(householdId: string, user: AuthenticatedUser, policyId: string, entryId: string) {
    // Wirft 403/404 je nach Rolle und Freigabe (READ_ONLY nur bei Share)
    await this.authService.assertPolicyReadAccess(user, householdId, policyId);

    const entry = await this.db.policyCostEntry.findFirst({
      where: { id: entryId, policyId },
    });

    if (!entry) {
      throw new NotFoundException('Kostenposition nicht gefunden');
    }

    return entry;
  }

  async update(householdId: string, userId: string, policyId: string, entryId: string, dto: UpdateCostEntryDto) {
    await this.assertPolicyAccess(householdId, userId, policyId);

    return this.db.$transaction(async (tx) => {
      const existing = await tx.policyCostEntry.findFirst({
        where: { id: entryId, policyId },
      });

      if (!existing) {
        throw new NotFoundException('Kostenposition nicht gefunden');
      }

      const finalValidFrom = dto.validFrom ? new Date(dto.validFrom) : existing.validFrom;
      let finalValidTo = dto.validTo !== undefined
        ? (dto.validTo ? new Date(dto.validTo) : null)
        : existing.validTo;

      if (finalValidTo && finalValidTo.getTime() <= finalValidFrom.getTime()) {
        if (dto.validTo !== undefined) {
          // Explizit uebermittelte widerspruechliche Werte weiterhin ablehnen.
          throw new BadRequestException('validTo muss nach validFrom liegen');
        }
        // BugFix-08 (Review 3+4): validFrom wird hinter ein NICHT explizit
        // gesetztes validTo verschoben. Ein solches validTo stammt entweder
        // vom automatischen Beenden durch eine spaetere Erhoehung (Signatur:
        // ein Nachfolger beginnt exakt eine Millisekunde spaeter) oder von
        // einer manuellen Eingabe. Nur im Auto-End-Fall wird es entfernt,
        // damit die verschobene Erhoehung ab dem neuen Datum gilt; manuell
        // gesetzte Enddaten werden nicht stillschweigend verworfen.
        const successor = await tx.policyCostEntry.findFirst({
          where: { policyId, validFrom: new Date(finalValidTo.getTime() + 1) },
          select: { id: true },
        });
        if (!successor) {
          throw new BadRequestException('validTo muss nach validFrom liegen');
        }
        finalValidTo = null;
      }

      if (finalValidFrom.getTime() !== existing.validFrom.getTime()) {
        await this.assertNoValidFromCollision(tx, policyId, finalValidFrom, entryId);
      }

      const entry = await tx.policyCostEntry.update({
        where: { id: entryId },
        data: {
          validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
          validTo: dto.validTo !== undefined
            ? (dto.validTo ? new Date(dto.validTo) : null)
            : (finalValidTo === null && existing.validTo !== null ? null : undefined),
          grossAmount: dto.grossAmount,
          netAmount: dto.netAmount,
          frequency: dto.frequency,
          bookingSource: dto.bookingSource,
          note: dto.note,
        },
      });

      // BugFix-08: Nach einer validFrom-Aenderung den Vorgaenger neu
      // synchronisieren (automatisches Beenden wie beim Anlegen).
      if (finalValidFrom.getTime() !== existing.validFrom.getTime()) {
        // Review 2: Wird validFrom NACH hinten verschoben, zunaechst den am
        // ALTEN validFrom automatisch beendeten Vorgaenger wieder oeffnen –
        // sonst entsteht eine Luecke ohne gueltigen Eintrag. endPredecessor
        // beendet ihn anschliessend am NEUEN validFrom korrekt neu.
        //
        // Review 4 (bekannte Grenze): Wird der ERSTE Eintrag nach hinten
        // verschoben, existiert kein wieder zu oeffnender Vorgaenger; die
        // Perioden vor dem naechsten Eintrag bleiben dann ohne zugeordneten
        // Betrag. Das ist beabsichtigt (Kostenrueckgang/Luecke ist im Modell
        // erlaubt – vgl. entryForPeriod) und wird hier nicht durch Erfinden
        // oder Verschieben fremder Eintraege "repariert".
        if (finalValidFrom.getTime() > existing.validFrom.getTime()) {
          await this.restorePredecessor(tx, policyId, existing.validFrom);
        }
        await this.endPredecessor(tx, policyId, finalValidFrom, entryId);
      }

      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'PolicyCostEntry',
          entityId: entryId,
          action: 'UPDATE',
          diffJson: { ...dto },
        },
      });

      return entry;
    }).catch((err) => {
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err;
      this.logger.error(`update cost entry ${entryId} failed: ${err.message}`, err.stack);
      throw err;
    });
  }

  async remove(householdId: string, userId: string, policyId: string, entryId: string) {
    await this.assertPolicyAccess(householdId, userId, policyId);

    return this.db.$transaction(async (tx) => {
      const existing = await tx.policyCostEntry.findFirst({
        where: { id: entryId, policyId },
      });

      if (!existing) {
        throw new NotFoundException('Kostenposition nicht gefunden');
      }

      await tx.policyCostEntry.delete({ where: { id: entryId } });

      // BugFix-08 (Review 2): Wird eine Erhoehung (validFrom) geloescht,
      // den damals automatisch beendeten Vorgaenger wieder oeffnen – sonst
      // entsteht ab dem alten validFrom ein Zeitraum ohne gueltigen Eintrag.
      await this.restorePredecessor(tx, policyId, existing.validFrom);

      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'PolicyCostEntry',
          entityId: entryId,
          action: 'DELETE',
          diffJson: {
            policyId,
            entryId,
            grossAmount: Number(existing.grossAmount),
            frequency: existing.frequency,
          },
        },
      });

      return { success: true };
    }).catch((err) => {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(`remove cost entry ${entryId} failed: ${err.message}`, err.stack);
      throw err;
    });
  }

  /**
   * BugFix-08: Vollstaendige Kosten-Tabelle einer Versicherung.
   * - `periods`: eine Zeile je Abrechnungsperiode vom Versicherungsbeginn bis
   *   zum Ende des Folgejahres (Vergangenheit 'incurred', Zukunft 'expected',
   *   projiziert aus dem aktuell gueltigen Eintrag).
   * - `paidToDate`: Summe der vollen Betraege aller begonnenen Perioden.
   * - `current`: Jahres-/Monats-/Quartalsbetrag aus dem aktiven Eintrag.
   */
  async getSchedule(
    householdId: string,
    user: AuthenticatedUser,
    policyId: string,
    // Testbarkeits-Hook: "heute" ist standardmaessig die aktuelle Zeit.
    now: Date = new Date(),
  ) {
    // Wirft 403/404 je nach Rolle und Freigabe (READ_ONLY nur bei Share)
    await this.authService.assertPolicyReadAccess(user, householdId, policyId);

    const [policy, entries] = await Promise.all([
      this.db.insurancePolicy.findFirst({
        where: { id: policyId, householdId },
        select: { id: true, startDate: true, paymentFrequency: true },
      }),
      this.db.policyCostEntry.findMany({
        where: { policyId },
        orderBy: { validFrom: 'asc' },
      }),
    ]);

    if (!policy) {
      throw new NotFoundException('Versicherung nicht gefunden');
    }

    if (entries.length === 0) {
      return {
        policyId,
        asOf: now.toISOString(),
        paidToDate: 0,
        current: null,
        periods: [],
      };
    }

    // Horizont: Ende des auf das aktuelle Jahr folgenden Kalenderjahres.
    const horizonEnd = new Date(now.getFullYear() + 1, 11, 31, 23, 59, 59, 999);
    const periods = this.iteratePeriods(policy, entries, now, horizonEnd);
    const paidToDate = this.calculatePaidToDate(policy, entries, now);

    // Nicht-null, da oben fuer entries.length === 0 bereits zurueckgekehrt wurde.
    const active = this.selectActiveOrLatestEntry(entries, now)!;
    const annualGross = this.annualize(active);
    const annualNet = active?.netAmount != null
      ? roundMoney(Number(active.netAmount) * FREQUENCY_PER_YEAR[active.frequency])
      : null;

    return {
      policyId,
      asOf: now.toISOString(),
      paidToDate,
      current: {
        annualGross,
        annualNet,
        perFrequency: this.derivePerFrequency(annualGross),
        entryId: active.id,
        frequency: active.frequency,
        grossAmount: roundMoney(Number(active.grossAmount)),
        validFrom: active.validFrom,
        validTo: active.validTo,
      },
      periods,
    };
  }

  /**
   * BugFix-08 (Q5): Haushalts-Kostenuebersicht.
   * - Tiefste Ebene: je Versicherung der bezahlte Betrag (paidToDate) sowie
   *   die projizierten Monats-/Jahresbetraege (aktiver Eintrag).
   * - Gesamtbetraege: paidToDate, Monat, Jahr ueber alle Versicherungen.
   * - `perYear`: historische Kosten je Kalenderjahr (Summe der vollen
   *   Periodenbetraege aller begonnenen Perioden je Jahr – keine
   *   Tagesanteile) – Datenbasis fuer den historischen Graphen.
   */
  async getHouseholdSummary(
    householdId: string,
    user: AuthenticatedUser,
    // Testbarkeits-Hook: "heute" ist standardmaessig die aktuelle Zeit.
    now: Date = new Date(),
  ) {
    await this.assertHouseholdAccess(householdId, user.id);

    // READ_ONLY: Summe nur ueber explizit freigegebene Policies (ADR-007/AP-16)
    const readableIds = await this.authService.getReadablePolicyIds(user, householdId);
    const where =
      user.role === GlobalRole.READ_ONLY && readableIds
        ? { householdId, archivedAt: null, id: { in: readableIds } }
        : { householdId, archivedAt: null };

    const policies = await this.db.insurancePolicy.findMany({
      where,
      include: {
        costEntries: {
          orderBy: { validFrom: 'asc' },
        },
      },
    });

    const policyRows: Array<{
      id: string;
      name: string;
      type: string;
      frequency: PaymentFrequency | null;
      paidToDate: number;
      perMonth: number;
      perYear: number;
      entryCount: number;
    }> = [];

    let totalPaidCents = 0;
    let totalPerMonthCents = 0;
    let totalPerYearCents = 0;
    const perYearMap = new Map<number, number>();

    for (const policy of policies) {
      const entries = policy.costEntries;

      if (entries.length === 0) {
        policyRows.push({
          id: policy.id,
          name: policy.insurerName,
          type: policy.type,
          frequency: null,
          paidToDate: 0,
          perMonth: 0,
          perYear: 0,
          entryCount: 0,
        });
        continue;
      }

      const paidToDate = this.calculatePaidToDate(policy, entries, now);
      // Nicht-null, da oben fuer entries.length === 0 bereits fortgefahren wurde.
      const active = this.selectActiveOrLatestEntry(entries, now)!;
      const annual = this.annualize(active);

      totalPaidCents += toCents(paidToDate);
      totalPerYearCents += toCents(annual);
      totalPerMonthCents += toCents(roundMoney(annual / 12));

      // Historische Kalenderjahr-Buckets: jede begonnene Periode traegt
      // ihren vollen Betrag zum Jahr ihres Periodenbeginns bei.
      const { anchor, frequency, stepMonths } = this.resolveBilling(policy, entries, now);
      let index = 0;
      for (;;) {
        const periodStart = addMonthsClamped(anchor, index * stepMonths);
        if (periodStart.getTime() > now.getTime()) break;
        const entry = this.entryForPeriod(entries, periodStart);
        if (entry) {
          const year = periodStart.getFullYear();
          const amountCents = toCents(this.periodAmount(entry, frequency));
          perYearMap.set(year, (perYearMap.get(year) ?? 0) + amountCents);
        }
        index++;
      }

      policyRows.push({
        id: policy.id,
        name: policy.insurerName,
        type: policy.type,
        frequency: active.frequency,
        paidToDate: roundMoney(paidToDate),
        perMonth: roundMoney(annual / 12),
        perYear: roundMoney(annual),
        entryCount: entries.length,
      });
    }

    const perYear = Array.from(perYearMap.entries())
      .map(([year, cents]) => ({ year, amount: fromCents(cents) }))
      .sort((a, b) => a.year - b.year);

    return {
      asOf: now.toISOString(),
      totals: {
        paidToDate: fromCents(totalPaidCents),
        perMonth: fromCents(totalPerMonthCents),
        perYear: fromCents(totalPerYearCents),
      },
      perYear,
      policyCount: policies.length,
      policies: policyRows,
    };
  }
}
