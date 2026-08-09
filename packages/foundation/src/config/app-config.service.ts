import { Injectable, Optional } from '@nestjs/common';
import { AppConfig, parseAppConfig } from './app-config.schema';

/**
 * Access point for the validated configuration.
 * Sensitive values (e.g. SETTINGS_ENCRYPTION_KEY, OIDC_CLIENT_SECRET)
 * are used only internally and never exposed via health/readiness
 * endpoints or logs.
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

  /** Runtime application version (APP_VERSION), undefined when not set. */
  get appVersion(): string | undefined {
    return this.config.APP_VERSION;
  }

  get encryptionKeyHex(): string {
    return this.config.SETTINGS_ENCRYPTION_KEY;
  }
}
