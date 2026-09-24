import type { AnalysisParameters, AnalysisResponse, CandidateTable, ConfirmedDataset, InferredType } from "../models/Dataset.ts";
import { IngestionController } from "../ingestion/IngestionController.ts";
import { combineCandidates, canCombine } from "../ingestion/CombineTables.ts";
import { ConfirmationController } from "../confirmation/ConfirmationController.ts";
import { AnalysisController } from "../analysis/AnalysisController.ts";
import { DataLab } from "../lab/DataLab.ts";
import { fetchPublicGoogleSheet } from "../ingestion/GoogleSheets.ts";
import { buildReportModel, renderHtml, renderMarkdown } from "../reporting/ReportGenerator.ts";
import { renderResultChart } from "../charts/ChartFactory.ts";
import { initialSettings, createInitialState, type AppState, type SourceSession } from "./AppState.ts";

const MAX_BYTES = 50 * 1024 * 1024;
const accept = ".csv,.tsv,.xlsx,.xls,.ods,.json,.docx,.pdf,.md,.markdown,.txt,.png,.jpg,.jpeg";

export class App {
  private root: HTMLElement;
  private state: AppState = createInitialState();
  private ingestion = new IngestionController();
  private analyzer = new AnalysisController();
  private confirmation: ConfirmationController | null = null;
  private lab: DataLab | null = null;
  private report: ReturnType<typeof buildReportModel> | null = null;
  private reportMd = "";
  private reportHtml = "";

  constructor(root: HTMLElement) { this.root = root; this.renderUpload(); }

  private err(e: unknown): void { this.state.error = e instanceof Error ? e.message : String(e); this.render(); }
  private clear(): void { this.state.error = null; }

  private async ingest(fileName: string, bytes: ArrayBuffer, size: number, mimeType: string | undefined, kind: SourceSession["kind"], url?: string): Promise<void> {
    if (size > MAX_BYTES) throw new Error("The browser-only input limit is 50 MB.");
    const settings = structuredClone(initialSettings);
    this.state.source = { fileName, bytes, sizeBytes: size, mimeType, settings, kind, sourceUrl: url };
    this.busy("Detecting format and extracting candidate tables…");
    const result = await this.ingestion.extract({ fileName, fileSize: size, mimeType, bytes: bytes.slice(0), settings });
    this.clear(); this.state.candidates = result.candidates; this.state.selectedCandidateIds = new Set(result.candidates.length === 1 ? [result.candidates[0].id] : []); this.state.activeCandidate = null; this.confirmation = null; this.state.confirmedDataset = null; this.state.analysis = null; this.state.analysisParameters = null; this.render();
  }

  private async onFile(file: File): Promise<void> { try { await this.ingest(file.name, await file.arrayBuffer(), file.size, file.type, "file"); } catch (e) { this.err(e); } }
  private async onSheet(url: string): Promise<void> { try { const r = await fetchPublicGoogleSheet(url); await this.ingest("google-sheet.csv", r.bytes, r.bytes.byteLength, "text/csv", "google-sheet", url); } catch (e) { this.err(e); } }
  private async onPaste(text: string): Promise<void> { if (!text.trim()) return this.err("Paste tabular text first."); try { const bytes = new TextEncoder().encode(text).buffer; await this.ingest("manual-paste.csv", bytes, bytes.byteLength, "text/csv", "manual"); } catch (e) { this.err(e); } }

  private busy(message: string): void { this.root.innerHTML = `<main class="shell"><section class="card busy"><span class="spinner"></span><p>${esc(message)}</p></section></main>`; }
  private error(): string { return this.state.error ? `<section class="card error-card"><strong>Action needed</strong><span>${esc(this.state.error)}</span></section>` : ""; }
  private render(): void { if (this.state.analysis && this.state.confirmedDataset) this.renderResults(); else if (this.confirmation) this.renderConfirmation(); else if (this.state.confirmedDataset) this.renderLab(); else if (this.state.candidates.length) this.renderCandidates(); else this.renderUpload(); }
  private reset(): void { this.lab?.dispose(); this.lab = null; this.confirmation = null; this.report = null; this.reportMd = ""; this.reportHtml = ""; this.state = createInitialState(); this.renderUpload(); }

  private renderUpload(): void {
    this.root.innerHTML = `<main class="shell"><header class="hero"><span class="eyebrow">Local-first statistics</span><h1>Dataset Analyzer</h1><p>Extract, verify, clean, explore, query and analyze datasets entirely in the browser.</p></header><section class="privacy card"><strong>Your data stays local.</strong><span>No application backend, API key, account, paid service or LLM is required. Public Google Sheets are fetched only when you explicitly provide a public URL.</span></section>${this.error()}<section class="card"><div class="section-heading"><h2>Import</h2><span class="pill high">50 MB max</span></div><label class="dropzone" id="dropzone"><input id="file" type="file" accept="${accept}"/><span class="drop-title">Choose or drop a dataset</span><span class="drop-subtitle">CSV · TSV · Excel · ODS · JSON · DOCX · PDF · Markdown · TXT · PNG/JPG</span></label></section><section class="card"><h2>Public Google Sheets</h2><div class="inline-form"><input id="sheet" placeholder="https://docs.google.com/spreadsheets/d/..."/><button class="secondary" id="sheet-btn">Fetch sheet</button></div></section><section class="card"><h2>Manual table paste</h2><textarea id="paste" rows="9" placeholder="Name,Value,Group\nA,12,X\nB,15,Y"></textarea><button class="secondary" id="paste-btn">Parse table</button></section><section class="card"><h2>Processing rules</h2><p>Numbers in prose are not extracted. Complex/low-confidence extraction is flagged. Multiple candidate tables require explicit selection/combination. Analysis is unavailable until you confirm the editable snapshot.</p></section></main>`;
    const file = document.querySelector<HTMLInputElement>("#file"); file?.addEventListener("change", () => { const f = file.files?.[0]; if (f) void this.onFile(f); });
    const zone = document.querySelector<HTMLElement>("#dropzone"); zone?.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("dragover"); }); zone?.addEventListener("dragleave", () => zone.classList.remove("dragover")); zone?.addEventListener("drop", e => { e.preventDefault(); zone.classList.remove("dragover"); const f = e.dataTransfer?.files?.[0]; if (f) void this.onFile(f); });
    document.querySelector("#sheet-btn")?.addEventListener("click", () => void this.onSheet((document.querySelector<HTMLInputElement>("#sheet")?.value ?? "").trim()));
    document.querySelector("#paste-btn")?.addEventListener("click", () => void this.onPaste(document.querySelector<HTMLTextAreaElement>("#paste")?.value ?? ""));
  }

  private renderCandidates(): void {
    const source = this.state.candidates[0]?.source; const hasWarnings = this.state.candidates.some(c => c.confidence !== "High");
    this.root.innerHTML = `<main class="shell wide"><header class="topbar"><div><span class="eyebrow">Candidate tables</span><h1>${esc(this.state.source?.fileName ?? "Dataset")}</h1></div><button class="secondary" id="start">Start over</button></header>${this.error()}<section class="card"><h2>Detection</h2><p><strong>Content:</strong> ${esc(source?.detectedFormat ?? "unknown")} · <strong>Extension:</strong> ${esc(source?.extensionFormat ?? "unknown")}</p><ul>${(source?.detectionEvidence ?? []).map(x => `<li>${esc(x)}</li>`).join("")}</ul></section>${hasWarnings ? `<section class="card warning-card"><strong>Review extraction confidence.</strong><p>Medium/Low-confidence sources must be verified before relying on the findings.</p></section>` : ""}<section class="card"><h2>Candidate tables</h2><div class="candidate-grid">${this.state.candidates.map((c,i)=>this.candidateCard(c,i)).join("")}</div><button class="primary" id="review">Review selected table(s)</button></section></main>`;
    document.querySelector("#start")?.addEventListener("click", () => this.reset()); document.querySelector("#review")?.addEventListener("click", () => this.reviewSelected());
    document.querySelectorAll<HTMLInputElement>(".candidate-check").forEach(input => input.addEventListener("change", () => { if (input.checked) this.state.selectedCandidateIds.add(input.value); else this.state.selectedCandidateIds.delete(input.value); }));
    document.querySelectorAll<HTMLButtonElement>(".review-one").forEach(b => b.addEventListener("click", () => { const c = this.state.candidates.find(x => x.id === b.dataset.id); if (c) this.beginConfirmation(c); }));
  }

  private candidateCard(c: CandidateTable, index: number): string {
    const rows = c.rawRows.slice(0,4).map(r => `<tr>${r.map(v=>`<td>${esc(v)}</td>`).join("")}</tr>`).join("");
    const flags = c.sanityFlags.slice(0,6).map(f=>`<li class="flag-${f.severity}">${esc(f.message)}</li>`).join("");
    return `<article class="candidate-card"><div class="candidate-head"><label class="checkbox"><input class="candidate-check" type="checkbox" value="${esc(c.id)}" ${this.state.selectedCandidateIds.has(c.id)?"checked":""}/>Candidate ${index+1}</label><span class="pill ${c.confidence.toLowerCase()}">${c.confidence}</span></div><p class="muted">${esc(c.location)} · ${Math.max(0,c.rawRows.length-1)} rows × ${c.columnNames.length} columns</p><div class="table-scroll"><table class="mini-table"><tbody>${rows}</tbody></table></div>${flags?`<details><summary>${c.sanityFlags.length} sanity flags</summary><ul>${flags}</ul></details>`:""}<button class="secondary review-one" data-id="${esc(c.id)}">Review this table</button></article>`;
  }

  private reviewSelected(): void {
    const selected = this.state.candidates.filter(c => this.state.selectedCandidateIds.has(c.id)); if (!selected.length) return this.err("Select a candidate table first.");
    try { if (selected.length > 1) { const check = canCombine(selected); if (!check.ok) throw new Error(check.reason); this.beginConfirmation(combineCandidates(selected)); } else this.beginConfirmation(selected[0]); } catch (e) { this.err(e); }
  }
  private beginConfirmation(c: CandidateTable): void { this.state.activeCandidate = c; this.confirmation = new ConfirmationController(c); this.clear(); this.render(); }

  private renderConfirmation(): void {
    const c = this.confirmation!; const s = c.getState(); const flags = c.currentFlags(); const rows = c.previewIndices(); const cols = s.activeColumnIndices; const headers = c.headers(); const types = c.types();
    this.root.innerHTML = `<main class="shell wide"><header class="topbar"><div><span class="eyebrow">Mandatory confirmation</span><h1>Review extracted data</h1><p>${esc(s.candidate.source.fileName)} · ${esc(s.candidate.location)}</p></div><button class="secondary" id="back">Back</button></header>${this.error()}<section class="card"><div class="section-heading"><h2>Confirm exact snapshot</h2><div><span class="pill ${flags.some(f=>f.severity==="error")?"low":"high"}">${flags.filter(f=>f.severity==="error").length} blocking</span> <span class="pill medium">${flags.filter(f=>f.severity==="warning").length} warnings</span></div></div><label>Header row<select id="header">${s.candidate.rawRows.map((r,i)=>`<option value="${i}" ${i===s.headerRow?"selected":""}>Row ${i+1}: ${esc(r.slice(0,5).map(String).join(" | "))}</option>`).join("")}</select></label><div class="table-scroll editable-preview"><table><thead><tr>${cols.map((idx,pos)=>`<th><div class="column-head"><input class="rename" data-col="${idx}" value="${esc(headers[pos])}"/><select class="type" data-col="${idx}">${["string","number","boolean","date"].map(t=>`<option value="${t}" ${t===types[pos]?"selected":""}>${t}</option>`).join("")}</select><button class="danger-link del-col" data-col="${idx}">Delete</button></div></th>`).join("")}<th>Row</th></tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(idx=>`<td><input class="cell-input" data-row="${r}" data-col="${idx}" value="${esc(c.cellValue(r,idx))}"/></td>`).join("")}<td><button class="danger-link del-row" data-row="${r}">Delete row</button></td></tr>`).join("")}</tbody></table></div><div class="confirm-bar"><span class="muted">Preview first 20 + last 5. All edits are logged.</span><button class="primary" id="confirm">Confirm snapshot</button></div></section>${flags.length?`<section class="card"><h2>Sanity checks</h2><ul class="flag-list">${flags.map(f=>`<li class="flag-${f.severity}">${esc(f.message)}</li>`).join("")}</ul></section>`:""}</main>`;
    document.querySelector("#back")?.addEventListener("click",()=>{this.confirmation=null;this.state.activeCandidate=null;this.renderCandidates();});
    document.querySelector<HTMLSelectElement>("#header")?.addEventListener("change",e=>this.changeConfirm(()=>c.setHeaderRow(Number((e.target as HTMLSelectElement).value))));
    document.querySelectorAll<HTMLInputElement>(".rename").forEach(i=>i.addEventListener("change",()=>this.changeConfirm(()=>c.renameColumn(Number(i.dataset.col),i.value))));
    document.querySelectorAll<HTMLSelectElement>(".type").forEach(i=>i.addEventListener("change",()=>this.changeConfirm(()=>c.changeType(Number(i.dataset.col),i.value as InferredType))));
    document.querySelectorAll<HTMLInputElement>(".cell-input").forEach(i=>i.addEventListener("change",()=>this.changeConfirm(()=>c.editCell(Number(i.dataset.row),Number(i.dataset.col),i.value))));
    document.querySelectorAll<HTMLButtonElement>(".del-row").forEach(b=>b.addEventListener("click",()=>this.changeConfirm(()=>c.deleteRow(Number(b.dataset.row)))));
    document.querySelectorAll<HTMLButtonElement>(".del-col").forEach(b=>b.addEventListener("click",()=>this.changeConfirm(()=>c.deleteColumn(Number(b.dataset.col)))));
    document.querySelector("#confirm")?.addEventListener("click",()=>{try{this.state.confirmedDataset=c.confirm();this.confirmation=null;this.state.activeCandidate=null;this.renderLab();}catch(e){this.err(e);}});
  }
  private changeConfirm(fn:()=>void): void { try { fn(); this.clear(); this.renderConfirmation(); } catch(e) { this.err(e); } }

  private renderLab(): void {
    if (!this.state.confirmedDataset) return;
    this.lab?.dispose(); const mount=document.createElement("div"); this.lab=new DataLab(mount,this.state.confirmedDataset,{onAnalyze:(d,p)=>void this.runAnalysis(d,p),onChange:d=>{this.state.confirmedDataset=d;},onStartOver:()=>this.reset()});
    this.root.innerHTML=`<main class="shell wide"><header class="topbar"><div><span class="eyebrow">Confirmed dataset</span><h1>Data Lab</h1><p>${esc(this.state.confirmedDataset.source.fileName)} · ${this.state.confirmedDataset.rows.length} rows × ${this.state.confirmedDataset.columns.length} columns</p></div><div class="button-row"><button class="secondary" id="new">Start over</button><button class="secondary" id="export-project">Export project</button></div></header>${this.error()}<div id="lab"></div></main>`;
    document.querySelector("#lab")!.appendChild(mount.firstElementChild ?? mount);
    document.querySelector("#new")?.addEventListener("click",()=>this.reset());
    document.querySelector("#export-project")?.addEventListener("click",()=>download("dataset-analyzer-project.json",JSON.stringify(this.lab?.exportProject(),null,2),"application/json"));
  }

  private async runAnalysis(dataset: ConfirmedDataset, params: AnalysisParameters): Promise<void> {
    try { this.clear(); this.state.confirmedDataset=dataset; this.state.analysisParameters=params; this.busy("Running deterministic analysis in the browser…"); this.state.analysis=await this.analyzer.run(dataset,params); this.report=await this.makeReport(this.state.analysis,dataset); this.reportMd=renderMarkdown(this.report); this.reportHtml=renderHtml(this.report); this.renderResults(); } catch(e) { this.err(e); }
  }
  private async makeReport(analysis: AnalysisResponse,dataset: ConfirmedDataset){ const images:Record<string,string>={}; for(const r of analysis.results.filter(x=>x.significant)){try{images[r.resultId]=await renderResultChart(r);}catch{}} return buildReportModel({dataset,analysis,extractionLog:dataset.extractionLog,chartImages:images}); }
  private renderResults(): void {
    if (!this.state.analysis || !this.report) return;
    const a=this.state.analysis; const findings=a.results.filter(r=>r.significant); const charts=this.report.chartImages;
    const conclusions=a.conclusions?.conclusions??[];
    const responseFormat=a.parameters.responseFormat??"both";
    const formatConclusion=(text:string)=>{
      const parts=text.split(/\s*[.;]\s*/).map(x=>x.trim()).filter(Boolean);
      if(responseFormat==="bullets") return '<ul class="response-list">'+parts.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>';
      if(responseFormat==="paragraphs") return '<p class="response-paragraph">'+esc(text)+'</p>';
      return '<p class="response-paragraph">'+esc(text)+'</p><ul class="response-list">'+parts.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>';
    };
    const conclusionCard=(c:any)=>'<article class="conclusion-card"><div class="conclusion-head"><div><span class="pill '+(c.priority==="user-focus"?"high":"medium")+'">'+(c.priority==="user-focus"?"User priority":"Automatically discovered")+'</span><h3>'+esc(c.factor)+'</h3></div><span class="evidence-strength '+c.evidenceStrength+'">'+esc(c.evidenceStrength)+'</span></div><p class="conclusion-lead">'+esc(c.conclusion)+'</p><div class="conclusion-meta"><span>Practical importance: <strong>'+esc(c.practicalImportance)+'</strong></span><span>Robustness: <strong>'+((c.robustnessStability??0)*100).toFixed(1)+'%</strong></span><span>Predictive importance: <strong>'+((c.predictiveImportance??0)*100).toFixed(1)+'%</strong></span>'+(c.adjustedPValue!==undefined?'<span>Adjusted p: <strong>'+Number(c.adjustedPValue).toFixed(6)+'</strong></span>':"")+'</div><details><summary>Why this conclusion?</summary><ul>'+((c.checks??[]).map((x:any)=>'<li><strong>'+esc(x.name)+':</strong> '+esc(x.detail)+'</li>').join(""))+'</ul></details><details><summary>Possible alternative explanations / limitations</summary><ul>'+((c.alternativeExplanations??[]).concat(c.caveats??[]).map((x:string)=>'<li>'+esc(x)+'</li>').join(""))+'</ul></details></article>';
    const focus=conclusions.filter(c=>c.priority==="user-focus"), discovered=conclusions.filter(c=>c.priority==="discovered");
    const question=a.conclusions?.question?'<p><strong>Research question:</strong> '+esc(a.conclusions.question)+'</p>':"";
    this.root.innerHTML=\`<main class="shell wide"><header class="topbar"><div><span class="eyebrow">Evidence-driven conclusions</span><h1>Analysis report</h1><p>\${esc(this.state.confirmedDataset?.source.fileName ?? "Dataset")}</p></div><div class="button-row"><button class="secondary" id="back-lab">Back to Data Lab</button><button class="secondary" id="new">Start over</button></div></header>\${this.error()}\${question}<section class="card conclusion-summary"><div class="section-heading"><div><h2>Conclusions</h2><p class="muted">Requested factors are prioritized, while the engine independently scans the remaining dataset for additional evidence.</p></div><span class="pill high">\${conclusions.length} evaluated factors</span></div>\${focus.length?'<h3>Your requested factors</h3>'+focus.map(conclusionCard).join(""):'<p class="muted">No factors were explicitly prioritized.</p>'}\${discovered.length?'<h3 class="discover-title">Other factors discovered automatically</h3>'+discovered.map(conclusionCard).join(""):""}</section><section class="card"><h2>Data summary</h2><pre>\${esc(JSON.stringify(a.dataSummary,null,2))}</pre></section><section class="card"><h2>Statistical findings</h2>\${findings.length?findings.map(r=>\`<article class="finding"><strong>\${esc(r.testUsed)}</strong><p>n=\${r.n}; \${esc(r.statisticLabel)}=\${r.statistic.toFixed(4)}; p=\${r.pValue.toFixed(6)}; adjusted p=\${(r.adjustedPValue??r.pValue).toFixed(6)}; \${esc(r.effectSizeLabel)}=\${r.effectSize.toFixed(4)}.</p>\${r.caveats.length?\`<ul>\${r.caveats.map(c=>\`<li>\${esc(c)}</li>\`).join("")}</ul>\`:""}\${charts[r.resultId]?\`<img class="report-chart" src="\${charts[r.resultId]}" alt="Supporting chart"/>\`:""}</article>\`).join(""):\`<div class="warning-card"><strong>Not enough data to conclude.</strong><p>\${esc(a.failedChecks.join(" ") || "No result met the selected statistical decision criteria.")}</p></div>\`}</section><section class="card"><h2>All computed results</h2><div class="table-scroll"><table class="mini-table"><thead><tr><th>Test</th><th>n</th><th>p</th><th>Adjusted p</th><th>Effect</th><th>Significant</th></tr></thead><tbody>\${a.results.map(r=>\`<tr><td>\${esc(r.testUsed)}</td><td>\${r.n}</td><td>\${r.pValue.toFixed(6)}</td><td>\${(r.adjustedPValue??r.pValue).toFixed(6)}</td><td>\${r.effectSize.toFixed(4)}</td><td>\${r.significant?"Yes":"No"}</td></tr>\`).join("")}</tbody></table></div></section><section class="card"><h2>Export</h2><div class="button-row"><button class="primary" id="md">Download Markdown</button><button class="secondary" id="html">Download HTML</button></div><p class="muted">Conclusions are generated from deterministic statistical/ML evidence. No external AI API is required.</p></section></main>\`;
    document.querySelector("#back-lab")?.addEventListener("click",()=>{this.state.analysis=null;this.report=null;this.renderLab();}); document.querySelector("#new")?.addEventListener("click",()=>this.reset()); document.querySelector("#md")?.addEventListener("click",()=>download("dataset-analysis-report.md",this.reportMd,"text/markdown")); document.querySelector("#html")?.addEventListener("click",()=>download("dataset-analysis-report.html",this.reportHtml,"text/html"));
  }
}

function esc(v: unknown): string { return String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;"); }
function download(name:string,text:string,mime:string){const blob=new Blob([text],{type:`${mime};charset=utf-8`});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
