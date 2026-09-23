# Dataset Analyzer

A free, browser-only dataset analysis workstation. The app is designed for GitHub Pages and does not require an API key, backend, paid service, database, or LLM.

## Main workflow

Import a dataset → inspect extraction candidates → edit and confirm the exact snapshot → profile/clean/query/explore → run deterministic statistics or machine learning → export the report.

## Supported ingestion

CSV, TSV, XLSX, XLS, ODS, JSON records, DOCX tables, selectable-text PDFs, OCR-backed PDF/image tables, Markdown tables, plain-text tables, public Google Sheets CSV exports, and manual paste.

The extractor checks content signatures, detects extension/content mismatches, preserves extraction provenance, and blocks analysis until the user explicitly confirms the editable snapshot.

## Data Lab

The post-confirmation Data Lab provides dataset profiling, editable paginated data, undo/redo, string transforms, missing-value filling, duplicate/blank-row removal, calculated columns, filtering/querying, charts, correlation exploration, project JSON export, CSV/XLSX/Markdown export, and analysis controls.

## Statistics / ML

The deterministic analysis worker supports correlation, group comparison, time trends, outlier screening, Random Forest feature importance, descriptive statistics, normality tests, multiple OLS regression, K-means clustering, and Isolation Forest anomaly detection. Multiple statistical p-values are corrected with Benjamini-Hochberg FDR.

## Privacy

User-supplied files are processed in browser workers. The application does not upload datasets to an application server. The only remote data operation is an explicit public Google Sheets export request initiated by the user. The app can also be installed as a PWA shell for offline-first local use after assets are cached.

## Development

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run test:python
npm run build
```

GitHub Pages deployment is handled by .github/workflows/deploy-pages.yml.
