import type { ConfirmedDataset, AnalysisResponse } from "../models/Dataset.ts";

export interface NeuralEvidenceResult {
  modelType:string;task:"regression"|"classification";score:number;scoreLabel:string;
  featureImportance:Record<string,number>;notes:string[];
}

export async function runNeuralEvidence(dataset:ConfirmedDataset, targetColumn:string, featureNames:string[]):Promise<NeuralEvidenceResult|null>{
  const targetIndex=dataset.columns.findIndex(c=>c.name===targetColumn);
  if(targetIndex<0)return null;
  const eligible=featureNames.map(name=>({name,index:dataset.columns.findIndex(c=>c.name===name),type:dataset.columns.find(c=>c.name===name)?.type})).filter(x=>x.index>=0&&x.type==="number");
  if(eligible.length<1)return null;
  const targetType=dataset.columns[targetIndex].type;
  if(targetType!=="number" && targetType!=="boolean" && targetType!=="string")return null;
  const worker=new Worker(new URL("./neural-worker.ts",import.meta.url),{type:"module"});
  return await new Promise<NeuralEvidenceResult|null>((resolve)=>{
    const timer=window.setTimeout(()=>{worker.terminate();resolve(null)},120000);
    worker.onmessage=(event:MessageEvent<any>)=>{window.clearTimeout(timer);worker.terminate();resolve(event.data?.ok?event.data.result:null);};
    worker.onerror=()=>{window.clearTimeout(timer);worker.terminate();resolve(null);};
    worker.postMessage({
      targetColumn:{name:targetColumn,index:targetIndex},targetType:targetType==="number"?"number":"classification",
      featureColumns:eligible.map(x=>({name:x.name,index:x.index})),
      rows:dataset.rows.map(row=>row.slice())
    });
  });
}

export function mergeNeuralEvidence(analysis:AnalysisResponse,evidence:NeuralEvidenceResult|null):void{
  if(!evidence||!analysis.conclusions)return;
  analysis.neuralEvidence=evidence;
  for(const conclusion of analysis.conclusions.conclusions){
    const importance=evidence.featureImportance[conclusion.factor]??0;
    if(importance>0){
      conclusion.predictiveImportance=Math.max(conclusion.predictiveImportance??0,importance);
      conclusion.checks.push({name:"TensorFlow.js neural model",status:"pass",detail:evidence.scoreLabel+"="+evidence.score.toFixed(3)+"; permutation sensitivity for this factor="+(importance*100).toFixed(1)+"%.",value:importance});
    }else{
      conclusion.checks.push({name:"TensorFlow.js neural model",status:"not-run",detail:"This factor did not receive measurable permutation sensitivity in the neural model."});
    }
  }
}