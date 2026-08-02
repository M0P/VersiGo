import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { DatabaseService } from '@versigo/foundation';

/**
 * Verwaltet Feature-Flags auf globaler und Household-Ebene.
 * Ein deaktiviertes Flag deaktiviert nur die jeweilige Teilfunktion,
 * nicht die gesamte Anwendung (graceful degradation).
 */
@Injectable()
export class FeatureFlagsService {
  private readonly logger = new Logger(FeatureFlagsService.name);

  constructor(private readonly db: DatabaseService) {}

  // --- Global Feature Flags ---

  async listGlobalFlags() {
    return this.db.globalFeatureFlag.findMany({
      orderBy: { key: 'asc' },
    });
  }

  async getGlobalFlag(key: string) {
    const flag = await this.db.globalFeatureFlag.findUnique({ where: { key } });
    if (!flag) {
      throw new NotFoundException(`Globales Feature-Flag '${key}' nicht gefunden`);
    }
    return flag;
  }

  async createGlobalFlag(key: string, enabled: boolean | undefined) {
    const existing = await this.db.globalFeatureFlag.findUnique({ where: { key } });
    if (existing) {
      throw new ConflictException(`Globales Feature-Flag '${key}' existiert bereits`);
    }

    const flag = await this.db.globalFeatureFlag.create({
      data: { key, enabled: enabled ?? false },
    });

    this.logger.log(`Globales Feature-Flag '${key}' = ${flag.enabled} angelegt`);
    return flag;
  }

  async updateGlobalFlag(key: string, enabled: boolean) {
    const existing = await this.db.globalFeatureFlag.findUnique({ where: { key } });
    if (!existing) {
      throw new NotFoundException(`Globales Feature-Flag '${key}' nicht gefunden`);
    }

    const flag = await this.db.globalFeatureFlag.update({
      where: { key },
      data: { enabled },
    });

    this.logger.log(`Globales Feature-Flag '${key}' = ${flag.enabled} aktualisiert`);
    return flag;
  }

  async deleteGlobalFlag(key: string) {
    const existing = await this.db.globalFeatureFlag.findUnique({ where: { key } });
    if (!existing) {
      throw new NotFoundException(`Globales Feature-Flag '${key}' nicht gefunden`);
    }

    await this.db.globalFeatureFlag.delete({ where: { key } });
    this.logger.log(`Globales Feature-Flag '${key}' geloescht`);
    return { success: true };
  }

  // Prueft, ob ein globales Flag aktiv ist. Fallback auf false, wenn nicht vorhanden.
  async isGlobalEnabled(key: string): Promise<boolean> {
    const flag = await this.db.globalFeatureFlag.findUnique({ where: { key } });
    return flag?.enabled ?? false;
  }

  // --- Household Feature Flags ---

  async listHouseholdFlags(householdId: string) {
    return this.db.householdFeatureFlag.findMany({
      where: { householdId },
      orderBy: { key: 'asc' },
    });
  }

  async getHouseholdFlag(householdId: string, key: string) {
    const flag = await this.db.householdFeatureFlag.findUnique({
      where: { householdId_key: { householdId, key } },
    });
    if (!flag) {
      throw new NotFoundException(`Household-Feature-Flag '${key}' nicht gefunden`);
    }
    return flag;
  }

  async createHouseholdFlag(householdId: string, key: string, enabled: boolean | undefined) {
    const existing = await this.db.householdFeatureFlag.findUnique({
      where: { householdId_key: { householdId, key } },
    });
    if (existing) {
      throw new ConflictException(`Household-Feature-Flag '${key}' existiert bereits`);
    }

    const flag = await this.db.householdFeatureFlag.create({
      data: { householdId, key, enabled: enabled ?? false },
    });

    this.logger.log(`Household-Feature-Flag '${key}' = ${flag.enabled} fuer Household ${householdId} angelegt`);
    return flag;
  }

  async updateHouseholdFlag(householdId: string, key: string, enabled: boolean) {
    const existing = await this.db.householdFeatureFlag.findUnique({
      where: { householdId_key: { householdId, key } },
    });
    if (!existing) {
      throw new NotFoundException(`Household-Feature-Flag '${key}' nicht gefunden`);
    }

    const flag = await this.db.householdFeatureFlag.update({
      where: { householdId_key: { householdId, key } },
      data: { enabled },
    });

    this.logger.log(`Household-Feature-Flag '${key}' = ${flag.enabled} fuer Household ${householdId} aktualisiert`);
    return flag;
  }

  async deleteHouseholdFlag(householdId: string, key: string) {
    const existing = await this.db.householdFeatureFlag.findUnique({
      where: { householdId_key: { householdId, key } },
    });
    if (!existing) {
      throw new NotFoundException(`Household-Feature-Flag '${key}' nicht gefunden`);
    }

    await this.db.householdFeatureFlag.delete({
      where: { householdId_key: { householdId, key } },
    });
    this.logger.log(`Household-Feature-Flag '${key}' fuer Household ${householdId} geloescht`);
    return { success: true };
  }

  // Prueft, ob ein Household-Flag aktiv ist. Fallback auf false.
  async isHouseholdEnabled(householdId: string, key: string): Promise<boolean> {
    const flag = await this.db.householdFeatureFlag.findUnique({
      where: { householdId_key: { householdId, key } },
    });
    return flag?.enabled ?? false;
  }
}
