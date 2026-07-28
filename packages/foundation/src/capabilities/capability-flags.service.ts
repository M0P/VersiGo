import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config';

export type CapabilityKey = 'oidc' | 'ai' | 'paperless' | 'storage';

/**
 * Zentrale Auskunftstelle darueber, ob eine optionale Integration
 * aktiviert ist. Enthaelt keine Fachlogik der jeweiligen Integration,
 * nur die reine An/Aus-Auskunft auf Basis der Umgebungskonfiguration.
 * Spaeter erweiterbar um Household-spezifische FeatureFlag-Ueberschreibung
 * aus der Datenbank (nicht Teil von AP2).
 */
@Injectable()
export class CapabilityFlagsService {
  constructor(private readonly config: AppConfigService) {}

  isEnabled(capability: CapabilityKey): boolean {
    switch (capability) {
      case 'oidc':
        return this.config.get('OIDC_ENABLED');
      case 'ai':
        return this.config.get('AI_ENABLED');
      case 'paperless':
        return this.config.get('PAPERLESS_ENABLED');
      case 'storage':
        return this.config.get('STORAGE_ENABLED');
      default:
        return false;
    }
  }

  snapshot(): Record<CapabilityKey, boolean> {
    return {
      oidc: this.isEnabled('oidc'),
      ai: this.isEnabled('ai'),
      paperless: this.isEnabled('paperless'),
      storage: this.isEnabled('storage'),
    };
  }
}
