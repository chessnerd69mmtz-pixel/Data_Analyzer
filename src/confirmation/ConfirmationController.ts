import { runSanityChecks } from "../ingestion/SanityChecks.ts";
import { inferTypes } from "../ingestion/TypeInference.ts";
import type { CandidateTable, ConfirmedDataset, DataValue, ExtractionLogEntry, InferredType, ManualEdit, SanityFlag } from "../models/Dataset.ts";
import { makeId } from "../utils/ids.ts";
import { displayValue, parseTypedValue } from "../utils/values.ts";

export interface ConfirmationState {
  candidate: CandidateTable;
  headerRow: number;
  activeColumnIndices: number[];
  renamedColumns: Map<number, string>;
  declaredTypes: Map<number, InferredType>;
  deletedRowIndices: Set<number>;
  manualEdits: ManualEdit[];
  log: ExtractionLogEntry[];
  manualFlags: SanityFlag[];
}

export class ConfirmationController {
  private state: ConfirmationState;

  constructor(candidate: CandidateTable) {
    this.state = {
      candidate: structuredClone(candidate),
      headerRow: candidate.detectedHeaderRow,
      activeColumnIndices: Array.from({ length: this.maxColumnCount(candidate.rawRows) }, (_, i) => i),
      renamedColumns: new Map(),
      declaredTypes: new Map(candidate.inferredTypes.map((item, i) => [i, item.type])),
      deletedRowIndices: new Set(),
      manualEdits: [],
      log: [...candidate.extractionLog],
      manualFlags: []
    };
  }

  private maxColumnCount(rows: DataValue[][]): number { return rows.reduce((max, row) => Math.max(max, row.length), 0); }
  getState(): ConfirmationState { return this.state; }

  headers(): string[] {
    const header = this.state.candidate.rawRows[this.state.headerRow] ?? [];
    return this.state.activeColumnIndices.map((originalIndex, position) => this.state.renamedColumns.get(originalIndex) ?? (displayValue(header[originalIndex]).trim() || `Column ${position + 1}`));
  }

  types(): InferredType[] { return this.state.activeColumnIndices.map((index) => this.state.declaredTypes.get(index) ?? "string"); }

  previewIndices(): number[] {
    const data = Array.from({ length: this.state.candidate.rawRows.length }, (_, i) => i)
      .filter((i) => i !== this.state.headerRow && !this.state.deletedRowIndices.has(i));
    return [...data.slice(0, 20), ...data.slice(Math.max(20, data.length - 5))].filter((value, index, arr) => arr.indexOf(value) === index);
  }

  allVisibleRowIndices(): number[] {
    return Array.from({ length: this.state.candidate.rawRows.length }, (_, i) => i).filter((i) => !this.state.deletedRowIndices.has(i));
  }

  cellValue(rawRowIndex: number, originalColumnIndex: number): DataValue { return this.state.candidate.rawRows[rawRowIndex]?.[originalColumnIndex] ?? null; }

  setHeaderRow(rawIndex: number): void {
    if (!Number.isInteger(rawIndex) || rawIndex < 0 || rawIndex >= this.state.candidate.rawRows.length) throw new Error("Header row is outside the extracted rows.");
    if (this.state.deletedRowIndices.has(rawIndex)) throw new Error("The selected header row is marked for deletion.");
    const old = this.state.headerRow;
    this.state.headerRow = rawIndex;
    const dataRows = this.state.candidate.rawRows.filter((_, index) => index !== rawIndex && !this.state.deletedRowIndices.has(index));
    const nextTypes = inferTypes(dataRows, this.maxColumnCount(dataRows));
    nextTypes.forEach((type, index) => {
      if (!this.state.manualEdits.some((edit) => edit.action === "column-type-changed" && edit.columnIndex === index)) this.state.declaredTypes.set(index, type.type);
    });
    this.state.log.push({ timestamp: new Date().toISOString(), stage: "manual-edit", action: "HEADER_ROW_CHANGED", source: this.state.candidate.source.fileName, tool: this.state.candidate.extractionTool, tableId: this.state.candidate.id, affectedRows: [rawIndex], reason: `Header row changed from extracted row ${old + 1} to extracted row ${rawIndex + 1}.` });
    this.state.manualEdits.push({ timestamp: new Date().toISOString(), action: "header-row-changed", rowIndex: rawIndex, oldValue: String(old + 1), newValue: String(rawIndex + 1) });
  }

  renameColumn(originalIndex: number, newName: string): void {
    const clean = newName.trim();
    if (!clean) throw new Error("Column names cannot be blank.");
    const position = this.state.activeColumnIndices.indexOf(originalIndex);
    const old = this.headers()[position] ?? `Column ${position + 1}`;
    this.state.renamedColumns.set(originalIndex, clean);
    this.state.manualEdits.push({ timestamp: new Date().toISOString(), action: "column-renamed", columnIndex: originalIndex, columnName: clean, oldValue: old, newValue: clean });
    this.record({ action: "COLUMN_RENAMED", affectedColumns: [originalIndex], oldValue: old, newValue: clean });
  }

  changeType(originalIndex: number, type: InferredType): void {
    const old = this.state.declaredTypes.get(originalIndex) ?? "string";
    this.state.declaredTypes.set(originalIndex, type);
    this.state.manualEdits.push({ timestamp: new Date().toISOString(), action: "column-type-changed", columnIndex: originalIndex, oldValue: old, newValue: type });
    this.record({ action: "COLUMN_TYPE_CHANGED", affectedColumns: [originalIndex], oldValue: old, newValue: type });
  }

  editCell(rawRowIndex: number, originalColumnIndex: number, newRawValue: string): void {
    const row = this.state.candidate.rawRows[rawRowIndex];
    if (!row) throw new Error("Row not found.");
    const type = this.state.declaredTypes.get(originalColumnIndex) ?? "string";
    const oldValue = displayValue(row[originalColumnIndex]);
    const parsed = type === "string" ? newRawValue : parseTypedValue(newRawValue, type);
    row[originalColumnIndex] = parsed;
    if (type !== "string" && newRawValue.trim() !== "" && parsed === null) this.state.manualFlags.push({ kind: "ambiguous-value", rowIndex: rawRowIndex, columnIndex: originalColumnIndex, cell: newRawValue, message: `Manual conversion of row ${rawRowIndex + 1}, column ${originalColumnIndex + 1} as ${type} failed; the value is missing.`, severity: "warning" });
    const stored = displayValue(parsed);
    this.state.manualEdits.push({ timestamp: new Date().toISOString(), action: "cell-edited", rowIndex: rawRowIndex, columnIndex: originalColumnIndex, oldValue, newValue: stored });
    this.record({ action: "CELL_EDITED", affectedCells: [`R${rawRowIndex + 1}C${originalColumnIndex + 1}`], oldValue, newValue: stored });
  }

  deleteRow(rawRowIndex: number): void {
    if (rawRowIndex === this.state.headerRow) throw new Error("The header row cannot be deleted. Change the header row first.");
    if (rawRowIndex < 0 || rawRowIndex >= this.state.candidate.rawRows.length) throw new Error("Row not found.");
    if (this.state.deletedRowIndices.has(rawRowIndex)) return;
    this.state.deletedRowIndices.add(rawRowIndex);
    this.state.manualEdits.push({ timestamp: new Date().toISOString(), action: "row-deleted", rowIndex: rawRowIndex });
    this.record({ action: "ROW_DELETED", affectedRows: [rawRowIndex] });
  }

  deleteColumn(originalIndex: number): void {
    if (!this.state.activeColumnIndices.includes(originalIndex)) return;
    if (this.state.activeColumnIndices.length === 1) throw new Error("At least one column must remain.");
    const position = this.state.activeColumnIndices.indexOf(originalIndex);
    const oldName = this.headers()[position] ?? `Column ${position + 1}`;
    this.state.activeColumnIndices = this.state.activeColumnIndices.filter((index) => index !== originalIndex);
    this.state.manualEdits.push({ timestamp: new Date().toISOString(), action: "column-deleted", columnIndex: originalIndex, columnName: oldName });
    this.record({ action: "COLUMN_DELETED", affectedColumns: [originalIndex], reason: oldName });
  }

  currentFlags(): SanityFlag[] {
    const data = this.allVisibleRowIndices().filter((index) => index !== this.state.headerRow);
    const activeRows = data.map((rawIndex) => this.state.activeColumnIndices.map((index) => this.state.candidate.rawRows[rawIndex]?.[index] ?? null));
    const recalculated = runSanityChecks(activeRows, this.headers(), this.types()).map((flag) => ({ ...flag, rowIndex: flag.rowIndex === undefined ? undefined : data[flag.rowIndex] }));
    const filteredBase = this.state.candidate.sanityFlags.filter((flag) => {
      if (flag.columnIndex !== undefined && !this.state.activeColumnIndices.includes(flag.columnIndex)) return false;
      if (flag.rowIndex !== undefined && this.state.deletedRowIndices.has(data[flag.rowIndex] ?? -1)) return false;
      return true;
    });
    const combined = [...filteredBase, ...recalculated, ...this.state.manualFlags];
    return combined.filter((flag, index, array) => array.findIndex((other) => other.kind === flag.kind && other.rowIndex === flag.rowIndex && other.columnIndex === flag.columnIndex && other.message === flag.message) === index);
  }

  confirm(): ConfirmedDataset {
    const flags = this.currentFlags();
    const blocking = flags.filter((flag) => flag.severity === "error");
    if (blocking.length) throw new Error(`Resolve the ${blocking.length} blocking extraction/data issue${blocking.length === 1 ? "" : "s"} before confirmation.`);
    const headers = this.headers();
    const types = this.types();
    if (headers.length !== types.length) throw new Error("Column metadata is inconsistent; refresh the preview before confirming.");
    if (!headers.length) throw new Error("At least one active column is required.");
    if (headers.some((header) => !header.trim())) throw new Error("Every active column must have a non-empty name.");
    if (new Set(headers.map((header) => header.trim().toLowerCase())).size !== headers.length) throw new Error("Column names must be unique before confirmation.");
    const rows = this.allVisibleRowIndices().filter((index) => index !== this.state.headerRow).map((rowIndex) => this.state.activeColumnIndices.map((columnIndex) => this.state.candidate.rawRows[rowIndex]?.[columnIndex] ?? null));
    if (!rows.length) throw new Error("There are no data rows to confirm.");
    const confirmedLog = [...this.state.log, { timestamp: new Date().toISOString(), stage: "confirmation", action: "CONFIRMED", source: this.state.candidate.source.fileName, tool: this.state.candidate.extractionTool, tableId: this.state.candidate.id, location: this.state.candidate.location, reason: `Confirmed ${rows.length} rows x ${headers.length} columns.` }];
    return {
      datasetId: makeId("dataset"),
      sourceCandidateTableIds: this.state.candidate.sourceCandidateTableIds ?? [this.state.candidate.id],
      source: this.state.candidate.source,
      confidence: this.state.candidate.confidence,
      extractionTool: this.state.candidate.extractionTool,
      location: this.state.candidate.location,
      headerRow: this.state.headerRow,
      columns: headers.map((name, position) => ({ id: `column_${position + 1}`, name, originalName: displayValue((this.state.candidate.rawRows[this.state.headerRow] ?? [])[this.state.activeColumnIndices[position]]) || name, type: types[position] })),
      rows,
      manualEdits: [...this.state.manualEdits],
      sanityFlags: flags.map((flag) => ({ ...flag })),
      extractionLog: confirmedLog,
      confirmed: true,
      confirmedAt: new Date().toISOString(),
      confirmationVersion: 1
    };
  }

  private record(input: Omit<ExtractionLogEntry, "timestamp" | "source" | "tool" | "tableId" | "stage">): void {
    this.state.log.push({ timestamp: new Date().toISOString(), stage: "manual-edit", source: this.state.candidate.source.fileName, tool: this.state.candidate.extractionTool, tableId: this.state.candidate.id, ...input });
  }
}
