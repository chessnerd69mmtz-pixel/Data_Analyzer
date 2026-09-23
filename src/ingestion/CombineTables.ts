import type { CandidateTable, DataValue } from "../models/Dataset.ts";
import { analyzeTableStructure } from "./TableStructure.ts";
import { makeId } from "../utils/ids.ts";

export function canCombine(candidates: CandidateTable[]): { ok: boolean; reason?: string } {
  if (candidates.length < 2) return { ok: false, reason: "Select at least two tables to combine." };
  const signatures = candidates.map((candidate) => candidate.columnNames.map((value) => value.trim().toLowerCase()).join("\u001f"));
  if (signatures.some((signature) => signature !== signatures[0])) return { ok: false, reason: "Tables can only be combined when their detected column names and order match exactly." };
  return { ok: true };
}

export function combineCandidates(candidates: CandidateTable[]): CandidateTable {
  const check = canCombine(candidates);
  if (!check.ok) throw new Error(check.reason);
  const first = candidates[0];
  const combinedRaw: DataValue[][] = [
    first.rawRows[first.detectedHeaderRow] ?? first.columnNames,
    ...candidates.flatMap((candidate) => candidate.rawRows.filter((_, index) => index !== candidate.detectedHeaderRow))
  ];
  const structure = analyzeTableStructure(combinedRaw);
  const id = makeId("combined_table");
  const log = candidates.flatMap((candidate) => candidate.extractionLog);
  log.push({ timestamp: new Date().toISOString(), stage: "ingestion", action: "TABLES_COMBINED", source: first.source.fileName, tool: "explicit-user-combine", tableId: id, location: candidates.map((candidate) => candidate.location).join("; "), reason: `Explicitly combined ${candidates.length} tables with matching column structures.` });
  return { id, source: first.source, confidence: candidates.some((candidate) => candidate.confidence === "Low") ? "Low" : candidates.some((candidate) => candidate.confidence === "Medium") ? "Medium" : "High", extractionTool: "Explicit combine of extracted tables", location: candidates.map((candidate) => candidate.location).join(" + "), rawRows: combinedRaw, detectedHeaderRow: structure.headerRow, columnNames: structure.headers, inferredTypes: structure.types, sanityFlags: structure.flags, extractionLog: log, settings: first.settings, sourceCandidateTableIds: candidates.flatMap((candidate) => candidate.sourceCandidateTableIds ?? [candidate.id]) };
}
