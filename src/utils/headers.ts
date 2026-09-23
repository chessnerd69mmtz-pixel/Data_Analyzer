export function normalizeHeaderName(value: string, index: number): string {
  const trimmed = value.trim();
  return trimmed || `Column ${index + 1}`;
}

export function hasDuplicateHeaders(headers: string[]): boolean {
  const seen = new Set<string>();
  for (const header of headers) {
    const key = header.trim().toLowerCase();
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}
