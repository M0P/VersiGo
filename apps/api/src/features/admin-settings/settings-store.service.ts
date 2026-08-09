import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { DatabaseService } from '@versigo/foundation';
import { ENCRYPTION_PORT, type EncryptionPort } from '@versigo/foundation';
import { Inject } from '@nestjs/common';

/**
 * Manages encrypted and plaintext settings on global and household
 * level. Secrets are automatically encrypted/decrypted via the
 * EncryptionPort. API keys are never returned in plaintext
 * or logged.
 */
@Injectable()
export class SettingsStoreService {
  private readonly logger = new Logger(SettingsStoreService.name);

  constructor(
    private readonly db: DatabaseService,
    @Inject(ENCRYPTION_PORT) private readonly encryption: EncryptionPort,
  ) {}

  // --- Global Settings ---

  async listGlobalSettings() {
    const settings = await this.db.globalIntegrationSetting.findMany({
      orderBy: { key: 'asc' },
    });
    // Mask secrets: never expose plaintext value of secret settings
    return settings.map((s) => ({
      id: s.id,
      key: s.key,
      isSecret: s.isSecret,
      // Always deliver masked; the value is only transmitted on set/update
      valuePlain: s.isSecret ? '********' : s.valuePlain ?? '',
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  }

  async getGlobalSetting(key: string) {
    const setting = await this.db.globalIntegrationSetting.findUnique({
      where: { key },
    });
    if (!setting) {
      throw new NotFoundException(`Global setting '${key}' not found`);
    }
    return {
      id: setting.id,
      key: setting.key,
      isSecret: setting.isSecret,
      valuePlain: setting.isSecret ? '********' : setting.valuePlain ?? '',
      createdAt: setting.createdAt,
      updatedAt: setting.updatedAt,
    };
  }

  async createGlobalSetting(
    key: string,
    valuePlain: string | undefined,
    isSecret: boolean | undefined,
    actorUserId?: string,
  ) {
    const secret = isSecret ?? false;

    // Check for duplicate key
    const existing = await this.db.globalIntegrationSetting.findUnique({ where: { key } });
    if (existing) {
      throw new ConflictException(`Global setting '${key}' already exists`);
    }

    let valueEncrypted: string | undefined;
    let valuePlainStored: string | undefined;

    if (valuePlain !== undefined) {
      if (secret) {
        valueEncrypted = await this.encryption.encrypt(valuePlain);
      } else {
        valuePlainStored = valuePlain;
      }
    }

    const setting = await this.db.globalIntegrationSetting.create({
      data: {
        key,
        valueEncrypted,
        valuePlain: valuePlainStored,
        isSecret: secret,
        updatedByUserId: actorUserId,
      },
    });

    this.logger.log(`Globales Setting '${key}' angelegt (secret: ${secret}, hasValue: ${valuePlain !== undefined})`);

    return {
      id: setting.id,
      key: setting.key,
      isSecret: setting.isSecret,
      valuePlain: setting.isSecret ? '********' : setting.valuePlain ?? '',
      createdAt: setting.createdAt,
      updatedAt: setting.updatedAt,
    };
  }

  async updateGlobalSetting(
    key: string,
    valuePlain: string | undefined,
    isSecret: boolean | undefined,
    actorUserId?: string,
  ) {
    const existing = await this.db.globalIntegrationSetting.findUnique({ where: { key } });
    if (!existing) {
      throw new NotFoundException(`Global setting '${key}' not found`);
    }

    const secret = isSecret ?? existing.isSecret;
    let valueEncrypted: string | undefined;
    let valuePlainStored: string | undefined;

    if (valuePlain !== undefined) {
      if (secret) {
        valueEncrypted = await this.encryption.encrypt(valuePlain);
        valuePlainStored = undefined;
      } else {
        valuePlainStored = valuePlain;
        valueEncrypted = undefined;
      }
    } else {
      // Value not provided -> keep the existing value
      valueEncrypted = existing.valueEncrypted ?? undefined;
      valuePlainStored = existing.valuePlain ?? undefined;
    }

    const setting = await this.db.globalIntegrationSetting.update({
      where: { key },
      data: {
        valueEncrypted,
        valuePlain: valuePlainStored,
        isSecret: secret,
        updatedByUserId: actorUserId ?? existing.updatedByUserId,
      },
    });

    this.logger.log(`Globales Setting '${key}' aktualisiert`);

    return {
      id: setting.id,
      key: setting.key,
      isSecret: setting.isSecret,
      valuePlain: setting.isSecret ? '********' : setting.valuePlain ?? '',
      createdAt: setting.createdAt,
      updatedAt: setting.updatedAt,
    };
  }

  async deleteGlobalSetting(key: string) {
    const existing = await this.db.globalIntegrationSetting.findUnique({ where: { key } });
    if (!existing) {
      throw new NotFoundException(`Global setting '${key}' not found`);
    }

    await this.db.globalIntegrationSetting.delete({ where: { key } });
    this.logger.log(`Global setting '${key}' deleted`);
    return { success: true };
  }

  // --- Household Settings ---

  async listHouseholdSettings(householdId: string) {
    const settings = await this.db.householdIntegrationSetting.findMany({
      where: { householdId },
      orderBy: { key: 'asc' },
    });
    return settings.map((s) => ({
      id: s.id,
      householdId: s.householdId,
      key: s.key,
      isSecret: s.isSecret,
      valuePlain: s.isSecret ? '********' : s.valuePlain ?? '',
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  }

  async getHouseholdSetting(householdId: string, key: string) {
    const setting = await this.db.householdIntegrationSetting.findUnique({
      where: { householdId_key: { householdId, key } },
    });
    if (!setting) {
      throw new NotFoundException(`Household setting '${key}' not found`);
    }
    return {
      id: setting.id,
      householdId: setting.householdId,
      key: setting.key,
      isSecret: setting.isSecret,
      valuePlain: setting.isSecret ? '********' : setting.valuePlain ?? '',
      createdAt: setting.createdAt,
      updatedAt: setting.updatedAt,
    };
  }

  async createHouseholdSetting(
    householdId: string,
    key: string,
    valuePlain: string | undefined,
    isSecret: boolean | undefined,
  ) {
    const secret = isSecret ?? false;

    const existing = await this.db.householdIntegrationSetting.findUnique({
      where: { householdId_key: { householdId, key } },
    });
    if (existing) {
      throw new ConflictException(`Household setting '${key}' already exists`);
    }

    let valueEncrypted: string | undefined;
    let valuePlainStored: string | undefined;

    if (valuePlain !== undefined) {
      if (secret) {
        valueEncrypted = await this.encryption.encrypt(valuePlain);
      } else {
        valuePlainStored = valuePlain;
      }
    }

    const setting = await this.db.householdIntegrationSetting.create({
      data: { householdId, key, valueEncrypted, valuePlain: valuePlainStored, isSecret: secret },
    });

    this.logger.log(`Household setting '${key}' created for household ${householdId} (hasValue: ${valuePlain !== undefined})`);

    return {
      id: setting.id,
      householdId: setting.householdId,
      key: setting.key,
      isSecret: setting.isSecret,
      valuePlain: setting.isSecret ? '********' : setting.valuePlain ?? '',
      createdAt: setting.createdAt,
      updatedAt: setting.updatedAt,
    };
  }

  async updateHouseholdSetting(
    householdId: string,
    key: string,
    valuePlain: string | undefined,
    isSecret: boolean | undefined,
  ) {
    const existing = await this.db.householdIntegrationSetting.findUnique({
      where: { householdId_key: { householdId, key } },
    });
    if (!existing) {
      throw new NotFoundException(`Household setting '${key}' not found`);
    }

    const secret = isSecret ?? existing.isSecret;
    let valueEncrypted: string | undefined;
    let valuePlainStored: string | undefined;

    if (valuePlain !== undefined) {
      if (secret) {
        valueEncrypted = await this.encryption.encrypt(valuePlain);
        valuePlainStored = undefined;
      } else {
        valuePlainStored = valuePlain;
        valueEncrypted = undefined;
      }
    } else {
      valueEncrypted = existing.valueEncrypted ?? undefined;
      valuePlainStored = existing.valuePlain ?? undefined;
    }

    const setting = await this.db.householdIntegrationSetting.update({
      where: { householdId_key: { householdId, key } },
      data: { valueEncrypted, valuePlain: valuePlainStored, isSecret: secret },
    });

    this.logger.log(`Household setting '${key}' updated for household ${householdId}`);

    return {
      id: setting.id,
      householdId: setting.householdId,
      key: setting.key,
      isSecret: setting.isSecret,
      valuePlain: setting.isSecret ? '********' : setting.valuePlain ?? '',
      createdAt: setting.createdAt,
      updatedAt: setting.updatedAt,
    };
  }

  async deleteHouseholdSetting(householdId: string, key: string) {
    const existing = await this.db.householdIntegrationSetting.findUnique({
      where: { householdId_key: { householdId, key } },
    });
    if (!existing) {
      throw new NotFoundException(`Household setting '${key}' not found`);
    }

    await this.db.householdIntegrationSetting.delete({
      where: { householdId_key: { householdId, key } },
    });
    this.logger.log(`Household setting '${key}' deleted for household ${householdId}`);
    return { success: true };
  }

  // --- Internal: read decrypted value for backend purposes ---

  async getDecryptedGlobalValue(key: string): Promise<string | null> {
    const setting = await this.db.globalIntegrationSetting.findUnique({ where: { key } });
    if (!setting) return null;
    if (setting.valueEncrypted) {
      return this.encryption.decrypt(setting.valueEncrypted);
    }
    return setting.valuePlain ?? null;
  }

  async getDecryptedHouseholdValue(householdId: string, key: string): Promise<string | null> {
    const setting = await this.db.householdIntegrationSetting.findUnique({
      where: { householdId_key: { householdId, key } },
    });
    if (!setting) return null;
    if (setting.valueEncrypted) {
      return this.encryption.decrypt(setting.valueEncrypted);
    }
    return setting.valuePlain ?? null;
  }
}
