/**
 * AP-25: central budget for the tokens a single AI call may receive as input.
 *
 * Why a budget at all: a document that exceeds the model's context window is
 * rejected by the provider with an opaque error, which surfaces to the user as
 * "the configured provider does not answer". A configured ceiling turns that
 * into a deterministic, explainable outcome.
 *
 * Why an approximation and no tokenizer: Insura talks to OpenAI-compatible
 * gateways AND to local Ollama models. Every tokenizer differs, so no exact
 * count exists for the configured provider. `≈4 characters per token` is the
 * established rule of thumb for Latin-script text; it is deliberately
 * documented as an approximation instead of pretending to be exact. The
 * setting is therefore named `AI_MAX_INPUT_TOKENS` and described in the admin
 * UI as an approximation.
 *
 * The budget is spent across ALL documents of one call (fair share with
 * redistribution), because cutting every document to the same fixed size would
 * discard content from short documents that never threatened the limit.
 */

/**
 * Documented approximation: one token covers roughly this many characters.
 *
 * Calibrated for Latin-script text. Scripts without spaces (CJK) need clearly
 * more tokens per character, so for such documents the configured limit is
 * effectively tighter than the user expects – the approximation is therefore
 * described as such in the admin UI and is not a safety promise.
 */
export const CHARS_PER_APPROX_TOKEN = 4;

/** Default input budget in tokens; 0 disables the limit entirely. */
export const AI_MAX_INPUT_TOKENS_DEFAULT = 4096;

/** `0` means "unbegrenzt" – the model's own context window applies. */
export const AI_MAX_INPUT_TOKENS_UNLIMITED = 0;

/** Upper bound of the admin UI/validation; large enough for 1M-context models. */
export const AI_MAX_INPUT_TOKENS_MAX = 1_000_000;

/**
 * Appended to a truncated document so the model knows content is missing and
 * can report it as a hint instead of inventing the rest. App-generated text,
 * written in German because the prompts and their output are German.
 */
export const INPUT_TOKEN_TRUNCATION_MARKER =
  '\n\n[...] Dokument gekuerzt: das konfigurierte Token-Limit ist erreicht.';

export interface InputTokenBudgetResult {
  /** The (possibly shortened) documents in their original order. */
  contents: string[];
  /** True as soon as one document had to be shortened. */
  truncated: boolean;
  /** How many documents were shortened (for logging). */
  truncatedDocuments: number;
  /** Approximate token count of the ORIGINAL documents. */
  totalTokens: number;
}

/** Approximate token count of a text; never throws on malformed input. */
export function approxTokenCount(text: string): number {
  if (typeof text !== 'string' || text.length === 0) return 0;
  return Math.ceil(text.length / CHARS_PER_APPROX_TOKEN);
}

/**
 * Cuts at the last whitespace before the limit so the model does not receive
 * half a word. Falls back to a hard cut when no usable boundary exists.
 */
function cutAtWordBoundary(text: string, charLimit: number): string {
  if (text.length <= charLimit) return text;
  const head = text.slice(0, charLimit);
  const boundary = Math.max(head.lastIndexOf(' '), head.lastIndexOf('\n'));
  // A boundary very close to the start would throw away the budget that the
  // caller reserved; in that case the hard cut is the lesser evil.
  return boundary > charLimit / 2 ? text.slice(0, boundary) : head;
}

function truncateToChars(text: string, charLimit: number): string {
  if (text.length <= charLimit) return text;

  const markerBudget = charLimit - INPUT_TOKEN_TRUNCATION_MARKER.length;
  // Absurdly small budgets (a misconfigured limit in the low single digits)
  // cannot hold a readable prefix plus the marker; the hard limit wins.
  if (markerBudget < 20) return text.slice(0, charLimit);

  return cutAtWordBoundary(text, markerBudget) + INPUT_TOKEN_TRUNCATION_MARKER;
}

/**
 * Applies the input token budget to the documents of ONE AI call.
 *
 * `maxTokens <= 0` (and any non-finite value) means unlimited: the documents
 * are returned untouched, so the "0 = unbegrenzt" admin setting cannot
 * accidentally truncate content.
 *
 * Guarantee: the returned documents never exceed `maxTokens` (measured with
 * `approxTokenCount`). Within that ceiling the budget is used as fully as
 * possible – a document that stays below its share gives the remainder to the
 * following ones, and a shortened document is charged only what it really
 * costs, not its reserved share.
 */
export function applyInputTokenBudget(
  contents: string[],
  maxTokens: number,
): InputTokenBudgetResult {
  const list = Array.isArray(contents) ? contents : [];
  const totalTokens = list.reduce((sum, text) => sum + approxTokenCount(text), 0);

  const unlimited = !Number.isFinite(maxTokens) || maxTokens <= 0;
  if (unlimited || totalTokens <= maxTokens) {
    return { contents: list, truncated: false, truncatedDocuments: 0, totalTokens };
  }

  const result: string[] = [];
  let remainingTokens = maxTokens;
  let truncatedDocuments = 0;

  for (let index = 0; index < list.length; index += 1) {
    const remainingDocuments = list.length - index;
    const quota = Math.floor(remainingTokens / remainingDocuments);
    const text = list[index];
    const used = approxTokenCount(text);

    if (used <= quota) {
      result.push(text);
      remainingTokens -= used;
      continue;
    }

    const shortened = truncateToChars(text, quota * CHARS_PER_APPROX_TOKEN);
    result.push(shortened);
    // Charge what the shortened text really costs instead of the reserved
    // quota: a cut at a word boundary gives part of the quota back, and the
    // documents after this one may use that remainder instead of losing it.
    remainingTokens -= approxTokenCount(shortened);
    truncatedDocuments += 1;
  }

  return { contents: result, truncated: truncatedDocuments > 0, truncatedDocuments, totalTokens };
}

/** Minimal logger contract; satisfied by every NestJS/Nest-style logger. */
export interface TokenBudgetLogger {
  warn(message: string): void;
}

/**
 * Applies the budget and reports a shortening through the caller's logger.
 *
 * Shared by all four adapters (API and worker, Ollama and OpenAI-compatible)
 * so the wording of the warning and the applied policy cannot drift apart.
 * A silent truncation would look like a documentation that simply says less.
 */
export function applyInputTokenBudgetWithLog(
  contents: string[],
  maxTokens: number,
  logger: TokenBudgetLogger,
): string[] {
  const result = applyInputTokenBudget(contents, maxTokens);
  if (result.truncated) {
    logger.warn(
      `AI input truncated: ${result.truncatedDocuments} document(s) exceed the configured budget of ` +
        `${maxTokens} tokens (approx. ${result.totalTokens} tokens supplied). ` +
        `Raise AI_MAX_INPUT_TOKENS or select fewer/smaller documents.`,
    );
  }
  return result.contents;
}
