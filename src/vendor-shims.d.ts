declare module "papaparse" {
  const Papa: { parse(input: string, config: Record<string, unknown>): { data: unknown[]; errors: Array<{ code: string; row: number; message: string }> } };
  export default Papa;
}
declare module "xlsx" { const XLSX: any; export = XLSX; }
declare module "jszip" { const JSZip: any; export default JSZip; }
declare module "pdfjs-dist/build/pdf.mjs" { const moduleValue: any; export = moduleValue; }
declare module "chart.js/auto" { export const Chart: any; }
declare module "tesseract.js" { export const createWorker: any; }
