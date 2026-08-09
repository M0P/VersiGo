import { describe, it, expect } from 'vitest';
import { NoOpAIAdapter } from '../noop-ai.adapter';

describe('NoOpAIAdapter', () => {
  const adapter = new NoOpAIAdapter();

  it('has providerKey "none"', () => {
    expect(adapter.providerKey).toBe('none');
  });

  it('extractContractFacts returns null', async () => {
    const result = await adapter.extractContractFacts(['test content'], 'policy-1');
    expect(result).toBeNull();
  });

  it('summarizeCoverage returns null', async () => {
    const result = await adapter.summarizeCoverage(['test content'], 'policy-1');
    expect(result).toBeNull();
  });

  it('healthCheck returns false', async () => {
    const result = await adapter.healthCheck();
    expect(result).toBe(false);
  });
});
