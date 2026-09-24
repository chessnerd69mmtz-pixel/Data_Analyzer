import type { ExtractionRequest } from "../models/Extraction.ts";
import type { ExtractionResponse } from "../models/Extraction.ts";

export class IngestionController {
  private worker: Worker | null = null;

  async extract(request: ExtractionRequest): Promise<ExtractionResponse> {
    this.worker?.terminate();
    this.worker = new Worker(new URL("./IngestionWorker.ts", import.meta.url), { type: "module" });
    const worker = this.worker;
    return await new Promise<ExtractionResponse>((resolve, reject) => {
      const timeoutMs = Math.min(30 * 60 * 1000, Math.max(120000, Math.ceil(request.fileSize / (25 * 1024 * 1024)) * 30000));
      const timeout = window.setTimeout(() => {
        worker.terminate();
        reject(new Error("Extraction timed out. The file may be too large or malformed."));
      }, timeoutMs);

      worker.addEventListener("message", (event: MessageEvent<{ ok: boolean; response?: ExtractionResponse; error?: string }>) => {
        window.clearTimeout(timeout);
        worker.terminate();
        if (event.data.ok && event.data.response) resolve(event.data.response);
        else reject(new Error(event.data.error ?? "Extraction failed."));
      }, { once: true });
      worker.addEventListener("error", (event) => {
        window.clearTimeout(timeout);
        worker.terminate();
        reject(new Error(event.message || "The extraction worker failed."));
      }, { once: true });

      worker.postMessage(request, [request.bytes]);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
