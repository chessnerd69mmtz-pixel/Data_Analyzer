function numericTokens(text: string): string[] {
  return text.match(/(?<![A-Za-z_])[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?%?/g) ?? [];
}

function canonical(token: string): string {
  return token.endsWith("%") ? token.slice(0, -1) : token;
}

export function extractNumericTokens(text: string): string[] { return numericTokens(text).map(canonical); }

export function validateReportNumbers(text: string, approvedNumbers: number[]): { ok: boolean; missing: string[] } {
  const approved = new Set(approvedNumbers.map((value) => String(value)));
  const missing: string[] = [];
  for (const token of numericTokens(text).map(canonical)) {
    const numeric = Number(token);
    if (!Number.isFinite(numeric)) continue;
    const normalizedVariants = new Set([String(numeric), token, numeric.toFixed(3).replace(/0+$/, "").replace(/\.$/, ""), numeric.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")]);
    if (![...normalizedVariants].some((value) => approved.has(value))) missing.push(token);
  }
  return { ok: missing.length === 0, missing: [...new Set(missing)] };
}
