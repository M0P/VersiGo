'use client';

import { useCallback, useEffect, useState } from 'react';

import { getApiBaseUrl } from '@/lib/runtime-config';

const API_BASE = getApiBaseUrl();

/**
 * AP-25: key of the central AI data-transfer consent in the server-side
 * preference catalog (`user-preferences.service.ts`).
 */
export const AI_DATA_TRANSFER_CONSENT_KEY = 'ai:dataTransferConsent';

const CONSENT_URL = `${API_BASE}/user/preferences/${encodeURIComponent(AI_DATA_TRANSFER_CONSENT_KEY)}`;

/**
 * Reads and stores the user's central consent to transmit document contents
 * to the AI provider.
 *
 * The consent is a personal preference, so it applies to every AI action of
 * the user instead of having to be ticked again in each policy and each
 * view. It is stored on the server and therefore survives a reload and
 * applies on every device.
 *
 * While the preference is loading (or cannot be read) `acknowledged` stays
 * `false`: the warning is shown until consent is proven, never the other way
 * round.
 */
export function useAiDataTransferConsent(): {
  acknowledged: boolean;
  setAcknowledged: (value: boolean) => void;
} {
  const [acknowledged, setAcknowledgedState] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch(CONSENT_URL, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { value?: string } | null) => {
        if (!cancelled && data?.value === 'true') setAcknowledgedState(true);
      })
      .catch(() => {
        // Not stored yet (404) or unreachable: the warning stays visible.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const setAcknowledged = useCallback((value: boolean) => {
    setAcknowledgedState(value);

    // Persist in the background: a failed write only means the warning
    // reappears on the next visit, so it must not block the AI action.
    void fetch(CONSENT_URL, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: value ? 'true' : 'false' }),
    }).catch(() => undefined);
  }, []);

  return { acknowledged, setAcknowledged };
}
