import type { DataValue, SanityFlag } from "../../models/Dataset.ts";
import { analyzeTableStructure } from "../TableStructure.ts";

function splitPipe(line: string): string[] {
  const stripped = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (let i = 0; i < stripped.length; i += 1) {
    const ch = stripped[i];
    if (escaped) { current += ch; escaped = false; continue; }
    if (ch === "\\") { escaped = true; current += ch; continue; }
    if (ch === "|") { cells.push(current.trim()); current = ""; } else current += ch;
  }
  cells.push(current.trim());
  return cells;
}

export function parseMarkdownTables(text: string): Array<{ name: string; rawRows: DataValue[][]; headers: string[]; types: ReturnType<typeof analyzeTableStructure>["types"]; flags: SanityFlag[] }> {
  const lines = text.split(/\r?\n/);
  const tables: Array<{ name: string; rawRows: DataValue[][]; headers: string[]; types: ReturnType<typeof analyzeTableStructure>["types"]; flags: SanityFlag[] }> = [];
  let tableNumber = 0;
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (!lines[i].includes("|") || !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1])) continue;
    const rows: DataValue[][] = [splitPipe(lines[i])];
    i += 1;
    while (i + 1 < lines.length && lines[i + 1].includes("|")) { i += 1; rows.push(splitPipe(lines[i])); }
    tableNumber += 1;
    const structure = analyzeTableStructure(rows);
    tables.push({ name: `Markdown table ${tableNumber}`, rawRows: rows, headers: structure.headers, types: structure.types, flags: structure.flags });
  }
  return tables;
}
