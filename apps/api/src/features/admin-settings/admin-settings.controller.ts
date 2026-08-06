import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import { SettingsStoreService } from './settings-store.service';
import { RestartService } from './restart.service';
import {
  AppConfigService,
  DatabaseService,
  SettingsResolverService,
  getSettingDefinition,
  validateSettingValue,
} from '@versigo/foundation';
import type { SettingDefinition } from '@versigo/foundation';
import { CurrentUser } from '../identity/current-user.decorator';
import { HouseholdMembershipGuard } from '../identity/household-membership.guard';
import { Roles } from '../identity/roles.decorator';
import type { AuthenticatedUser } from '../identity/auth.service';
import {
  CreateGlobalSettingDto,
  UpdateGlobalSettingDto,
  CreateHouseholdSettingDto,
  UpdateHouseholdSettingDto,
  ConnectivityTestDto,
  ConnectivityTestResultDto,
  RestartServicesDto,
} from './dto/admin-settings.dto';
import { assertSafeTestEndpoint } from '../../common/connectivity/connectivity-guard';
import { testEndpoint } from '../../common/connectivity/connectivity-test';

// Hilfsfunktion: Prueft, ob der User die globale Rolle ADMIN hat (ADR-007)
function assertIsGlobalAdmin(user: AuthenticatedUser): void {
  if (user.role !== GlobalRole.ADMIN) {
    throw new ForbiddenException('Nur globale Administratoren koennen diese Aktion ausfuehren');
  }
}

@Controller()
export class AdminSettingsController {
  private readonly logger = new Logger(AdminSettingsController.name);

  constructor(
    private readonly settingsStore: SettingsStoreService,
    private readonly config: AppConfigService,
    private readonly db: DatabaseService,
    private readonly resolver: SettingsResolverService,
    private readonly restartService: RestartService,
  ) {}

  // =====================
  // Global Settings
  // =====================

  @Get('admin/settings')
  async listGlobalSettings(@CurrentUser() user: AuthenticatedUser) {
    assertIsGlobalAdmin(user);
    return this.settingsStore.listGlobalSettings();
  }

  @Get('admin/settings/:key')
  async getGlobalSetting(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
  ) {
    assertIsGlobalAdmin(user);
    return this.settingsStore.getGlobalSetting(key);
  }

  @Post('admin/settings')
  async createGlobalSetting(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateGlobalSettingDto,
  ) {
    assertIsGlobalAdmin(user);
    // M3: Legacy-Endpunkte laufen durch dieselbe Katalog-Allowlist und
    // Typvalidierung wie die neue Systemkonfiguration; isSecret wird NIE
    // vom Aufrufer uebernommen, sondern aus der Katalog-Kategorie erzwungen.
    const definition = this.assertCatalogSetting(dto.key);
    // m9: Anlage ohne Wert wuerde eine "tote" Zeile ohne Wert erzeugen,
    // die in keiner UI auftaucht und nicht zurueckgesetzt werden kann.
    // `== null` faengt sowohl undefined als auch explizites null ab
    // (null passiert @IsOptional() und wuerde sonst einen HTTP-500 in der
    // Typvalidierung ausloesen).
    if (dto.valuePlain == null) {
      throw new BadRequestException(
        `Ein Wert ist fuer '${dto.key}' erforderlich (Anlage).`,
      );
    }
    const { valuePlain, isSecret } = this.validateLegacyValue(definition, dto.valuePlain);
    return this.settingsStore.createGlobalSetting(dto.key, valuePlain, isSecret);
  }

  @Patch('admin/settings/:key')
  async updateGlobalSetting(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
    @Body() dto: UpdateGlobalSettingDto,
  ) {
    assertIsGlobalAdmin(user);
    const definition = this.assertCatalogSetting(key);
    const { valuePlain, isSecret } = this.validateLegacyValue(definition, dto.valuePlain);
    return this.settingsStore.updateGlobalSetting(key, valuePlain, isSecret);
  }

  @Delete('admin/settings/:key')
  async deleteGlobalSetting(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
  ) {
    assertIsGlobalAdmin(user);
    return this.settingsStore.deleteGlobalSetting(key);
  }

  // =====================
  // Connectivity Test
  // =====================

  @Post('admin/connectivity-test')
  async testConnectivity(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConnectivityTestDto,
  ): Promise<ConnectivityTestResultDto> {
    assertIsGlobalAdmin(user);

    const result: ConnectivityTestResultDto = {
      success: false,
      message: '',
      timestamp: new Date().toISOString(),
    };

    try {
      switch (dto.integrationKey) {
        case 'database': {
          const healthy = await this.db.isHealthy();
          result.success = healthy;
          result.message = healthy
            ? 'Datenbankverbindung erfolgreich'
            : 'Datenbankverbindung fehlgeschlagen';
          break;
        }
        default: {
          // Allgemeiner HTTP-Connectivity-Test fuer externe Dienste
          if (dto.endpoint) {
            // BugFix-06 (Teil 2): SSRF-Lockerung ist explizit opt-in. Der
            // strikte Default (nur oeffentliche http(s)-Endpunkte) bleibt
            // erhalten; erst die Admin-Einstellung
            // CONNECTIVITY_ALLOW_PRIVATE_ENDPOINTS erlaubt lokale/private
            // Endpunkte (Cloud-Metadata bleibt immer gesperrt).
            const allowPrivate = await this.resolveBooleanSetting(
              'CONNECTIVITY_ALLOW_PRIVATE_ENDPOINTS',
            );
            const allowSelfSigned = await this.resolveBooleanSetting(
              'CONNECTIVITY_ALLOW_SELF_SIGNED',
            );
            try {
              await assertSafeTestEndpoint(dto.endpoint, { allowPrivate });
            } catch (error: unknown) {
              // M5-ext: gleiche Handlungsanleitung wie beim
              // Systemkonfigurations-Test, damit Nutzer nicht annehmen,
              // lokale Dienste seien per UI testbar.
              result.message =
                `Endpunkt aus Sicherheitsgruenden abgelehnt: ` +
                `${(error as Error).message} – der Connectivity-Test erlaubt ` +
                `aus SSRF-Schutz nur oeffentliche http(s)-Endpunkte; lokale ` +
                `Dienste (z. B. Ollama unter localhost) pruefen Sie bitte ` +
                `direkt auf dem Host.`;
              break;
            }
            try {
              const tested = await testEndpoint(dto.endpoint, {
                token: dto.apiToken,
                rejectUnauthorized: allowSelfSigned ? false : true,
                // Redirect-Ziele mit dem gleichen Modus gegen den SSRF-Guard
                // pruefen (BugFix-06, Review-Fix).
                allowPrivate,
              });
              result.success = tested.success;
              result.message = tested.message;
            } catch {
              result.success = false;
              result.message = 'Verbindungsfehler: Der Endpunkt ist nicht erreichbar.';
            }
          } else {
            result.message = `Kein Endpoint fuer Integration '${dto.integrationKey}' angegeben`;
          }
          break;
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unbekannter Fehler';
      result.message = `Verbindungsfehler: ${message}`;
    }

    return result;
  }

  // =====================
  // Dienste-Neustart (BugFix-06, Teil 3.4)
  // =====================

  /**
   * Startet API und Worker kontrolliert neu, damit boot-relevante
   * Einstellungen (Kategorie "restart", z. B. OIDC-Bootstrap) wirksam
   * werden. Nur globale Admins. Die HTTP-Antwort erreicht den Client
   * (der API-Prozess beendet sich erst nach kurzer Verzoegerung);
   * Compose (`restart: unless-stopped`) startet den Container neu.
   */
  @Post('admin/restart')
  async restartServices(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RestartServicesDto,
  ) {
    assertIsGlobalAdmin(user);
    await this.restartService.requestRestart(user, dto.reason);
    return { success: true, message: 'Neustart von API und Worker ausgeloest.' };
  }

  // =====================
  // Config Validation
  // =====================

  @Get('admin/config-validation')
  async validateConfig(
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertIsGlobalAdmin(user);

    const checks: { key: string; status: 'ok' | 'warn' | 'error'; message: string }[] = [];

    try {
      // Pruefe Datenbank (liest einen Dummy-Eintrag)
      const dbOk = await this.config.get('DATABASE_URL')?.length > 0;
      checks.push({
        key: 'DATABASE_URL',
        status: dbOk ? 'ok' : 'error',
        message: dbOk ? 'DATABASE_URL ist gesetzt' : 'DATABASE_URL fehlt',
      });
    } catch {
      checks.push({
        key: 'DATABASE_URL',
        status: 'error',
        message: 'DATABASE_URL konnte nicht validiert werden',
      });
    }

    try {
      const redisUrl = this.config.get('REDIS_URL');
      checks.push({
        key: 'REDIS_URL',
        status: redisUrl?.length > 0 ? 'ok' : 'error',
        message: redisUrl?.length > 0 ? 'REDIS_URL ist gesetzt' : 'REDIS_URL fehlt',
      });
    } catch {
      checks.push({
        key: 'REDIS_URL',
        status: 'error',
        message: 'REDIS_URL konnte nicht validiert werden',
      });
    }

    // Verschlüsselungsschlüssel
    try {
      const encKey = this.config.get('SETTINGS_ENCRYPTION_KEY');
      const isValid = /^[0-9a-fA-F]{64}$/.test(encKey);
      checks.push({
        key: 'SETTINGS_ENCRYPTION_KEY',
        status: isValid ? 'ok' : 'error',
        message: isValid
          ? 'SETTINGS_ENCRYPTION_KEY ist ein gueltiger 32-Byte-Hex-String'
          : 'SETTINGS_ENCRYPTION_KEY ist kein gueltiger 32-Byte-Hex-String',
      });
    } catch {
      checks.push({
        key: 'SETTINGS_ENCRYPTION_KEY',
        status: 'error',
        message: 'SETTINGS_ENCRYPTION_KEY konnte nicht validiert werden',
      });
    }

    // Sitzungs-Geheimnis
    try {
      const sessionSecret = this.config.get('SESSION_SECRET');
      checks.push({
        key: 'SESSION_SECRET',
        status: sessionSecret && sessionSecret.length >= 32 ? 'ok' : 'error',
        message:
          sessionSecret && sessionSecret.length >= 32
            ? 'SESSION_SECRET ist ausreichend lang'
            : 'SESSION_SECRET ist zu kurz (min. 32 Zeichen)',
      });
    } catch {
      checks.push({
        key: 'SESSION_SECRET',
        status: 'error',
        message: 'SESSION_SECRET konnte nicht validiert werden',
      });
    }

    // Optional: OIDC-Konfiguration
    const oidcEnabled = this.config.get('OIDC_ENABLED');
    if (oidcEnabled) {
      checks.push({
        key: 'OIDC_ENABLED',
        status: 'ok',
        message: 'OIDC ist aktiviert',
      });

      const oidcIssuer = this.config.get('OIDC_ISSUER_URL');
      checks.push({
        key: 'OIDC_ISSUER_URL',
        status: oidcIssuer?.length ? 'ok' : 'error',
        message: oidcIssuer?.length ? 'OIDC_ISSUER_URL ist gesetzt' : 'OIDC_ISSUER_URL fehlt',
      });

      const oidcClientId = this.config.get('OIDC_CLIENT_ID');
      checks.push({
        key: 'OIDC_CLIENT_ID',
        status: oidcClientId?.length ? 'ok' : 'error',
        message: oidcClientId?.length ? 'OIDC_CLIENT_ID ist gesetzt' : 'OIDC_CLIENT_ID fehlt',
      });
    } else {
      checks.push({
        key: 'OIDC_ENABLED',
        status: 'warn',
        message: 'OIDC ist deaktiviert (nur lokal/Entwicklung)',
      });
    }

    // Pruefe ob alle Pflicht-Settings vorhanden sind
    const appBaseUrl = this.config.get('APP_PORT');
    checks.push({
      key: 'APP_PORT',
      status: appBaseUrl ? 'ok' : 'warn',
      message: appBaseUrl
        ? `API-Port: ${appBaseUrl}`
        : 'APP_PORT nicht gesetzt, verwende Standard 3001',
    });

    return {
      valid: checks.every((c) => c.status !== 'error'),
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  // =====================
  // Household Settings (household-scoped)
  // =====================

  @Get('households/:householdId/admin/settings')
  @UseGuards(HouseholdMembershipGuard)
  @Roles(GlobalRole.ADMIN)
  async listHouseholdSettings(
    @Param('householdId') householdId: string,
  ) {
    return this.settingsStore.listHouseholdSettings(householdId);
  }

  @Get('households/:householdId/admin/settings/:key')
  @UseGuards(HouseholdMembershipGuard)
  @Roles(GlobalRole.ADMIN)
  async getHouseholdSetting(
    @Param('householdId') householdId: string,
    @Param('key') key: string,
  ) {
    return this.settingsStore.getHouseholdSetting(householdId, key);
  }

  @Post('households/:householdId/admin/settings')
  @UseGuards(HouseholdMembershipGuard)
  @Roles(GlobalRole.ADMIN)
  async createHouseholdSetting(
    @Param('householdId') householdId: string,
    @Body() dto: CreateHouseholdSettingDto,
  ) {
    return this.settingsStore.createHouseholdSetting(
      householdId,
      dto.key,
      dto.valuePlain,
      dto.isSecret,
    );
  }

  @Patch('households/:householdId/admin/settings/:key')
  @UseGuards(HouseholdMembershipGuard)
  @Roles(GlobalRole.ADMIN)
  async updateHouseholdSetting(
    @Param('householdId') householdId: string,
    @Param('key') key: string,
    @Body() dto: UpdateHouseholdSettingDto,
  ) {
    return this.settingsStore.updateHouseholdSetting(
      householdId,
      key,
      dto.valuePlain,
      dto.isSecret,
    );
  }

  @Delete('households/:householdId/admin/settings/:key')
  @UseGuards(HouseholdMembershipGuard)
  @Roles(GlobalRole.ADMIN)
  async deleteHouseholdSetting(
    @Param('householdId') householdId: string,
    @Param('key') key: string,
  ) {
    return this.settingsStore.deleteHouseholdSetting(householdId, key);
  }

  // =====================
  // Intern (M3): Katalog-Allowlist + Wertvalidierung fuer Legacy-Endpunkte
  // =====================

  /**
   * Liest einen katalogisierten Boolean-Schluessel ueber die zentrale
   * Aufloesung (UI > .env > Default). Ein Aufloesungsfehler degradiert
   * sicher auf `false` (= striktes Verhalten), damit ein kaputter
   * DB-Wert niemals den SSRF-Schutz lockert.
   */
  private async resolveBooleanSetting(key: string): Promise<boolean> {
    try {
      return (await this.resolver.getEffectiveBoolean(key)) ?? false;
    } catch (error) {
      this.logger.warn(
        `Einstellung '${key}' konnte nicht aufgeloest werden – verwende strikten Default: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  /**
   * Allowlist-Pruefung fuer die Legacy-Global-Settings-Endpunkte: Der
   * Schluessel muss im versionierten Settings-Katalog existieren und darf
   * nicht der Bootstrap-Kategorie angehoeren (nur Environment/Compose).
   * Unbekannte oder Bootstrap-Schluessel koennen ueber die UI weder
   * angelegt noch geaendert werden.
   */
  private assertCatalogSetting(key: string): SettingDefinition {
    const definition = getSettingDefinition(key);
    if (!definition) {
      throw new BadRequestException(
        `Unbekannter Settings-Schluessel '${key}' – nicht im Katalog (Allowlist).`,
      );
    }
    if (definition.category === 'bootstrap') {
      throw new BadRequestException(
        `'${key}' ist eine Infrastruktur-/Bootstrap-Konfiguration und nur ueber Environment/Compose setzbar.`,
      );
    }
    return definition;
  }

  /**
   * Wertvalidierung + erzwungenes Geheimnis-Flag: `isSecret` wird NIE vom
   * Aufrufer uebernommen, sondern ausschliesslich aus der Katalog-Kategorie
   * abgeleitet. Ein Katalog-Secret kann so nicht als Klartext abgelegt
   * werden und ein Nicht-Secret nicht versehentlich als Secret.
   */
  private validateLegacyValue(
    definition: SettingDefinition,
    valuePlain: string | undefined,
  ): { valuePlain: string | undefined; isSecret: boolean } {
    const isSecret = definition.category === 'secret';
    if (valuePlain === undefined) {
      return { valuePlain: undefined, isSecret };
    }
    const validated = validateSettingValue(definition, valuePlain);
    if (!validated.ok) {
      throw new BadRequestException(
        `Ungueltiger Wert fuer '${definition.key}': ${validated.error}`,
      );
    }
    return { valuePlain: validated.canonical, isSecret };
  }
}
