import * as XLSX from "xlsx";
import { Chart } from "chart.js/auto";
import type { AnalysisParameters, ConfirmedDataset, DataValue, InferredType } from "../models/Dataset.ts";

export interface DataLabCallbacks {
  onAnalyze:(dataset:ConfirmedDataset, parameters:AnalysisParameters)=>void;
  onChange:(dataset:ConfirmedDataset)=>void;
  onStartOver:()=>void;
}
type Tab="overview"|"clean"|"explore"|"query"|"statistics"|"project";

export class DataLab {
  private root:HTMLElement;
  private dataset:ConfirmedDataset;
  private baseline:ConfirmedDataset;
  private cb:DataLabCallbacks;
  private tab:Tab="overview";
  private undoStack:ConfirmedDataset[]=[];
  private redoStack:ConfirmedDataset[]=[];
  private chart:any=null;
  private page=0;
  private pageSize=50;
  constructor(root:HTMLElement,dataset:ConfirmedDataset,cb:DataLabCallbacks){
    this.root=root;this.dataset=structuredClone(dataset);this.baseline=structuredClone(dataset);this.cb=cb;this.render();
  }
  dispose(){this.chart?.destroy();this.chart=null;}
  exportProject(){return {version:1,exportedAt:new Date().toISOString(),dataset:this.dataset};}
  private e(v:unknown){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");}
  private clone(){return structuredClone(this.dataset);}
  private commit(label:string,fn:(d:ConfirmedDataset)=>void){
    try{
      const next=this.clone();fn(next);
      if(!next.rows.length)throw new Error("The operation would remove every row.");
      this.undoStack.push(this.clone());this.redoStack=[];
      if(this.undoStack.length>25)this.undoStack.shift();
      next.extractionLog=[...next.extractionLog,{stage:"data-lab",action:label,source:next.source.fileName,tool:"Local Data Lab",reason:"Explicit local transformation."}];
      this.dataset=next;this.cb.onChange(this.clone());this.render();
    }catch(error){alert(error instanceof Error?error.message:String(error));}
  }
  private opts(){return this.dataset.columns.map(c=>"<option>"+this.e(c.name)+"</option>").join("");}
  readAnalysisParameters():AnalysisParameters{
    const names=this.dataset.columns.map(c=>c.name);
    const selected=[...document.querySelectorAll<HTMLOptionElement>("#lab-features option:checked")].map(o=>o.value);
    const groups=[...document.querySelectorAll<HTMLOptionElement>("#lab-group option:checked")].map(o=>o.value);
    const focus=[...document.querySelectorAll<HTMLOptionElement>("#lab-focus option:checked")].map(o=>o.value);
    return {
      targetColumn:document.querySelector<HTMLSelectElement>("#lab-target")?.value??names[0]??"",
      groupingColumns:groups,
      columnSelectionMode:(document.querySelector<HTMLInputElement>('input[name="lab-mode"]:checked')?.value??"include") as "include"|"exclude",
      selectedColumns:selected,
      rowFilters:[],
      confidenceLevel:Number(document.querySelector<HTMLSelectElement>("#lab-confidence")?.value??".95") as 0.9|0.95|0.99,
      analysisType:(document.querySelector<HTMLSelectElement>("#lab-type")?.value??"correlation") as AnalysisParameters["analysisType"],
      missingDataHandling:(document.querySelector<HTMLSelectElement>("#lab-missing")?.value??"drop") as AnalysisParameters["missingDataHandling"],
      timeColumn:document.querySelector<HTMLSelectElement>("#lab-time")?.value||undefined,
      userFocusFactors:focus,
      conclusionQuestion:(document.querySelector<HTMLTextAreaElement>("#lab-question")?.value||"").trim()||undefined,
      scanOtherFactors:document.querySelector<HTMLInputElement>("#lab-scan-other")?.checked??true,
      conclusionDepth:(document.querySelector<HTMLSelectElement>("#lab-depth")?.value||"standard") as "standard"|"deep"|"research",
      robustnessResamples:Number(document.querySelector<HTMLSelectElement>("#lab-resamples")?.value||"300")
    };
  }
  private render(){
    this.chart?.destroy();this.chart=null;
    const tabs:[Tab,string][]=[["overview","Overview"],["clean","Clean"],["explore","Explore"],["query","Query"],["statistics","Statistics / ML"],["project","Project"]];
    let body:string;
    if(this.tab==="overview")body=this.overview();else if(this.tab==="clean")body=this.clean();else if(this.tab==="explore")body=this.explore();else if(this.tab==="query")body=this.query();else if(this.tab==="statistics")body=this.statistics();else body=this.project();
    this.root.innerHTML='<section class="datalab"><nav class="lab-tabs">'+tabs.map(t=>'<button class="lab-tab '+(t[0]===this.tab?"active":"")+'" data-tab="'+t[0]+'">'+t[1]+"</button>").join("")+"</nav>"+body+"</section>";
    this.bind();
  }
  private overview(){
    const p=this.dataset.columns.map((c,i)=>({c,i,missing:this.dataset.rows.length-this.dataset.rows.map(r=>r[i]).filter(v=>v!==null&&v!=="").length}));
    const missing=p.reduce((n,x)=>n+x.missing,0);
    return '<div class="lab-head"><div><h2>Dataset overview</h2><p>'+this.dataset.rows.length+' rows × '+this.dataset.columns.length+' columns · '+this.e(this.dataset.confidence)+' confidence</p></div><div><button data-act="undo">Undo</button> <button data-act="redo">Redo</button> <button data-act="reset">Reset</button></div></div>'+
      '<div class="kpi-grid"><article><b>'+this.dataset.rows.length+'</b><span>Rows</span></article><article><b>'+this.dataset.columns.length+'</b><span>Columns</span></article><article><b>'+missing+'</b><span>Missing cells</span></article></div>'+this.grid(false);
  }
  private clean(){
    const o=this.opts();
    return '<div class="tool-grid"><article><h3>Text</h3><button data-act="trim">Trim</button><button data-act="lower">Lowercase</button><button data-act="upper">Uppercase</button></article>'+
      '<article><h3>Missing / duplicates</h3><button data-act="meanfill">Mean fill</button><button data-act="medfill">Median fill</button><button data-act="dedupe">Remove duplicates</button><button data-act="blankrows">Remove blank rows</button></article>'+
      '<article><h3>Columns</h3><label>Rename<select id="rename-col">'+o+'</select></label><input id="rename-value" placeholder="New name"/><button data-act="rename">Rename</button><label>Delete<select id="delete-col">'+o+'</select></label><button data-act="deletecol">Delete</button></article>'+
      '<article><h3>Calculated</h3><label>Left<select id="calc-a">'+o+'</select></label><label>Operator<select id="calc-op"><option>+</option><option>-</option><option>*</option><option>/</option></select></label><label>Right<select id="calc-b">'+o+'</select></label><input id="calc-name" placeholder="New column"/><button data-act="calc">Add calculated</button></article></div>'+this.grid(true);
  }
  private explore(){
    const o=this.opts();
    return '<div class="lab-section-grid"><article><h3>Visualization</h3><label>Column<select id="chart-col">'+o+'</select></label><label>Type<select id="chart-kind"><option value="hist">Histogram</option><option value="bar">Category counts</option><option value="line">Index trend</option></select></label><button data-act="chart">Render</button><div class="chart-stage"><canvas id="lab-chart"></canvas></div></article><article><h3>Correlation matrix</h3>'+this.correlation()+'</article></div>';
  }
  private correlation(){
    const cols=this.dataset.columns.map((c,i)=>({c,i})).filter(x=>x.c.type==="number");
    if(cols.length<2)return "<p>Need at least two numeric columns.</p>";
    const corr=(a:number[],b:number[])=>{const n=a.length,ma=a.reduce((s,v)=>s+v,0)/n,mb=b.reduce((s,v)=>s+v,0)/n;let xy=0,xx=0,yy=0;for(let i=0;i<n;i++){xy+=(a[i]-ma)*(b[i]-mb);xx+=(a[i]-ma)*(a[i]-ma);yy+=(b[i]-mb)*(b[i]-mb);}return xx&&yy?xy/Math.sqrt(xx*yy):NaN;};
    const vals=cols.map(x=>this.dataset.rows.map(r=>Number(r[x.i])));
    return '<div class="table-scroll"><table class="mini-table"><tbody>'+cols.map((x,i)=>"<tr><th>"+this.e(x.c.name)+"</th>"+cols.map((_,j)=>{const z=corr(vals[i],vals[j]);return "<td>"+(Number.isFinite(z)?z.toFixed(3):"—")+"</td>";}).join("")+"</tr>").join("")+"</tbody></table></div>";
  }
  private query(){return '<article><h3>Local query</h3><div class="query-row"><select id="q-col">'+this.opts()+'</select><select id="q-op"><option>=</option><option>!=</option><option>contains</option><option>&gt;</option><option>&lt;</option></select><input id="q-value" placeholder="value"/><button data-act="query">Run</button></div><div id="query-result"></div></article>';}
  private statistics(){
    const o=this.opts(), focusOpts=this.dataset.columns.map(c=>'<option value="'+this.e(c.name)+'">'+this.e(c.name)+'</option>').join("");
    return '<div class="stats-box">'+
      '<div class="parameter-grid"><label>Analysis<select id="lab-type"><option value="correlation">Correlation</option><option value="group-comparison">Group comparison</option><option value="trend">Trend</option><option value="outliers">Outliers</option><option value="feature-importance">Feature importance</option><option value="descriptive">Descriptive</option><option value="normality">Normality</option><option value="regression">Regression</option><option value="clustering">Clustering</option><option value="anomaly-detection">Anomaly detection</option></select></label><label>Target<select id="lab-target">'+o+'</select></label><label>Confidence<select id="lab-confidence"><option value=".9">90%</option><option value=".95" selected>95%</option><option value=".99">99%</option></select></label><label>Missing<select id="lab-missing"><option value="drop">Drop</option><option value="mean">Mean</option><option value="median">Median</option></select></label></div>'+
      '<section class="conclusion-controls"><h3>Conclusion controls</h3><p class="muted">Choose factors you especially want conclusions about. The engine will also scan remaining eligible factors when enabled.</p><label>Specific research question<textarea id="lab-question" rows="3" placeholder="Example: Which factors are most strongly associated with revenue, and are those relationships robust?"></textarea></label><label>Prioritized factors<select id="lab-focus" multiple size="7">'+focusOpts+'</select></label><div class="parameter-grid"><label class="checkbox"><input id="lab-scan-other" type="checkbox" checked> Scan other factors automatically</label><label>Conclusion depth<select id="lab-depth"><option value="standard">Standard</option><option value="deep" selected>Deep</option><option value="research">Research</option></select></label><label>Robustness resamples<select id="lab-resamples"><option value="100">100 · Faster</option><option value="300" selected>300 · Balanced</option><option value="600">600 · Deep</option><option value="1000">1000 · Research</option></select></label></div></section>'+
      '<label>Grouping<select id="lab-group" multiple size="4">'+o+'</select></label><label>Features<select id="lab-features" multiple size="6">'+o+'</select></label><div class="radio-row"><label><input type="radio" name="lab-mode" value="include" checked> Include selected</label><label><input type="radio" name="lab-mode" value="exclude"> Exclude selected</label></div><label>Time<select id="lab-time"><option value="">None</option>'+o+'</select></label><button class="primary" data-act="analyze">Run full conclusion analysis</button></div>';
  }
  private project(){return '<div class="lab-section-grid"><article><h3>Export</h3><button data-act="export">Project JSON</button><button data-act="csv">CSV</button><button data-act="xlsx">XLSX</button><button data-act="md">Markdown</button></article><article><h3>Lineage</h3><pre>'+this.e(JSON.stringify({datasetId:this.dataset.datasetId,source:this.dataset.source.fileName,confidence:this.dataset.confidence,manualEdits:this.dataset.manualEdits.length,events:this.dataset.extractionLog.length},null,2))+'</pre></article></div>';}
  private grid(edit:boolean){
    const cols=this.dataset.columns,rows=this.dataset.rows.slice(this.page*this.pageSize,(this.page+1)*this.pageSize);
    return '<div class="lab-data-grid"><table class="data-table"><thead><tr>'+cols.map(c=>'<th>'+this.e(c.name)+'<small>'+c.type+'</small></th>').join('')+'</tr></thead><tbody>'+rows.map((r,ri)=>'<tr>'+cols.map((_c,ci)=>'<td>'+(edit?'<input class="cell-edit" data-row="'+(this.page*this.pageSize+ri)+'" data-col="'+ci+'" value="'+this.e(r[ci])+'">':this.e(r[ci]))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div><div class="pager"><button data-act="prev">Previous</button><span>Page '+(this.page+1)+'/'+Math.max(1,Math.ceil(this.dataset.rows.length/this.pageSize))+'</span><button data-act="next">Next</button></div>';
  }
  private bind(){
    this.root.querySelectorAll<HTMLButtonElement>(".lab-tab").forEach(b=>b.onclick=()=>{this.tab=b.dataset.tab as Tab;this.page=0;this.render();});
    this.root.querySelectorAll<HTMLButtonElement>("[data-act]").forEach(b=>b.onclick=()=>this.action(b.dataset.act||""));
    this.root.querySelectorAll<HTMLInputElement>(".cell-edit").forEach(i=>i.onchange=()=>{const r=Number(i.dataset.row),c=Number(i.dataset.col);this.commit("CELL_EDITED",d=>{d.rows[r][c]=this.parse(i.value,d.columns[c].type);});});
  }
  private parse(v:string,t:InferredType):DataValue{if(!v.trim())return null;if(t==="number")return Number(v);if(t==="boolean")return /^true$/i.test(v)?true:/^false$/i.test(v)?false:null;if(t==="date"){const d=new Date(v);return Number.isNaN(d.getTime())?null:d;}return v;}
  private action(a:string){
    if(a==="undo"){const x=this.undoStack.pop();if(x){this.redoStack.push(this.clone());this.dataset=x;this.cb.onChange(this.clone());this.render();}return;}
    if(a==="redo"){const x=this.redoStack.pop();if(x){this.undoStack.push(this.clone());this.dataset=x;this.cb.onChange(this.clone());this.render();}return;}
    if(a==="reset"){this.dataset=structuredClone(this.baseline);this.undoStack=[];this.redoStack=[];this.cb.onChange(this.clone());this.render();return;}
    if(a==="trim"||a==="lower"||a==="upper"){const mode=a;return this.commit(a.toUpperCase(),d=>d.rows=d.rows.map(r=>r.map(v=>typeof v==="string"?(mode==="trim"?v.trim():mode==="lower"?v.toLowerCase():v.toUpperCase()):v)));}
    if(a==="dedupe")return this.commit("REMOVE_DUPLICATES",d=>{const seen=new Set<string>();d.rows=d.rows.filter(r=>{const k=JSON.stringify(r);if(seen.has(k))return false;seen.add(k);return true;});});
    if(a==="blankrows")return this.commit("REMOVE_BLANK_ROWS",d=>d.rows=d.rows.filter(r=>r.some(v=>v!==null&&String(v).trim()!=="")));
    if(a==="meanfill"||a==="medfill")return this.commit(a.toUpperCase(),d=>d.columns.forEach((c,i)=>{if(c.type!=="number")return;const nums=d.rows.map(r=>Number(r[i])).filter(Number.isFinite);const fill=a==="meanfill"?nums.reduce((x,y)=>x+y,0)/Math.max(1,nums.length):nums.slice().sort((x,y)=>x-y)[Math.floor((nums.length-1)/2)];d.rows.forEach(r=>{if(r[i]===null||r[i]==="")r[i]=Number.isFinite(fill)?fill:null;});}));
    if(a==="rename"){const from=document.querySelector<HTMLSelectElement>("#rename-col")?.value||"",to=(document.querySelector<HTMLInputElement>("#rename-value")?.value||"").trim();if(!to)return;return this.commit("RENAME_COLUMN",d=>{const c=d.columns.find(x=>x.name===from);if(c)c.name=to;});}
    if(a==="deletecol"){const name=document.querySelector<HTMLSelectElement>("#delete-col")?.value||"";return this.commit("DELETE_COLUMN",d=>{const i=d.columns.findIndex(c=>c.name===name);if(i<0)throw Error("Column not found.");d.columns.splice(i,1);d.rows.forEach(r=>r.splice(i,1));});}
    if(a==="calc"){const an=document.querySelector<HTMLSelectElement>("#calc-a")?.value||"",bn=document.querySelector<HTMLSelectElement>("#calc-b")?.value||"",op=document.querySelector<HTMLSelectElement>("#calc-op")?.value||"+",name=(document.querySelector<HTMLInputElement>("#calc-name")?.value||"").trim()||"Calculated";return this.commit("ADD_CALCULATED_COLUMN",d=>{const ia=d.columns.findIndex(c=>c.name===an),ib=d.columns.findIndex(c=>c.name===bn);if(ia<0||ib<0||d.columns[ia].type!=="number"||d.columns[ib].type!=="number")throw Error("Calculated columns require numeric inputs.");d.columns.push({id:"column_"+Date.now(),name,originalName:name,type:"number"});d.rows.forEach(r=>{const x=Number(r[ia]),y=Number(r[ib]);r.push(op==="+"?x+y:op==="-"?x-y:op==="*"?x*y:y===0?null:x/y);});});}
    if(a==="chart")return this.drawChart();
    if(a==="query")return this.runQuery();
    if(a==="analyze")return this.cb.onAnalyze(this.clone(),this.readAnalysisParameters());
    if(a==="export")return download("dataset-analyzer-project.json",JSON.stringify(this.exportProject(),null,2),"application/json");
    if(a==="csv")return download("dataset.csv",this.csv(),"text/csv");
    if(a==="xlsx"){const ws=XLSX.utils.aoa_to_sheet([this.dataset.columns.map(c=>c.name),...this.dataset.rows]),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Data");return downloadBlob("dataset.xlsx",new Blob([XLSX.write(wb,{bookType:"xlsx",type:"array"})],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));}
    if(a==="md")return download("dataset.md",this.md(),"text/markdown");
    if(a==="prev"){this.page=Math.max(0,this.page-1);return this.render();}
    if(a==="next"){this.page=Math.min(Math.max(0,Math.ceil(this.dataset.rows.length/this.pageSize)-1),this.page+1);return this.render();}
  }
  private drawChart(){
    const canvas=document.querySelector<HTMLCanvasElement>("#lab-chart"),name=document.querySelector<HTMLSelectElement>("#chart-col")?.value||"",kind=document.querySelector<HTMLSelectElement>("#chart-kind")?.value||"hist",i=this.dataset.columns.findIndex(c=>c.name===name);if(!canvas||i<0)return;
    const counts=new Map<string,number>();this.dataset.rows.forEach(r=>{const k=String(r[i]??"");counts.set(k,(counts.get(k)||0)+1);});
    const pairs=[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,20);const config:any={type:kind==="line"?"line":"bar",data:{labels:pairs.map(x=>x[0]),datasets:[{label:kind==="line"?name:"Count",data:pairs.map(x=>x[1])}]},options:{responsive:true}};
    this.chart?.destroy();this.chart=new Chart(canvas,config);
  }
  private runQuery(){
    const name=document.querySelector<HTMLSelectElement>("#q-col")?.value||"",op=document.querySelector<HTMLSelectElement>("#q-op")?.value||"=",q=document.querySelector<HTMLInputElement>("#q-value")?.value||"",i=this.dataset.columns.findIndex(c=>c.name===name);
    const rows=this.dataset.rows.filter(r=>{const v=String(r[i]??"");if(op==="=")return v===q;if(op==="!=")return v!==q;if(op==="contains")return v.toLowerCase().includes(q.toLowerCase());const a=Number(v),b=Number(q);return op===">"?a>b:a<b;});
    const out=document.querySelector("#query-result");if(out)out.innerHTML='<p><strong>'+rows.length+'</strong> matching rows.</p><div class="table-scroll"><table class="mini-table"><tbody>'+rows.slice(0,100).map(r=>'<tr>'+r.map(v=>'<td>'+this.e(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  }
  private csv(){return [this.dataset.columns.map(c=>csv(c.name)).join(","),...this.dataset.rows.map(r=>r.map(csv).join(","))].join("\n");}
  private md(){return "| "+this.dataset.columns.map(c=>c.name.replaceAll("|","\\|")).join(" | ")+" |\n| "+this.dataset.columns.map(()=>"---").join(" | ")+" |\n"+this.dataset.rows.map(r=>"| "+r.map(v=>String(v??"").replaceAll("|","\\|")).join(" | ")+" |").join("\n");}
}
function csv(v:unknown){const s=String(v??"");return /[",\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;}
function download(name:string,text:string,mime:string){downloadBlob(name,new Blob([text],{type:mime+";charset=utf-8"}));}
function downloadBlob(name:string,b:Blob){const a=document.createElement("a"),u=URL.createObjectURL(b);a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
