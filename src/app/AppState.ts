import type { AnalysisResponse, AnalysisParameters, CandidateTable, ConfirmedDataset, ExtractionSettings } from "../models/Dataset.ts";

export interface SourceSession {
  fileName: string;
  sizeBytes: number;
  mimeType?: string;
  bytes: ArrayBuffer;
  settings: ExtractionSettings;
  kind: "file" | "google-sheet" | "manual";
  sourceUrl?: string;
}

export interface AppState {
  source: SourceSession | null;
  candidates: CandidateTable[];
  selectedCandidateIds: Set<string>;
  activeCandidate: CandidateTable | null;
  confirmedDataset: ConfirmedDataset | null;
  analysisParameters: AnalysisParameters | null;
  analysis: AnalysisResponse | null;
  error: string | null;
}

export const initialSettings: ExtractionSettings = {
  delimiter: "auto",
  skipEmptyLines: true,
  csvEncoding: "utf-8",
  pdfMaxPages: 200,
  pdfColumnTolerance: 10,
  ocrLanguage: "eng",
  ocrPageLimit: 200
};

export function createInitialState(): AppState {
  return { source: null, candidates: [], selectedCandidateIds: new Set(), activeCandidate: null, confirmedDataset: null, analysisParameters: null, analysis: null, error: null };
}
