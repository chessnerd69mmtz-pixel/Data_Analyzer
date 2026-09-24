import type { AnalysisResponse, ConfirmedDataset, ExtractionLogEntry } from "../models/Dataset.ts";
import { extractNumericTokens, validateReportNumbers } from "./ReportValidation.ts";
export interface ReportContext{dataset:ConfirmedDataset;analysis:AnalysisResponse;extractionLog:ExtractionLogEntry[];chartImages:Record<string,string>}
export interface ReportModel{sections:{parameters:string;extraction:string;summary:string;findings:string;nonSignificant:string;limitations:string};chartImages:Record<string,string>;numericProvenance:number[]}
export function buildReportModel(c:ReportContext):ReportModel{
 const params=JSON.stringify(c.analysis.parameters,null,2);
 const extraction=["Source: "+c.dataset.source.fileName,"Detected format: "+c.dataset.source.detectedFormat,"Extraction confidence: "+c.dataset.confidence,"Tool: "+c.dataset.extractionTool,"Location: "+c.dataset.location,"Manual edits: "+c.dataset.manualEdits.length,"Extraction events: "+c.extractionLog.length].join("\n");
 const summary=JSON.stringify(c.analysis.dataSummary,null,2);
 const findings=c.analysis.results.filter(r=>r.significant).map(r=>[r.testUsed,"n="+r.n,r.statisticLabel+"="+r.statistic,"p="+r.pValue,"adjusted p="+(r.adjustedPValue??r.pValue),r.effectSizeLabel+"="+r.effectSize,...r.caveats.length?["Notes: "+r.caveats.join(" | ")]:[]].join("; ")).join("\n");
 const nonsig=c.analysis.results.filter(r=>!r.significant).map(r=>r.testUsed+"; adjusted p="+(r.adjustedPValue??r.pValue)).join("\n");
 const responseFormat=c.analysis.parameters.responseFormat??"both";
 const formatText=(text:string)=>{
  const parts=text.split(/\s*[.;]\s*/).map(v=>v.trim()).filter(Boolean);
  if(responseFormat==="bullets") return parts.map(v=>"- "+v).join("\n");
  if(responseFormat==="paragraphs") return text;
  return text+"\n\n"+parts.map(v=>"- "+v).join("\n");
 };
 const conclusionText=(c.analysis.conclusions?.conclusions??[]).map(x=>[
  "#"+x.rank+" ["+x.priority+"] "+x.factor,
  formatText(x.conclusion),
  "Validity score: "+x.validityScore+"/100",
  "Evidence strength: "+x.evidenceStrength,
  "Practical importance: "+x.practicalImportance,
  "Target: "+x.targetColumn+"; factor type: "+x.factorType+"; sample size: "+x.sampleSize,
  x.adjustedPValue!==undefined?"Adjusted p: "+x.adjustedPValue:"",
  x.effectSize!==undefined?"Effect ("+(x.effectLabel||"effect")+"): "+x.effectSize:"",
  x.robustnessStability!==undefined?"Robustness stability: "+(x.robustnessStability*100).toFixed(1)+"%":"",
  x.predictiveImportance!==undefined?"Predictive importance: "+(x.predictiveImportance*100).toFixed(1)+"%":"",
  "Derivation: "+(x.derivationSteps??[]).join(" | "),
  "Checks: "+(x.checks??[]).map((z:any)=>z.name+": "+z.status+" — "+z.detail).join("; "),
  "Alternative explanations: "+(x.alternativeExplanations??[]).join(" | "),
  "Selection: "+x.selectionRationale
 ].filter(Boolean).join("\n")).join("\n\n");
 const limitations=["Associations and predictive importance are not causal evidence.","Extraction confidence was "+c.dataset.confidence+".",...c.analysis.failedChecks].join("\n");
 const model:ReportModel={sections:{parameters:params,extraction,summary,findings:(conclusionText?conclusionText+"\n\n":"")+ (findings||"No statistically significant result remained after FDR correction."),nonSignificant:nonsig||"None.",limitations},chartImages:c.chartImages,numericProvenance:[]};
 const md=renderMarkdown(model);model.numericProvenance=extractNumericTokens(md).map(Number).filter(Number.isFinite);
 const check=validateReportNumbers(md,model.numericProvenance);if(!check.ok)throw Error("Report numeric provenance validation failed: "+check.missing.join(", "));return model;
}
export function renderMarkdown(r:ReportModel):string{return "# Dataset Analysis Report\n\n## Parameters\n"+r.sections.parameters+"\n\n## Extraction\n"+r.sections.extraction+"\n\n## Data summary\n"+r.sections.summary+"\n\n## Findings\n"+r.sections.findings+"\n\n## Non-significant results\n"+r.sections.nonSignificant+"\n\n## Limitations\n"+r.sections.limitations+"\n";}
export function renderHtml(r:ReportModel):string{const esc=(v:string)=>v.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");const charts=Object.entries(r.chartImages).map(([id,src])=>"<figure><img alt=\"Supporting chart\" src=\""+src+"\"/><figcaption>Result "+id+"</figcaption></figure>").join("");return "<!doctype html><html><head><meta charset=\"utf-8\"><title>Dataset Analysis Report</title><style>body{font-family:system-ui;max-width:1100px;margin:40px auto;padding:0 18px}pre{white-space:pre-wrap;background:#f6f8fa;padding:14px;border-radius:8px}img{max-width:100%}</style></head><body><h1>Dataset Analysis Report</h1><h2>Parameters</h2><pre>"+esc(r.sections.parameters)+"</pre><h2>Extraction</h2><pre>"+esc(r.sections.extraction)+"</pre><h2>Data summary</h2><pre>"+esc(r.sections.summary)+"</pre><h2>Findings</h2><pre>"+esc(r.sections.findings)+"</pre><h2>Non-significant results</h2><pre>"+esc(r.sections.nonSignificant)+"</pre><h2>Limitations</h2><pre>"+esc(r.sections.limitations)+"</pre>"+charts+"</body></html>";}