import type { AnalysisResponse, ConfirmedDataset, ExtractionLogEntry } from "../models/Dataset.ts";

export interface ReportContext {
  dataset: ConfirmedDataset;
  analysis: AnalysisResponse;
  extractionLog: ExtractionLogEntry[];
  chartImages: Record<string, string>;
}

export interface ReportModel {
  sections: {
    parameters: string;
    extraction: string;
    summary: string;
    findings: string;
    nonSignificant: string;
    limitations: string;
  };
  chartImages: Record<string, string>;
  numericProvenance: number[];
}
