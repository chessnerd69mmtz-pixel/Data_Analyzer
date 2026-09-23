import type { CandidateTable, ExtractionLogEntry, ExtractionSettings, FileSource } from "./Dataset.ts";

export interface ExtractionRequest {
  fileName: string;
  fileSize: number;
  mimeType?: string;
  bytes: ArrayBuffer;
  settings: ExtractionSettings;
}

export interface ExtractionResponse {
  source: FileSource;
  candidates: CandidateTable[];
  extractionLog: ExtractionLogEntry[];
}

export interface WorkerSuccess<T> {
  ok: true;
  response: T;
}

export interface WorkerFailure {
  ok: false;
  error: string;
}
