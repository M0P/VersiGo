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

/**
 * Zentrale Systemkonfiguration (AP-17).
 *
 * - Allowlist-basiert: Nur Schluessel aus dem versionierten Settings-Katalog
 *   duerfen gelesen, gesetzt oder zurueckgesetzt werden. Unbekannte oder
 *   Bootstrap-Schluessel werden ausnahmslos abgewiesen.
 * - Atomare Validierung: Ein ungueltiger UI-Wert wird NIE persistiert; der
 *   zuvor wirksame Zustand bleibt erhalten und der Fehler ist sichtbar.
 * - Secrets werden verschluesselt persistiert und niemals im Klartext
 *   zurueckgegeben, geloggt oder in Audits gespeichert.
 * - Jede Aenderung/Reset wird revisionssicher auditiert (ohne Werte).
 * - Connectivity-Tests laufen nur fuer als pruefbar markierte Schluessel,
 *   mit Timeout und ohne Preisgabe geheimer Werte.
 */
@Injectable()
export class SystemConfigService {
  private readonly logger = new Logger(SystemConfigService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly resolver: SettingsResolverService,
    private readonly settingsStore: SettingsStoreService,
  ) {}

  /** Vollstaendige, nach Gruppen gruppierbare Katalogansicht fuer die Admin-UI. */
  async list(): Promise<SystemConfigEntryDto[]> {
    const uiKeys = getUiConfigurableKeys();
    const stored = await this.db.globalIntegrationSetting.findMany({
      where: { key: { in: [...uiKeys] } },
    });
    const storedByKey = new Map(stored.map((s) => [s.key, s]));
    // Gebuendelte Aufloesung (ein DB-Zugriff statt N+1) + einmalige
    // Benutzernamen-Aufloesung fuer die UI-Lesbarkeit.
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

  /** Einzelansicht eines katalogisierten Schluessels. */
  async get(key: string): Promise<SystemConfigEntryDto> {
    const definition = this.assertUiConfigurable(key);
    const stored = await this.db.globalIntegrationSetting.findUnique({ where: { key } });
    const resolution = await this.resolver.resolve(definition.key);
    const usernames = await this.resolveUsernames(stored ? [stored] : []);
    return this.buildEntry(definition.key, stored, resolution, usernames);
  }

  /**
   * Setzt einen UI-Wert (atomar validiert). Wirft bei ungueltigen Werten,
   * bevor irgendetwas persistiert wird.
   */
  async update(key: string, value: string, actor: AuthenticatedUser): Promise<SystemConfigEntryDto> {
    const definition = this.assertUiConfigurable(key);
    const validated = validateSettingValue(definition, value);
    if (!validated.ok) {
      throw new BadRequestException(`Ungueltiger Wert fuer '${key}': ${validated.error}`);
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
      `System-Setting '${key}' von User ${actor.id} gesetzt (secret: ${isSecret})`,
    );
    return this.get(key);
  }

  /**
   * Setzt den UI-Wert zurueck (Loeschung der DB-Zeile). Der effektive Wert
   * faellt danach deterministisch auf .env bzw. Code-Default zurueck.
   */
  async reset(key: string, actor: AuthenticatedUser): Promise<SystemConfigEntryDto> {
    this.assertUiConfigurable(key);
    const existing = await this.db.globalIntegrationSetting.findUnique({ where: { key } });
    if (existing) {
      await this.settingsStore.deleteGlobalSetting(key);
    }
    await this.audit(actor, key, 'SYSTEM_CONFIG_RESET');
    this.logger.log(`System-Setting '${key}' von User ${actor.id} auf Fallback zurueckgesetzt`);
    return this.get(key);
  }

  /** Sichere Connectivity-Pruefung fuer als pruefbar markierte Schluessel. */
  async testConnectivity(
    key: string,
    actor: AuthenticatedUser,
  ): Promise<ConnectivityTestResultDto> {
    const definition = this.assertUiConfigurable(key);
    if (!definition.connectivityTestable) {
      throw new BadRequestException(
        `Fuer '${key}' ist keine Connectivity-Pruefung definiert`,
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

      // SSRF-Schutz: nur http(s), keine lokalen/privaten/metadata-Adressen.
      await assertSafeTestEndpoint(url);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: token
            ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
            : { 'Content-Type': 'application/json' },
        });
        // <500 gilt als "erreichbar": auch 401/403 beweisen, dass der
        // Endpunkt laeuft, ohne dass der Response-Inhalt geprueft wird.
        result.success = response.ok || response.status < 500;
        result.message = `HTTP ${response.status}: ${response.statusText}`;
      } finally {
        clearTimeout(timeout);
      }
    } catch (error: unknown) {
      if (error instanceof UnsafeEndpointError) {
        // M5: statt einer verwirrenden Ablehnung eine klare Begruendung +
        // Handlungsanleitung (der Standardwert vieler Integrationen ist
        // localhost und per Design nicht ueber die UI testbar).
        result.message =
          `Endpunkt aus Sicherheitsgruenden abgelehnt: ${error.message} ` +
          `– der Connectivity-Test erlaubt aus SSRF-Schutz nur oeffentliche ` +
          `http(s)-Endpunkte; lokale Dienste (z. B. Ollama unter localhost) ` +
          `pruefen Sie bitte direkt auf dem Host.`;
      } else {
        // m10: keine internen Fehlerdetails (Hostnamen, Resolver-Texte) an
        // die Admin-UI spiegeln – nur ein sicherer, generischer Hinweis.
        result.message =
          'Verbindungsfehler: Der Endpunkt ist nicht erreichbar ' +
          '(Zeitueberschreitung oder Verbindungsabbruch).';
      }
    }

    // Revisionssicheres Audit ohne URLs, Tokens oder Response-Inhalte.
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
      // m8: "Neustart erforderlich" nur, wenn tatsaechlich ein pendenter
      // Wert vorliegt (der noch nicht aktive DB-Wert) – nicht fuer
      // bereits aktive Werte (z. B. nach einem Neustart per Preload).
      restartRequired:
        definition.category === 'restart' && resolution.pendingRestartValue !== undefined,
      // Restart-Kategorie: der pendente (noch nicht aktive) UI-Wert wird
      // separat ausgewiesen, damit er nie als bereits wirksam erscheint.
      pendingRestartValue:
        definition.category === 'restart' && !isSecret
          ? (resolution.pendingRestartValue ?? null)
          : null,
      uiUpdatedAt: stored?.updatedAt?.toISOString() ?? null,
      uiUpdatedBy: actorId ? (usernames.get(actorId) ?? actorId) : null,
    };
  }

  /**
   * Loest Actor-User-IDs zu Benutzernamen auf (UI-Lesbarkeit statt roher
   * UUIDs). Bei fehlgeschlagener Aufloesung bleibt die UUID sichtbar.
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
      this.logger.warn(`User-Namensaufloesung fehlgeschlagen: ${(error as Error).message}`);
      return new Map();
    }
  }

  /**
   * Allowlist-Pruefung: Schluessel muss im Katalog existieren und darf nicht
   * der Bootstrap-Kategorie angehoeren (diese ist ausschliesslich
   * Environment/Compose und nie ueber die UI aenderbar).
   */
  private assertUiConfigurable(key: string): SettingDefinition {
    const definition = getSettingDefinition(key);
    if (!definition) {
      throw new NotFoundException(
        `Unbekannter Settings-Schluessel '${key}' – nicht im Katalog (Allowlist).`,
      );
    }
    if (definition.category === 'bootstrap') {
      throw new ForbiddenException(
        `'${key}' ist eine Infrastruktur-/Bootstrap-Konfiguration und nur ueber Environment/Compose setzbar.`,
      );
    }
    return definition;
  }

  /** Leitet fuer pruefbare Schluessel den Test-Endpunkt aus dem effektiven Wert ab. */
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

  /** Revisionssicheres Audit ohne Werte, URLs oder Secrets. */
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
          // Ergebnis nur als kategoriesierter Status (ok/failed) – niemals
          // URLs, Tokens oder Response-Inhalte.
          diffJson:
            outcome === undefined
              ? ({ key, redacted: true } as never)
              : ({ key, redacted: true, outcome: outcome ? 'ok' : 'failed' } as never),
        },
      });
    } catch (error) {
      this.logger.warn(`Audit-Eintrag fehlgeschlagen: ${(error as Error).message}`);
    }
  }
}
