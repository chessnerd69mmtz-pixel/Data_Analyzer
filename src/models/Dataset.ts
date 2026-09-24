export type DataValue = string | number | boolean | null | Date;
export type InferredType = "string" | "number" | "boolean" | "date";
export type Confidence = "High" | "Medium" | "Low";
export type SupportedFormat =
  | "csv" | "tsv" | "xlsx" | "xls" | "ods" | "json-records"
  | "docx" | "pdf-text" | "pdf-ocr" | "image-ocr" | "markdown-table" | "text-table" | "unknown";

export interface FileSource {
  fileName:string; extension:string; mimeType?:string; sizeBytes:number;
  detectedFormat:SupportedFormat; extensionFormat:SupportedFormat; detectionEvidence:string[];
}
export interface ColumnTypeInference { type:InferredType; confidence:"high"|"medium"|"low"; ambiguous:boolean; }
export interface SanityFlag {
  kind:"inconsistent-column-count"|"non-numeric-character"|"merged-or-split-cell"|"repeated-header"|"mixed-number-format"|"ambiguous-value"|"nested-value"|"extension-signature-mismatch"|"empty-table"|"no-table"|"ocr-low-confidence";
  rowIndex?:number; columnIndex?:number; cell?:string; message:string; severity:"warning"|"error";
}
export interface ExtractionSettings {
  delimiter:"auto"|","|"\t"|";"|"|"; skipEmptyLines:boolean; csvEncoding:"utf-8"|"utf-16le"|"latin1";
  selectedSheets?:string[]; pdfMaxPages?:number; pdfColumnTolerance?:number; ocrLanguage?:string; ocrPageLimit?:number;
}
export interface ExtractionLogEntry {
  timestamp?:string; stage:string; action:string; source:string; tool:string; tableId?:string; location?:string;
  affectedRows?:number[]; affectedColumns?:number[]; affectedCells?:string[]; oldValue?:string; newValue?:string; reason?:string;
}
export interface CandidateTable {
  id:string; source:FileSource; confidence:Confidence; extractionTool:string; location:string; rawRows:DataValue[][];
  detectedHeaderRow:number; columnNames:string[]; inferredTypes:ColumnTypeInference[]; sanityFlags:SanityFlag[];
  extractionLog:ExtractionLogEntry[]; settings:ExtractionSettings; sourceCandidateTableIds?:string[];
  extractionMetadata?:{pageCount?:number; ocrMeanConfidence?:number; textItemCount?:number};
}
export interface ManualEdit {
  timestamp?:string;
  action:"header-row-changed"|"column-renamed"|"column-type-changed"|"cell-edited"|"row-deleted"|"column-deleted";
  rowIndex?:number; columnIndex?:number; columnName?:string; oldValue?:string; newValue?:string; reason?:string;
}
export interface ConfirmedDataset {
  datasetId:string; sourceCandidateTableIds:string[]; source:FileSource; confidence:Confidence; extractionTool:string; location:string;
  headerRow:number; columns:{id:string;name:string;originalName:string;type:InferredType}[]; rows:DataValue[][];
  manualEdits:ManualEdit[]; sanityFlags:SanityFlag[]; extractionLog:ExtractionLogEntry[]; confirmed:true;
  confirmedAt:string; confirmationVersion:1;
}
export interface RowFilter { id:string; column:string; operator:"="|"!="|">"|">="|"<"|"<="|"contains"|"startsWith"|"endsWith"|"isBlank"|"isNotBlank"; value:string; }
export interface AnalysisParameters {
  targetColumn:string; groupingColumns:string[]; columnSelectionMode:"include"|"exclude"; selectedColumns:string[];
  rowFilters:RowFilter[]; confidenceLevel:0.9|0.95|0.99;
  analysisType:"correlation"|"group-comparison"|"trend"|"outliers"|"feature-importance"|"descriptive"|"normality"|"regression"|"clustering"|"anomaly-detection";
  missingDataHandling:"drop"|"mean"|"median"; timeColumn?:string;
  userFocusFactors?:string[];
  conclusionQuestion?:string;
  scanOtherFactors?:boolean;
  conclusionDepth?:"standard"|"deep"|"research";
  robustnessResamples?:number;
  responseFormat?:"bullets"|"paragraphs"|"both";
}
export interface PreparedDataSummary {
  inputRows:number; rowsAfterFilters:number; rowsRemovedByFilters:number; rowsRemovedForMissing:number; finalRows:number; columns:number;
  columnTypes:{name:string;type:InferredType;missing:number}[]; missingBeforeHandling:number; missingBeforeHandlingByColumn:{name:string;missing:number}[];
}
export interface AnalysisResult {
  resultId:string; inputDatasetId:string; analysisType:AnalysisParameters["analysisType"]; testUsed:string; targetColumn:string;
  comparisonColumns?:string[]; groupingColumn?:string; timeColumn?:string; n:number; statistic:number; statisticLabel:string;
  pValue:number; adjustedPValue?:number; effectSize:number; effectSizeLabel:string; confidenceLevel:number;
  confidenceInterval?:[number,number]; significant:boolean;
  direction?:"positive"|"negative"|"higher-first-group"|"lower-first-group"|"increasing"|"decreasing";
  groups?:{name:string;n:number;mean?:number;median?:number}[]; groupingLevel?:string|null;
  crossValidatedScore?:number; crossValidatedScoreLabel?:string; findingLabel?:string; caveats:string[];
  dataPoints?:Array<Record<string,string|number|null>>;
}
export interface EvidenceCheck {
  name:string; status:"pass"|"warning"|"fail"|"not-run"; detail:string; value?:number;
}
export interface ConclusionEvidence {
  factor:string;
  priority:"user-focus"|"discovered";
  conclusion:string;
  evidenceStrength:"very-strong"|"strong"|"moderate"|"weak"|"inconclusive";
  practicalImportance:"high"|"moderate"|"low"|"unknown";
  direction?:"positive"|"negative"|"mixed"|"nonlinear"|"higher-groups"|"lower-groups"|"none";
  tests:string[];
  checks:EvidenceCheck[];
  effectSize?:number;
  effectLabel?:string;
  confidenceInterval?:[number,number];
  adjustedPValue?:number;
  robustnessStability?:number;
  predictiveImportance?:number;
  caveats:string[];
  alternativeExplanations:string[];
  supportingResultIds:string[];
  validityScore:number;
  rank:number;
  sampleSize:number;
  targetColumn:string;
  factorType:string;
  derivationSteps:string[];
  selectionRationale:string;
}
export interface ConclusionResponse {
  question?:string;
  userFocusFactors:string[];
  discoveredFactors:string[];
  conclusions:ConclusionEvidence[];
  overallMessages:string[];
}
export interface AnalysisResponse {
  results:AnalysisResult[]; dataSummary:PreparedDataSummary; parameters:AnalysisParameters; messages:string[]; failedChecks:string[];
  multipleTesting:{applied:boolean;method:string;numberOfTests:number};
  conclusions?:ConclusionResponse;
  neuralEvidence?:{modelType:string;task:"regression"|"classification";score:number;scoreLabel:string;featureImportance:Record<string,number>;notes:string[]};
}
