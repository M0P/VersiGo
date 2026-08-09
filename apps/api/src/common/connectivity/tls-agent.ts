import * as https from 'node:https';
import type { SettingsResolverService } from '@versigo/foundation';

/**
 * BugFix-06 (part 2): opt-in TLS relaxation for AI/OIDC runtime calls.
 *
 * Returns an HTTPS agent with certificate validation disabled when
 * the admin setting `CONNECTIVITY_ALLOW_SELF_SIGNED` is active. The
 * relaxation therefore applies only to the configured AI endpoints
 * (Ollama / OpenAI-compatible), never globally. A resolution error
 * degrades safely to the strict default (no relaxed agent).
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
