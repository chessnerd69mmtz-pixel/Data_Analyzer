# Dataset Analyzer

Dataset Analyzer is a free, open-source, browser-only dataset analysis tool designed for GitHub Pages.

It extracts tabular data locally, requires an explicit confirmation of the extracted dataset before analysis, runs deterministic statistics in Pyodide, and produces plain-English findings whose numeric claims are traceable to computed results and confirmed extraction data.

There is no application backend, no API key, no paid service, and no LLM.

## Privacy model

User-supplied files are read in the browser and transferred only to in-browser Web Workers. Statistical calculations run locally in Pyodide. A public Google Sheets URL is fetched by the browser only when the user explicitly supplies it; no credentials are requested.

The interface states this directly before the user uploads data.

## Supported formats and extraction reliability

The upgraded release retains the original ingestion pipeline and adds a local Data Lab for cleaning, profiling, visualization, querying, and project persistence.

## Zero-cost Data Lab

- Dataset health dashboard and column-level profiling/data dictionary.
- Searchable, paginated editable data grid.
- Undo/redo and reset to confirmed snapshot.
- Text cleanup, missing-value filling, duplicate/blank-row removal.
- Numeric transforms and calculated columns.
- Multi-condition filtering.
- Interactive charts and correlation/outlier views.
- Local query lab.
- CSV/JSON/XLSX/Markdown exports.
- Project import/export and browser-local saving.
- Installable offline-friendly shell.

## Deterministic statistics

The original correlation, group comparison, categorical association, trend, outlier, and Random Forest/permutation-importance workflows remain intact. Additional descriptive statistics, normality diagnostics, multiple OLS regression, K-means clustering, and Isolation Forest anomaly detection run inside the existing Pyodide worker.

## Development

```bash
npm install
npm run dev
npm run build
npm run typecheck
npm test
npm run test:python
npm run test:all
```

## GitHub Pages

The included workflow builds the Vite application and deploys `dist/` through GitHub Actions. Set **Pages → Source** to **GitHub Actions** in the repository settings.

## License

MIT.
