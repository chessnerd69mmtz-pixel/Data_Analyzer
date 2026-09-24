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
    const a=this.state.analysis;
    const charts=this.report.chartImages;
    const conclusions=a.conclusions?.conclusions??[];
    const responseFormat=a.parameters.responseFormat??"both";
    const formatConclusion=(text:string)=>{
      const parts=text.split(/\s*[.;]\s*/).map(x=>x.trim()).filter(Boolean);
      if(responseFormat==="bullets") return "<ul class=\"response-list\">"+parts.map(x=>"<li>"+esc(x)+"</li>").join("")+"</ul>";
      if(responseFormat==="paragraphs") return "<p class=\"response-paragraph\">"+esc(text)+"</p>";
      return "<p class=\"response-paragraph\">"+esc(text)+"</p><ul class=\"response-list\">"+parts.map(x=>"<li>"+esc(x)+"</li>").join("")+"</ul>";
    };
    const evidenceChecks=(item:any)=>"<div class=\"evidence-checks\">"+(item.checks??[]).map((check:any)=>"<div class=\"evidence-check \"+check.status+\"><strong>"+esc(check.name)+"</strong><span>"+esc(check.detail)+"</span></div>").join("")+"</div>";
    const supportingResults=(item:any)=>{
      const ids=new Set(item.supportingResultIds??[]);
      const linked=a.results.filter(result=>ids.has(result.resultId));
      if(!linked.length) return "<p class=\"muted\">No direct statistical result object was linked; the conclusion was derived from the dedicated evidence scan.</p>";
      return "<div class=\"supporting-results\">"+linked.map(result=>"<article class=\"supporting-result\"><strong>"+esc(result.testUsed)+"</strong><div class=\"evidence-grid\"><span>n: <b>"+result.n+"</b></span><span>"+esc(result.statisticLabel)+": <b>"+result.statistic.toFixed(4)+"</b></span><span>p: <b>"+result.pValue.toFixed(6)+"</b></span><span>adjusted p: <b>"+(result.adjustedPValue??result.pValue).toFixed(6)+"</b></span><span>"+esc(result.effectSizeLabel)+": <b>"+result.effectSize.toFixed(4)+"</b></span>"+(result.crossValidatedScore!==undefined?"<span>"+esc(result.crossValidatedScoreLabel??"CV score")+": <b>"+result.crossValidatedScore.toFixed(4)+"</b></span>":"")+(result.confidenceInterval?"<span>CI: <b>["+result.confidenceInterval.map((x:number)=>x.toFixed(4)).join(", ")+"]</b></span>":"")+"</div>"+(result.caveats.length?"<ul class=\"response-list\">"+result.caveats.map((x:string)=>"<li>"+esc(x)+"</li>").join("")+"</ul>":"")+"</article>").join("")+"</div>";
    };
    const tabHeaders=conclusions.map(item=>"<button class=\"conclusion-tab\" data-conclusion-index=\""+(item.rank-1)+"\"><span class=\"tab-rank\">#"+item.rank+"</span><span class=\"tab-name\">"+esc(item.factor)+"</span><span class=\"tab-score\">"+item.validityScore.toFixed(1)+"</span></button>").join("");
    const panels=conclusions.map((item,index)=>{
      const chartsForConclusion=(item.supportingResultIds??[]).map((id:string)=>charts[id]).filter(Boolean).map((src:string)=>"<img class=\"report-chart dossier-chart\" src=\""+src+"\" alt=\"Supporting analysis chart\"/>").join("");
      const derivation="<ol class=\"derivation-list\">"+(item.derivationSteps??[]).map((step:string)=>"<li>"+esc(step)+"</li>").join("")+"</ol>";
      const alternatives="<ul class=\"response-list\">"+(item.alternativeExplanations??[]).concat(item.caveats??[]).map((x:string)=>"<li>"+esc(x)+"</li>").join("")+"</ul>";
      return '<section class="conclusion-panel '+(index===0?"active":"hidden")+'" data-conclusion-panel="'+index+'">'+
        "<div class=\"dossier-header\"><div><span class=\"pill "+(item.priority==="user-focus"?"high":"medium")+"\">"+(item.priority==="user-focus"?"User priority":"Automatically discovered")+"</span><h2>#"+item.rank+" — "+esc(item.factor)+"</h2><p class=\"muted\">"+esc(item.selectionRationale)+"</p></div><div class=\"validity-score\"><strong>"+item.validityScore.toFixed(1)+"</strong><span>Validity / 100</span></div></div>"+
        "<section class=\"dossier-section\"><h3>Conclusion</h3>"+formatConclusion(item.conclusion)+"</section>"+
        "<section class=\"dossier-section\"><h3>How it was derived</h3>"+derivation+"</section>"+
        "<section class=\"dossier-section\"><h3>Core evidence</h3><div class=\"evidence-grid\"><span>Target: <b>"+esc(item.targetColumn)+"</b></span><span>Factor type: <b>"+esc(item.factorType)+"</b></span><span>Sample size: <b>"+item.sampleSize+"</b></span><span>Evidence strength: <b>"+esc(item.evidenceStrength)+"</b></span><span>Practical importance: <b>"+esc(item.practicalImportance)+"</b></span><span>Direction: <b>"+esc(item.direction??"none")+"</b></span><span>Effect: <b>"+(item.effectSize??0).toFixed(4)+"</b> "+esc(item.effectLabel??"")+"</span>"+(item.adjustedPValue!==undefined?"<span>Adjusted p: <b>"+Number(item.adjustedPValue).toFixed(6)+"</b></span>":"")+(item.confidenceInterval?"<span>Confidence interval: <b>["+item.confidenceInterval.map((x:number)=>x.toFixed(4)).join(", ")+"]</b></span>":"")+"</div><p><strong>Methods:</strong> "+esc((item.tests??[]).join(" · "))+"</p></section>"+
        "<section class=\"dossier-section\"><h3>Robustness and model evidence</h3><div class=\"evidence-grid\"><span>Robustness stability: <b>"+((item.robustnessStability??0)*100).toFixed(1)+"%</b></span><span>Predictive importance: <b>"+((item.predictiveImportance??0)*100).toFixed(1)+"%</b></span><span>Linked result IDs: <b>"+((item.supportingResultIds??[]).length||0)+"</b></span></div>"+chartsForConclusion+"</section>"+
        "<section class=\"dossier-section\"><h3>Validation checks</h3>"+evidenceChecks(item)+"</section>"+
        "<section class=\"dossier-section\"><h3>Underlying statistical results</h3>"+supportingResults(item)+"</section>"+
        "<section class=\"dossier-section\"><h3>Alternative explanations and caveats</h3>"+alternatives+"</section>"+
      "</section>";
    }).join("");
    const question=a.conclusions?.question?"<p><strong>Research question:</strong> "+esc(a.conclusions.question)+"</p>":"";
    const neural=a.neuralEvidence?"<div class=\"card neural-summary\"><strong>Neural evidence:</strong> "+esc(a.neuralEvidence.modelType)+" · "+esc(a.neuralEvidence.scoreLabel)+" = "+a.neuralEvidence.score.toFixed(3)+"</div>":"";
    this.root.innerHTML="<main class=\"shell wide\"><header class=\"topbar\"><div><span class=\"eyebrow\">Top conclusion set</span><h1>Evidence dossier</h1><p>"+esc(this.state.confirmedDataset?.source.fileName??"Dataset")+"</p></div><div class=\"button-row\"><button class=\"secondary\" id=\"back-lab\">Back to Data Lab</button><button class=\"secondary\" id=\"new\">Start over</button></div></header>"+this.error()+question+neural+"<section class=\"card conclusion-workspace\"><div class=\"section-heading\"><div><h2>Top "+conclusions.length+" most valid conclusions</h2><p class=\"muted\">The ranking is based on transparent evidence-quality components; it is not a probability that a conclusion is true.</p></div><span class=\"pill high\">Maximum 10</span></div><nav class=\"conclusion-tabs\" aria-label=\"Conclusions\">"+tabHeaders+"</nav><div class=\"conclusion-panels\">"+(conclusions.length?panels:"<div class=\"warning-card\"><strong>No conclusion met the minimum evidence requirements.</strong><p>Review the dataset, parameters, and sanity checks in Data Lab.</p></div>")+"</div></section><section class=\"card\"><h2>Analysis summary</h2><pre>"+esc(JSON.stringify(a.dataSummary,null,2))+"</pre></section><section class=\"card\"><h2>Export</h2><div class=\"button-row\"><button class=\"primary\" id=\"md\">Download Markdown</button><button class=\"secondary\" id=\"html\">Download HTML</button></div></section></main>";
    document.querySelector("#back-lab")?.addEventListener("click",()=>{this.state.analysis=null;this.report=null;this.renderLab();});
    document.querySelector("#new")?.addEventListener("click",()=>this.reset());
    document.querySelector("#md")?.addEventListener("click",()=>download("dataset-analysis-report.md",this.reportMd,"text/markdown"));
    document.querySelector("#html")?.addEventListener("click",()=>download("dataset-analysis-report.html",this.reportHtml,"text/html"));
    document.querySelectorAll<HTMLButtonElement>(".conclusion-tab").forEach(tab=>tab.addEventListener("click",()=>{const index=Number(tab.dataset.conclusionIndex);document.querySelectorAll(".conclusion-tab").forEach(x=>x.classList.toggle("active",x===tab));document.querySelectorAll(".conclusion-panel").forEach(panel=>panel.classList.toggle("hidden",panel.getAttribute("data-conclusion-panel")!==String(index)));}));
  }
}

function esc(v: unknown): string { return String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;"); }
function download(name:string,text:string,mime:string){const blob=new Blob([text],{type:`${mime};charset=utf-8`});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
