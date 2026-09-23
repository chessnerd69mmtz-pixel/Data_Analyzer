# Dataset Analyzer upgrade notes

This revision preserves the original extraction, mandatory confirmation, worker-based Pyodide analysis, FDR correction, report provenance validation, and all existing ingestion fixtures.

## Added

- Local Data Lab after confirmation.
- Transparent dataset-health dashboard.
- Column profiling/data dictionary.
- Searchable, paginated, editable post-confirmation data grid.
- Undo/redo and reset-to-confirmed-snapshot.
- Text cleaning transforms.
- Missing numeric imputation.
- Duplicate/blank-row removal.
- Numeric transformations.
- Column rename/delete.
- Safe arithmetic calculated columns.
- Multi-condition row filtering.
- Interactive local charts and downloadable PNG.
- Correlation matrix.
- IQR outlier overview.
- Local SQL-like Query Lab.
- CSV/JSON/XLSX/Markdown exports.
- Importable project files and local project persistence.
- Web manifest and service-worker shell caching.
- Descriptive statistics.
- Normality diagnostics.
- Multiple OLS regression.
- K-means clustering with silhouette selection.
- Isolation Forest anomaly detection.

## Verification

- TypeScript project type-check: passed.
- Existing Python statistical/fixture tests: 15 passed.
- New statistical smoke tests for correlation, regression, descriptive, normality, clustering and anomaly detection: passed.

A full Vite/browser build could not be executed in the build container because `npm install` could not complete within the available network execution window. No source-level type errors remain according to the project TypeScript compiler.

No API keys, backend services, paid services, or AI APIs were added.
