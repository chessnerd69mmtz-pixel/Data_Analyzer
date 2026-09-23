import type { DataValue, SanityFlag } from "../../models/Dataset.ts";
import { analyzeTableStructure } from "../TableStructure.ts";

interface WordLike { text?: string; confidence?: number; bbox?: { x0: number; y0: number; x1: number; y1: number }; }
function reconstructWords(words: WordLike[]): { rows: DataValue[][]; flags: SanityFlag[]; meanConfidence: number } {
  const usable = words.filter((word) => (word.text ?? "").trim() && word.bbox);
  if (usable.length === 0) return { rows: [], flags: [{ kind: "no-table", message: "OCR produced no words that could form a table.", severity: "error" }], meanConfidence: 0 };
  const meanConfidence = usable.reduce((sum, word) => sum + Number(word.confidence ?? 0), 0) / usable.length;
  const lines: Array<{ y: number; words: WordLike[] }> = [];
  for (const word of usable) { const y = Number(word.bbox!.y0); const current = lines.find((line) => Math.abs(line.y - y) <= 12); if (current) current.words.push(word); else lines.push({ y, words: [word] }); }
  const lineWords = lines.map((line) => line.words.sort((a, b) => a.bbox!.x0 - b.bbox!.x0)).filter((line) => line.length >= 2);
  if (lineWords.length < 3) return { rows: [], flags: [{ kind: "no-table", message: "OCR output did not contain at least three multi-column rows, so no table was inferred.", severity: "error" }], meanConfidence };
  const xs: number[] = [];
  for (const line of lineWords) for (const word of line) { const x = word.bbox!.x0; const hit = xs.findIndex((value) => Math.abs(value - x) <= 15); if (hit >= 0) xs[hit] = (xs[hit] + x) / 2; else xs.push(x); }
  const frequent = xs.filter((x) => lineWords.filter((line) => line.some((word) => Math.abs(word.bbox!.x0 - x) <= 15)).length >= Math.max(3, Math.ceil(lineWords.length * 0.4))).sort((a, b) => a - b);
  if (frequent.length < 2) return { rows: [], flags: [{ kind: "no-table", message: "OCR output did not show stable repeated column positions.", severity: "error" }], meanConfidence };
  const flags: SanityFlag[] = [];
  const rows = lineWords.map((line, rowIndex) => { const row: DataValue[] = Array(frequent.length).fill(null); for (const word of line) { let best = -1; let distance = Infinity; frequent.forEach((x, index) => { const d = Math.abs(x - word.bbox!.x0); if (d < distance) { distance = d; best = index; } }); if (best >= 0) { const existing = row[best] === null ? "" : `${String(row[best])} `; row[best] = `${existing}${(word.text ?? "").trim()}`; if (Number(word.confidence ?? 0) < 80) flags.push({ kind: "ocr-low-confidence", rowIndex, columnIndex: best, cell: word.text, message: `OCR confidence for this cell was ${Number(word.confidence ?? 0).toFixed(1)}. Verify against the original image.`, severity: "warning" }); } } return row; });
  return { rows, flags, meanConfidence };
}
export async function ocrImage(input: Blob | string, language = "eng"): Promise<{ rows: DataValue[][]; headers: string[]; types: ReturnType<typeof analyzeTableStructure>["types"]; flags: SanityFlag[]; meanConfidence: number }> {
  const { createWorker } = await import("tesseract.js"); const worker = await createWorker(language);
  try { const result = await worker.recognize(input); const reconstructed = reconstructWords((result.data as unknown as { words?: WordLike[] }).words ?? []); if (reconstructed.rows.length === 0) return { rows: [], headers: [], types: [], flags: reconstructed.flags, meanConfidence: reconstructed.meanConfidence }; const structure = analyzeTableStructure(reconstructed.rows); return { rows: reconstructed.rows, headers: structure.headers, types: structure.types, flags: [...structure.flags, ...reconstructed.flags], meanConfidence: reconstructed.meanConfidence }; } finally { await worker.terminate(); }
}
