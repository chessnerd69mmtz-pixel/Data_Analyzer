import type { AnalysisParameters, AnalysisResponse, ConfirmedDataset } from "../models/Dataset.ts";
import { validateAnalysisParameters } from "./ParameterValidator.ts";

export class AnalysisController {
  private worker: Worker | null = null;

  async run(dataset: ConfirmedDataset, parameters: AnalysisParameters): Promise<AnalysisResponse> {
    const validation = validateAnalysisParameters(dataset, parameters);
    if (validation.length) throw new Error(validation.join(" "));
    this.worker?.terminate();
    this.worker = new Worker(new URL("workers/analysis-worker.js", document.baseURI), { type: "classic" });
    const worker = this.worker;
    const payload = { dataset: serializeDataset(dataset), parameters };
    return await new Promise<AnalysisResponse>((resolve, reject) => {
      const timeout = window.setTimeout(() => { worker.terminate(); this.worker = null; reject(new Error("Analysis timed out. The dataset may be too large or the Python runtime could not finish in the browser.")); }, 180000);
      worker.addEventListener("message", (event: MessageEvent<{ ok: boolean; response?: AnalysisResponse; error?: string }>) => {
        window.clearTimeout(timeout); worker.terminate(); this.worker = null;
        if (event.data.ok && event.data.response) resolve(event.data.response); else reject(new Error(event.data.error ?? "Analysis failed."));
      }, { once: true });
      worker.addEventListener("error", (event) => { window.clearTimeout(timeout); worker.terminate(); this.worker = null; reject(new Error(event.message || "The analysis worker failed.")); }, { once: true });
      worker.postMessage(payload);
    });
  }

  dispose(): void { this.worker?.terminate(); this.worker = null; }
}

function serializeDataset(dataset: ConfirmedDataset): ConfirmedDataset {
  return { ...dataset, rows: dataset.rows.map((row) => row.map((value) => value instanceof Date ? value.toISOString() : value)) };
}
