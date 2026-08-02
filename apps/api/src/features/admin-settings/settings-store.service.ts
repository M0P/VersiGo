import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { DatabaseService } from '@versigo/foundation';
import { ENCRYPTION_PORT, type EncryptionPort } from '@versigo/foundation';
import { Inject } from '@nestjs/common';

/**
 * Verwaltet verschlüsselte und Klartext-Settings auf globaler und
 * Household-Ebene. Secrets werden automatisch über den EncryptionPort
 * ver- und entschlüsselt. API-Keys werden niemals im Klartext ausgegeben
 * oder geloggt.
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
      // Immer maskiert ausliefern; der Wert wird nur beim Setzen/Updaten uebermittelt
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
      throw new NotFoundException(`Globales Setting '${key}' nicht gefunden`);
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

    // Pruefe auf doppelten Key
    const existing = await this.db.globalIntegrationSetting.findUnique({ where: { key } });
    if (existing) {
      throw new ConflictException(`Globales Setting '${key}' existiert bereits`);
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
      throw new NotFoundException(`Globales Setting '${key}' nicht gefunden`);
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
      // Wert nicht uebergeben -> bestehenden Wert beibehalten
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
      throw new NotFoundException(`Globales Setting '${key}' nicht gefunden`);
    }

    await this.db.globalIntegrationSetting.delete({ where: { key } });
    this.logger.log(`Globales Setting '${key}' geloescht`);
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
      throw new NotFoundException(`Household-Setting '${key}' nicht gefunden`);
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
      throw new ConflictException(`Household-Setting '${key}' existiert bereits`);
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

    this.logger.log(`Household-Setting '${key}' fuer Household ${householdId} angelegt (hasValue: ${valuePlain !== undefined})`);

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
      throw new NotFoundException(`Household-Setting '${key}' nicht gefunden`);
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

    this.logger.log(`Household-Setting '${key}' fuer Household ${householdId} aktualisiert`);

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
      throw new NotFoundException(`Household-Setting '${key}' nicht gefunden`);
    }

    await this.db.householdIntegrationSetting.delete({
      where: { householdId_key: { householdId, key } },
    });
    this.logger.log(`Household-Setting '${key}' fuer Household ${householdId} geloescht`);
    return { success: true };
  }

  // --- Intern: Entschluesselten Wert fuer Backend-Zwecke lesen ---

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
