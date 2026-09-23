import type { AnalysisParameters, ConfirmedDataset } from "../models/Dataset.ts";

export function validateAnalysisParameters(dataset: ConfirmedDataset, parameters: AnalysisParameters): string[] {
  const names = new Set(dataset.columns.map((column) => column.name));
  const errors: string[] = [];
  if (!names.has(parameters.targetColumn)) errors.push("Choose a valid target column.");
  parameters.groupingColumns.forEach((name) => { if (!names.has(name)) errors.push(`Grouping column ${name} is not present.`); });
  parameters.selectedColumns.forEach((name) => { if (!names.has(name)) errors.push(`Selected column ${name} is not present.`); });
  parameters.rowFilters.forEach((filter) => { if (!names.has(filter.column)) errors.push(`Filter column ${filter.column} is not present.`); });
  if (parameters.analysisType === "trend" && !parameters.timeColumn) errors.push("Choose a time column for trend analysis.");
  if (parameters.timeColumn && !names.has(parameters.timeColumn)) errors.push("Choose a valid time column.");
  if (["group-comparison", "trend", "outliers"].includes(parameters.analysisType) && parameters.groupingColumns.length > 1) errors.push("This analysis currently accepts at most one grouping column so no parameter is silently ignored.");
  if (parameters.columnSelectionMode === "include" && parameters.selectedColumns.length === 0) errors.push("Choose at least one column to include.");
  if (parameters.columnSelectionMode === "exclude" && parameters.selectedColumns.length === dataset.columns.length) errors.push("Do not exclude every column.");
  if (parameters.selectedColumns.includes(parameters.targetColumn)) errors.push("The target column is selected separately and cannot also be in the include/exclude list.");
  if (parameters.groupingColumns.some((column) => parameters.selectedColumns.includes(column))) errors.push("Grouping columns are selected separately; remove them from the include/exclude list.");
  if (parameters.timeColumn && parameters.selectedColumns.includes(parameters.timeColumn)) errors.push("The time column is selected separately; remove it from the include/exclude list.");
  if (![0.9, 0.95, 0.99].includes(parameters.confidenceLevel)) errors.push("Choose 90%, 95%, or 99% confidence.");
  if (!["drop", "mean", "median"].includes(parameters.missingDataHandling)) errors.push("Choose a valid missing-data handling method.");
  return errors;
}
