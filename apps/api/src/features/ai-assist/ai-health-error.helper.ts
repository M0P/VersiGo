import { AxiosError } from 'axios';
import type { AiHealthReason } from '@versigo/foundation';

/**
 * Maps a transport error of an AI health probe to a coarse, secret-free
 * reason (BugFix-22).
 *
 * The values are shown verbatim in the admin UI and the policy detail
 * page, so they must never contain URLs, hostnames, credentials or
 * response bodies. `AI_TIMEOUT_CODES` deliberately includes axios'
 * `ERR_CANCELED`, which is also raised when the probe timeout fires.
 */
export function classifyAiHealthError(err: unknown): AiHealthReason {
  const code =
    err instanceof Error && 'code' in err
      ? String((err as { code?: unknown }).code)
      : undefined;

  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ERR_CANCELED') {
    return 'timeout';
  }
  if (err instanceof AxiosError) {
    const status = err.response?.status;
    if (status === 401 || status === 403) return 'unauthorized';
    if (status !== undefined) return 'http-error';
  }
  return 'unreachable';
}
