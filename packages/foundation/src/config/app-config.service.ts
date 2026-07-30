import { Injectable, Optional } from '@nestjs/common';
import { AppConfig, parseAppConfig } from './app-config.schema';

/**
 * Zugriffspunkt auf die validierte Konfiguration.
 * Sensitive Werte (z. B. SETTINGS_ENCRYPTION_KEY, OIDC_CLIENT_SECRET)
 * werden ausschliesslich intern verwendet und nie ueber
 * Health-/Readiness-Endpunkte oder Logs ausgegeben.
 */
@Injectable()
export class AppConfigService {
  private readonly config: AppConfig;

  constructor(@Optional() env?: Record<string, string | undefined>) {
    this.config = parseAppConfig(env ?? process.env);
  }

  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.config[key];
  }

  get isProduction(): boolean {
    return this.config.NODE_ENV === 'production';
  }

  get databaseUrl(): string {
    return this.config.DATABASE_URL;
  }

  get redisUrl(): string {
    return this.config.REDIS_URL;
  }

  get encryptionKeyHex(): string {
    return this.config.SETTINGS_ENCRYPTION_KEY;
  }
}
