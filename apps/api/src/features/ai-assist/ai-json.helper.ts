/**
 * Shared JSON parsing logic for AI adapter responses.
 *
 * Extracts JSON from raw text (which may contain additional text),
 * separates fields from confidence values and returns a structured result
 * back. Returns null if parsing fails.
 *
 * Used by OllamaAdapter and OpenAiCompatAdapter.
 */
export function tryParseExtractionResponse(
  raw: string,
  model: string,
): { fields: Record<string, unknown>; confidence: Record<string, number>; model: string } | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : raw;

  try {
    const parsed = JSON.parse(jsonStr);

    const fields: Record<string, unknown> = {};
    const confidence: Record<string, number> = {};

    for (const [key, value] of Object.entries(parsed)) {
      if (key === 'confidence' && typeof value === 'object' && value !== null) {
        for (const [ck, cv] of Object.entries(value as Record<string, unknown>)) {
          confidence[ck] = typeof cv === 'number' ? cv : 0;
        }
      } else if (!key.startsWith('confidence')) {
        fields[key] = value;
      }
    }

    const hasConfidenceKey = Object.keys(parsed).some((k) => k === 'confidence');
    if (!hasConfidenceKey) {
      for (const key of Object.keys(fields)) {
        confidence[key] = 0.8;
      }
    }

    return { fields, confidence, model };
  } catch {
    return null;
  }
}

/**
 * Prepares an object for Prisma JSON fields.
 * Ensures the value is accepted by Prisma.
 */
export function toPrismaJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
