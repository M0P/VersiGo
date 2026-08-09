import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import {
  DatabaseService,
  SettingsResolverService,
  type SettingResolution,
} from '@versigo/foundation';
import {
  getSettingDefinition,
  getUiConfigurableKeys,
  validateSettingValue,
} from '@versigo/foundation';
import type { SettingDefinition } from '@versigo/foundation';
import { SettingsStoreService } from '../admin-settings/settings-store.service';
import type { AuthenticatedUser } from '../identity/auth.service';
import {
  SystemConfigEntryDto,
  ConnectivityTestResultDto,
} from './dto/system-config.dto';
import {
  assertSafeTestEndpoint,
  UnsafeEndpointError,
} from '../../common/connectivity/connectivity-guard';
import { testEndpoint } from '../../common/connectivity/connectivity-test';

/**
 * Central system configuration (AP-17).
 *
 * - Allowlist-based: only keys from the versioned settings catalog may
 *   be read, set or reset. Unknown or bootstrap keys are rejected
 *   without exception.
 * - Atomic validation: an invalid UI value is NEVER persisted; the
 *   previously effective state stays and the error is visible.
 * - Secrets are persisted encrypted and never returned in plain text,
 *   logged or stored in audits.
 * - Every change/reset is audited revision-safe (without values).
 * - Connectivity tests run only for keys marked as testable, with a
 *   timeout and without disclosing secret values.
 */
@Injectable()
export class SystemConfigService {
  private readonly logger = new Logger(SystemConfigService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly resolver: SettingsResolverService,
    private readonly settingsStore: SettingsStoreService,
  ) {}

  /** Complete catalog view, groupable by category, for the admin UI. */
  async list(): Promise<SystemConfigEntryDto[]> {
    const uiKeys = getUiConfigurableKeys();
    const stored = await this.db.globalIntegrationSetting.findMany({
      where: { key: { in: [...uiKeys] } },
    });
    const storedByKey = new Map(stored.map((s) => [s.key, s]));
    // Bundled resolution (one DB access instead of N+1) + one-time
    // username resolution for UI readability.
    const resolutions = await this.resolver.resolveMany([...uiKeys]);
    const usernames = await this.resolveUsernames(stored);

    const entries: SystemConfigEntryDto[] = [];
    for (const key of uiKeys) {
      entries.push(
        this.buildEntry(key, storedByKey.get(key) ?? null, resolutions.get(key)!, usernames),
      );
    }
    return entries;
  }

  /** Single view of a catalogued key. */
  async get(key: string): Promise<SystemConfigEntryDto> {
    const definition = this.assertUiConfigurable(key);
    const stored = await this.db.globalIntegrationSetting.findUnique({ where: { key } });
    const resolution = await this.resolver.resolve(definition.key);
    const usernames = await this.resolveUsernames(stored ? [stored] : []);
    return this.buildEntry(definition.key, stored, resolution, usernames);
  }

  /**
   * Sets a UI value (atomically validated). Throws on invalid values
   * before anything is persisted.
   */
  async update(key: string, value: string, actor: AuthenticatedUser): Promise<SystemConfigEntryDto> {
    const definition = this.assertUiConfigurable(key);
    const validated = validateSettingValue(definition, value);
    if (!validated.ok) {
      throw new BadRequestException(`Invalid value for '${key}': ${validated.error}`);
    }

    const isSecret = definition.category === 'secret';
    const existing = await this.db.globalIntegrationSetting.findUnique({ where: { key } });

    if (existing) {
      await this.settingsStore.updateGlobalSetting(key, validated.canonical, isSecret, actor.id);
    } else {
      await this.settingsStore.createGlobalSetting(key, validated.canonical, isSecret, actor.id);
    }

    await this.audit(actor, key, 'SYSTEM_CONFIG_UPSERTED');
    this.logger.log(
      `System setting '${key}' set by user ${actor.id} (secret: ${isSecret})`,
    );
    return this.get(key);
  }

  /**
   * Resets the UI value (deletes the DB row). The effective value
   * then deterministically falls back to .env or the code default.
   */
  async reset(key: string, actor: AuthenticatedUser): Promise<SystemConfigEntryDto> {
    this.assertUiConfigurable(key);
    const existing = await this.db.globalIntegrationSetting.findUnique({ where: { key } });
    if (existing) {
      await this.settingsStore.deleteGlobalSetting(key);
    }
    await this.audit(actor, key, 'SYSTEM_CONFIG_RESET');
    this.logger.log(`System setting '${key}' reset to fallback by user ${actor.id}`);
    return this.get(key);
  }

  /** Safe connectivity check for keys marked as testable. */
  async testConnectivity(
    key: string,
    actor: AuthenticatedUser,
  ): Promise<ConnectivityTestResultDto> {
    const definition = this.assertUiConfigurable(key);
    if (!definition.connectivityTestable) {
      throw new BadRequestException(
        `No connectivity check is defined for '${key}'`,
      );
    }

    const result: ConnectivityTestResultDto = {
      success: false,
      message: '',
      timestamp: new Date().toISOString(),
    };

    try {
      const { url, token } = await this.buildEndpoint(definition);
      if (!url) {
        result.message = 'Kein Endpunkt konfiguriert – bitte zuerst den Wert setzen.';
        await this.audit(actor, key, 'SYSTEM_CONFIG_TESTED', false);
        return result;
      }

      // BugFix-06 (part 2): SSRF relaxation is explicitly opt-in. The strict
      // default (only public http(s) endpoints) stays; only
      // CONNECTIVITY_ALLOW_PRIVATE_ENDPOINTS allows local/private endpoints
      // (cloud metadata always stays blocked).
      // CONNECTIVITY_ALLOW_SELF_SIGNED tolerates self-signed certificates
      // only for this test request.
      const allowPrivate = await this.resolveBooleanSetting(
        'CONNECTIVITY_ALLOW_PRIVATE_ENDPOINTS',
      );
      const allowSelfSigned = await this.resolveBooleanSetting('CONNECTIVITY_ALLOW_SELF_SIGNED');

      // SSRF protection: only http(s), no local/private/metadata addresses.
      await assertSafeTestEndpoint(url, { allowPrivate });

      const tested = await testEndpoint(url, {
        token,
        rejectUnauthorized: allowSelfSigned ? false : true,
        // Check redirect targets against the SSRF guard with the same
        // mode (BugFix-06, review fix).
        allowPrivate,
      });
      // <500 counts as "reachable": even 401/403 prove that the endpoint
      // runs without the response content being checked.
      result.success = tested.success;
      result.message = tested.message;
    } catch (error: unknown) {
      if (error instanceof UnsafeEndpointError) {
        // M5: instead of a confusing rejection, give a clear reason +
        // guidance (the default value of many integrations is localhost
        // and by design not testable via the UI).
        result.message =
          `Endpunkt aus Sicherheitsgruenden abgelehnt: ${error.message} ` +
          `– der Connectivity-Test erlaubt aus SSRF-Schutz nur oeffentliche ` +
          `http(s)-Endpunkte; lokale Dienste (z. B. Ollama unter localhost) ` +
          `pruefen Sie bitte direkt auf dem Host.`;
      } else {
        // m10: no internal error details (hostnames, resolver texts) are
        // mirrored to the admin UI - only a safe, generic message.
        result.message =
          'Verbindungsfehler: Der Endpunkt ist nicht erreichbar ' +
          '(Zeitueberschreitung oder Verbindungsabbruch).';
      }
    }

    // Revision-safe audit without URLs, tokens or response contents.
    await this.audit(actor, key, 'SYSTEM_CONFIG_TESTED', result.success);

    return result;
  }

  // --- Intern ---

  private buildEntry(
    key: string,
    stored: { updatedAt: Date; updatedByUserId: string | null } | null,
    resolution: SettingResolution,
    usernames: Map<string, string>,
  ): SystemConfigEntryDto {
    const definition = getSettingDefinition(key)!;
    const isSecret = definition.category === 'secret';
    const actorId = stored?.updatedByUserId ?? null;

    return {
      key: definition.key,
      category: definition.category,
      type: definition.type,
      group: definition.group,
      description: definition.description,
      validationHint: definition.validationHint ?? null,
      allowedValues: definition.allowedValues ? [...definition.allowedValues] : null,
      min: definition.min ?? null,
      max: definition.max ?? null,
      connectivityTestable: definition.connectivityTestable,
      secret: isSecret,
      effectiveValue: isSecret ? null : (resolution.value ?? null),
      secretSet: isSecret ? resolution.value !== undefined : null,
      source: resolution.source,
      reason: resolution.reason,
      uiValuePresent: resolution.uiValuePresent,
      uiValueInvalid: resolution.uiValueInvalid,
      // m8: "restart required" only when a pending value is actually
      // present (the not-yet-active DB value) - not for already active
      // values (e.g. after a restart via preload).
      restartRequired:
        definition.category === 'restart' && resolution.pendingRestartValue !== undefined,
      // restart category: the pending (not-yet-active) UI value is
      // separately flagged so that it never appears as already effective.
      pendingRestartValue:
        definition.category === 'restart' && !isSecret
          ? (resolution.pendingRestartValue ?? null)
          : null,
      uiUpdatedAt: stored?.updatedAt?.toISOString() ?? null,
      uiUpdatedBy: actorId ? (usernames.get(actorId) ?? actorId) : null,
    };
  }

  /**
   * Resolves actor user IDs to usernames (UI readability instead of raw
   * UUIDs). On a failed resolution the UUID stays visible.
   */
  private async resolveUsernames(
    stored: ReadonlyArray<{ updatedByUserId: string | null }>,
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(
        stored
          .map((s) => s.updatedByUserId)
          .filter((id): id is string => id !== null),
      ),
    ];
    if (ids.length === 0) return new Map();
    try {
      const users = await this.db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, username: true },
      });
      return new Map(users.map((u) => [u.id, u.username]));
    } catch (error) {
      this.logger.warn(`Username resolution failed: ${(error as Error).message}`);
      return new Map();
    }
  }

  /**
   * Allowlist check: the key must exist in the catalog and must not
   * belong to the bootstrap category (which is exclusively environment/
   * Compose and never changeable via the UI).
   */
  private assertUiConfigurable(key: string): SettingDefinition {
    const definition = getSettingDefinition(key);
    if (!definition) {
      throw new NotFoundException(
        `Unknown settings key '${key}' – not in the catalog (allowlist).`,
      );
    }
    if (definition.category === 'bootstrap') {
      throw new ForbiddenException(
        `'${key}' is an infrastructure/bootstrap configuration and can only be set via environment/Compose.`,
      );
    }
    return definition;
  }

  /**
   * Reads a catalogued boolean key via the central
   * resolution (UI > .env > default). A resolution error degrades safely
   * to `false` (= strict behavior) so that a broken DB value never
   * relaxes the SSRF protection.
   */
  private async resolveBooleanSetting(key: string): Promise<boolean> {
    try {
      return (await this.resolver.getEffectiveBoolean(key)) ?? false;
    } catch (error) {
      this.logger.warn(
        `Setting '${key}' could not be resolved – using strict default: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  /** Derives the test endpoint from the effective value for testable keys. */
  private async buildEndpoint(
    definition: SettingDefinition,
  ): Promise<{ url: string; token?: string }> {
    switch (definition.key) {
      case 'AI_OLLAMA_BASE_URL': {
        const base = (
          (await this.resolver.getEffectiveString('AI_OLLAMA_BASE_URL')) ?? ''
        ).replace(/\/+$/, '');
        return { url: base ? `${base}/api/tags` : '' };
      }
      case 'AI_OPENAI_COMPAT_BASE_URL':
      case 'AI_OPENAI_COMPAT_API_KEY': {
        const base = (
          (await this.resolver.getEffectiveString('AI_OPENAI_COMPAT_BASE_URL')) ?? ''
        ).replace(/\/+$/, '');
        const token = await this.resolver.getEffectiveString('AI_OPENAI_COMPAT_API_KEY');
        return { url: base ? `${base}/models` : '', token };
      }
      case 'PAPERLESS_URL':
      case 'PAPERLESS_API_TOKEN': {
        const base = (
          (await this.resolver.getEffectiveString('PAPERLESS_URL')) ?? ''
        ).replace(/\/+$/, '');
        const token = await this.resolver.getEffectiveString('PAPERLESS_API_TOKEN');
        return { url: base ? `${base}/api/` : '', token };
      }
      default:
        return { url: '' };
    }
  }

  /** Revision-safe audit without values, URLs or secrets. */
  private async audit(
    actor: AuthenticatedUser,
    key: string,
    action: 'SYSTEM_CONFIG_UPSERTED' | 'SYSTEM_CONFIG_RESET' | 'SYSTEM_CONFIG_TESTED',
    outcome?: boolean,
  ): Promise<void> {
    try {
      await this.db.auditEvent.create({
        data: {
          actorUserId: actor.id,
          entityType: 'SystemSetting',
          entityId: key,
          action,
          // Result only as a categorized status (ok/failed) – never URLs,
          // tokens or response contents.
          diffJson:
            outcome === undefined
              ? ({ key, redacted: true } as never)
              : ({ key, redacted: true, outcome: outcome ? 'ok' : 'failed' } as never),
        },
      });
    } catch (error) {
      this.logger.warn(`Audit entry failed: ${(error as Error).message}`);
    }
  }
}
