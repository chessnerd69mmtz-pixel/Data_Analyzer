import type { AnalysisResult } from "../models/Dataset.ts";
import { Chart } from "chart.js/auto";
export async function renderResultChart(result:AnalysisResult):Promise<string>{
 const canvas=document.createElement("canvas");canvas.width=1000;canvas.height=520;
 const pts=result.dataPoints??[],labels=pts.map(p=>String(p.label??p.x??"")),values=pts.map(p=>Number(p.value??p.y??0));
 const kind=result.analysisType==="correlation"||result.analysisType==="trend"?"scatter":"bar";
 const data=kind==="scatter"?pts.map(p=>({x:Number(p.x??p.index??0),y:Number(p.y??p.value??0)})):values;
 const chart=new Chart(canvas,{type:kind as any,data:{labels:kind==="scatter"?undefined:labels,datasets:[{label:result.testUsed,data}]},options:{responsive:false,animation:false}});
 await new Promise(r=>requestAnimationFrame(()=>r(undefined)));const out=canvas.toDataURL("image/png");chart.destroy();return out;
}