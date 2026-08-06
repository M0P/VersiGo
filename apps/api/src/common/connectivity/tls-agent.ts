import * as https from 'node:https';
import type { SettingsResolverService } from '@versigo/foundation';

/**
 * BugFix-06 (Teil 2): Opt-in-TLS-Lockerung fuer AI-/OIDC-Runtime-Aufrufe.
 *
 * Liefert einen HTTPS-Agent mit deaktivierter Zertifikatsvalidierung, wenn
 * die Admin-Einstellung `CONNECTIVITY_ALLOW_SELF_SIGNED` aktiv ist. Die
 * Lockerung gilt damit ausschliesslich fuer die konfigurierten AI-Endpunkte
 * (Ollama / OpenAI-kompatibel), niemals global. Ein Aufloesungsfehler
 * degradiert sicher auf den strikten Default (kein relaxed Agent).
 */
export async function optionalRelaxedHttpsAgent(
  settings: SettingsResolverService,
): Promise<{ httpsAgent?: https.Agent }> {
  let allowSelfSigned = false;
  try {
    allowSelfSigned =
      (await settings.getEffectiveBoolean('CONNECTIVITY_ALLOW_SELF_SIGNED')) ?? false;
  } catch {
    allowSelfSigned = false;
  }
  if (!allowSelfSigned) return {};
  return { httpsAgent: new https.Agent({ rejectUnauthorized: false }) };
}
