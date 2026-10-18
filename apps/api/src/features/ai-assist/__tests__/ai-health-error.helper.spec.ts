import { describe, it, expect } from 'vitest';
import { AxiosError } from 'axios';
import { classifyAiHealthError } from '../ai-health-error.helper';

/**
 * BugFix-22: the reason codes are shown verbatim in the admin UI and the
 * policy detail page, so they must stay coarse and secret-free.
 */
describe('classifyAiHealthError', () => {
  it('maps axios timeouts to "timeout"', () => {
    const err = new AxiosError('timeout of 5000ms exceeded', 'ECONNABORTED');
    expect(classifyAiHealthError(err)).toBe('timeout');
  });

  it('maps connection timeouts to "timeout"', () => {
    const err = new AxiosError('connect ETIMEDOUT', 'ETIMEDOUT');
    expect(classifyAiHealthError(err)).toBe('timeout');
  });

  it('maps canceled requests to "timeout"', () => {
    const err = new AxiosError('canceled', 'ERR_CANCELED');
    expect(classifyAiHealthError(err)).toBe('timeout');
  });

  it('maps HTTP 401/403 responses to "unauthorized"', () => {
    for (const status of [401, 403]) {
      const err = new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
        status,
      } as never);
      expect(classifyAiHealthError(err)).toBe('unauthorized');
    }
  });

  it('maps other response statuses to "http-error"', () => {
    const err = new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
      status: 500,
    } as never);
    expect(classifyAiHealthError(err)).toBe('http-error');
  });

  it('maps connection-level failures to "unreachable"', () => {
    const err = new AxiosError('connect ECONNREFUSED', 'ECONNREFUSED');
    expect(classifyAiHealthError(err)).toBe('unreachable');
  });

  it('maps DNS failures to "unreachable"', () => {
    const err = new AxiosError('getaddrinfo ENOTFOUND', 'ENOTFOUND');
    expect(classifyAiHealthError(err)).toBe('unreachable');
  });

  it('maps plain errors to "unreachable"', () => {
    expect(classifyAiHealthError(new Error('boom'))).toBe('unreachable');
    expect(classifyAiHealthError('not an error')).toBe('unreachable');
  });
});
