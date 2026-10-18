/**
 * AI assist queue name for BullMQ.
 * Used both by the API feature (job creation) and
 * used by the worker processor (job processing).
 */
export const AI_EXTRACTION_QUEUE = 'ai-extraction';

/**
 * AP-24 (§3.1): hard limits for AI coverage summaries.
 *
 * The limits are enforced server-side *before* anything is sent to the
 * provider. Exceeding them is reported to the user instead of silently
 * dropping documents – a summary that quietly ignores half the contract is
 * worse than an error message.
 */
export const AI_SUMMARY_MAX_DOCUMENTS = 8;

/** Upper bound for the serialised document payload handed to the provider. */
export const AI_SUMMARY_MAX_CHARS = 20_000;

/**
 * AP-24 (§4.2): a cost extraction runs on exactly one document, so only a
 * single document payload is ever built.
 */
export const AI_COST_EXTRACTION_MAX_CHARS = 20_000;
