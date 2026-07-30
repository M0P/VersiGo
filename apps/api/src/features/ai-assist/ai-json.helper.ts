/**
 * Gemeinsame JSON-Parsing-Logik fuer AI-Adapter-Antworten.
 *
 * Extrahiert JSON aus einem Rohtext (der zusaetzlichen Text enthalten kann),
 * trennt Felder von Konfidenzwerten und gibt ein strukturiertes Ergebnis
 * zurueck. Gibt null bei fehlgeschlagenem Parsing zurueck.
 *
 * Verwendet von OllamaAdapter und OpenAiCompatAdapter.
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
 * Bereitet ein Objekt fuer Prisma-JSON-Felder vor.
 * Stellt sicher, dass der Wert von Prisma akzeptiert wird.
 */
export function toPrismaJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
