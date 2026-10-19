import { describe, it, expect, vi } from 'vitest';
import {
  AI_MAX_INPUT_TOKENS_DEFAULT,
  AI_MAX_INPUT_TOKENS_UNLIMITED,
  CHARS_PER_APPROX_TOKEN,
  INPUT_TOKEN_TRUNCATION_MARKER,
  approxTokenCount,
  applyInputTokenBudget,
  applyInputTokenBudgetWithLog,
} from '../input-token-budget';

describe('input-token-budget', () => {
  describe('approxTokenCount', () => {
    it('counts an empty text as zero tokens', () => {
      expect(approxTokenCount('')).toBe(0);
    });

    it('uses the documented characters-per-token approximation', () => {
      expect(CHARS_PER_APPROX_TOKEN).toBeGreaterThan(0);
      expect(approxTokenCount('a'.repeat(CHARS_PER_APPROX_TOKEN))).toBe(1);
      expect(approxTokenCount('a'.repeat(CHARS_PER_APPROX_TOKEN + 1))).toBe(2);
    });

    it('rounds up, so a budget is never overshot', () => {
      expect(approxTokenCount('abc')).toBe(1);
    });

    it('tolerates a missing value instead of throwing', () => {
      expect(approxTokenCount(undefined as unknown as string)).toBe(0);
      expect(approxTokenCount(null as unknown as string)).toBe(0);
    });
  });

  describe('applyInputTokenBudget – unlimited', () => {
    it('keeps the documents untouched when the limit is 0 (unbegrenzt)', () => {
      const contents = ['x'.repeat(100_000)];
      const result = applyInputTokenBudget(contents, AI_MAX_INPUT_TOKENS_UNLIMITED);

      expect(result.contents).toEqual(contents);
      expect(result.truncated).toBe(false);
    });

    it('keeps the documents untouched for a non-positive limit', () => {
      const contents = ['short'];
      expect(applyInputTokenBudget(contents, -5).contents).toEqual(contents);
      expect(applyInputTokenBudget(contents, -5).truncated).toBe(false);
    });

    it('keeps the documents untouched for a non-finite limit', () => {
      const contents = ['short'];
      const result = applyInputTokenBudget(contents, Number.NaN);
      expect(result.contents).toEqual(contents);
      expect(result.truncated).toBe(false);
    });

    it('uses the documented default of 4096 tokens', () => {
      expect(AI_MAX_INPUT_TOKENS_DEFAULT).toBe(4096);
    });
  });

  describe('applyInputTokenBudget – within budget', () => {
    it('leaves documents that fit untouched', () => {
      const contents = ['kurz', 'auch kurz'];
      const result = applyInputTokenBudget(contents, 1000);

      expect(result.contents).toEqual(contents);
      expect(result.truncated).toBe(false);
      expect(result.truncatedDocuments).toBe(0);
    });

    it('leaves an empty list untouched', () => {
      const result = applyInputTokenBudget([], 100);
      expect(result.contents).toEqual([]);
      expect(result.truncated).toBe(false);
    });
  });

  describe('applyInputTokenBudget – truncation', () => {
    it('never exceeds the character budget implied by the token limit', () => {
      const contents = ['w'.repeat(10_000)];
      const limit = 100;
      const result = applyInputTokenBudget(contents, limit);

      expect(result.truncated).toBe(true);
      expect(result.contents[0].length).toBeLessThanOrEqual(limit * CHARS_PER_APPROX_TOKEN);
    });

    it('marks the truncation instead of silently cutting content', () => {
      const contents = ['wort '.repeat(5000)];
      const result = applyInputTokenBudget(contents, 64);

      expect(result.contents[0]).toContain(INPUT_TOKEN_TRUNCATION_MARKER);
    });

    it('cuts at a word boundary when one is available', () => {
      const contents = ['abc def ghi jkl mno pqr stu vwx yz'];
      const result = applyInputTokenBudget(contents, 4);

      // 4 tokens = 16 characters; the marker makes the exact cut depend on
      // the budget, but the kept prefix must never end inside a word when a
      // boundary was available before it.
      expect(result.contents[0]).toMatch(/^(abc def ghi jkl)/);
    });

    it('distributes the budget across several documents', () => {
      const contents = ['a'.repeat(400), 'b'.repeat(400)];
      const result = applyInputTokenBudget(contents, 100);

      expect(result.truncatedDocuments).toBe(2);
      for (const text of result.contents) {
        expect(text.length).toBeLessThanOrEqual(100 * CHARS_PER_APPROX_TOKEN);
      }
    });

    it('hands unused budget of short documents to the remaining ones', () => {
      const contents = ['kurz', 'x'.repeat(4000)];
      const result = applyInputTokenBudget(contents, 100);

      // The tiny first document consumes almost nothing, so the second one
      // may use nearly the whole budget instead of exactly half of it.
      expect(result.contents[0]).toBe('kurz');
      expect(result.truncatedDocuments).toBe(1);
      expect(result.contents[1].length).toBeGreaterThan(90 * CHARS_PER_APPROX_TOKEN);
      expect(result.contents[1].length).toBeLessThanOrEqual(100 * CHARS_PER_APPROX_TOKEN);
    });

    it('hands the budget a shortened document did not need on to the next one', () => {
      const maxTokens = 1000;
      // The first document is cut at its only word boundary (after 1000
      // characters), so it costs clearly less than its reserved half of the
      // budget. That remainder has to reach the second document: it fits into
      // what is left and therefore has to stay completely untouched.
      const first = `${'x'.repeat(1000)} ${'y'.repeat(2000)}`;
      const second = 'z'.repeat(2500);

      const result = applyInputTokenBudget([first, second], maxTokens);

      expect(result.truncatedDocuments).toBe(1);
      expect(result.contents[1]).toBe(second);
      // The shortened document is still marked as shortened ...
      expect(result.contents[0]).toContain(INPUT_TOKEN_TRUNCATION_MARKER);
      // ... and the applied budget is never exceeded by the result.
      const applied = result.contents.reduce((sum, text) => sum + approxTokenCount(text), 0);
      expect(applied).toBeLessThanOrEqual(maxTokens);
    });

    it('counts the documents in the result', () => {
      const result = applyInputTokenBudget(['a'.repeat(4000)], 10);
      expect(result.truncatedDocuments).toBe(1);
      expect(result.totalTokens).toBeGreaterThan(0);
    });
  });

  describe('applyInputTokenBudgetWithLog', () => {
    it('returns the documents without warning when nothing was cut', () => {
      const logger = { warn: vi.fn() };
      const contents = ['kurz'];

      expect(applyInputTokenBudgetWithLog(contents, 1000, logger)).toEqual(contents);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('reports a shortening instead of cutting silently', () => {
      const logger = { warn: vi.fn() };
      const result = applyInputTokenBudgetWithLog(['x'.repeat(4000)], 10, logger);

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(String(logger.warn.mock.calls[0][0])).toContain('AI_MAX_INPUT_TOKENS');
      expect(result[0].length).toBeLessThan(4000);
    });

    it('does not warn for the unlimited setting', () => {
      const logger = { warn: vi.fn() };
      const contents = ['x'.repeat(4000)];

      expect(applyInputTokenBudgetWithLog(contents, 0, logger)).toEqual(contents);
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});
