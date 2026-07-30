import { describe, it, expect } from 'vitest';
import { NoOpAIAdapter } from '../noop-ai.adapter';

describe('NoOpAIAdapter', () => {
  const adapter = new NoOpAIAdapter();

  it('hat providerKey "none"', () => {
    expect(adapter.providerKey).toBe('none');
  });

  it('extractContractFacts gibt null zurueck', async () => {
    const result = await adapter.extractContractFacts(['test content'], 'policy-1');
    expect(result).toBeNull();
  });

  it('summarizeCoverage gibt null zurueck', async () => {
    const result = await adapter.summarizeCoverage(['test content'], 'policy-1');
    expect(result).toBeNull();
  });

  it('healthCheck gibt false zurueck', async () => {
    const result = await adapter.healthCheck();
    expect(result).toBe(false);
  });
});
