/**
 * Normalizes Unicode tag text to NFC, lowercases letters and converts spaces
 * or underscores to hyphens. Invalid symbols remain for schema validation,
 * rather than being silently removed.
 */
export function normalizeTag(value: string) {
  return value
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/gu, "-")
    .replace(/-+/g, "-");
}

export function normalizeTags(values: readonly string[]) {
  return Array.from(new Set(values.map(normalizeTag).filter(Boolean)));
}
