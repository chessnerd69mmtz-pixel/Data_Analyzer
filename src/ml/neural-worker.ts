import * as tf from "@tensorflow/tfjs";

interface FeatureColumn { name:string; index:number; }
interface NeuralPayload {
  targetColumn:{name:string;index:number};
  targetType:"number"|"classification";
  featureColumns:FeatureColumn[];
  rows:unknown[][];
}
interface NeuralResult {
  modelType:string;
  task:"regression"|"classification";
  score:number;
  scoreLabel:string;
  featureImportance:Record<string,number>;
  notes:string[];
}
interface WorkerResponse { ok:boolean; result?:NeuralResult; reason?:string; }

type NumericMatrix = number[][];

function numberValue(value:unknown):number {
  const n=Number(value);
  return Number.isFinite(n)?n:NaN;
}

function normalizeRows(rows:NumericMatrix, means:number[], stds:number[]):NumericMatrix {
  return rows.map((row:number[])=>row.map((value:number,i:number)=>(value-means[i])/(stds[i]||1)));
}

function tensorValues(prediction:tf.Tensor|tf.Tensor[]):number[] {
  const tensor=Array.isArray(prediction)?prediction[0]:prediction;
  const values=tensor.dataSync() as Float32Array|Int32Array|Uint8Array;
  const out=Array.from(values as ArrayLike<number>,(value:number)=>Number(value));
  tensor.dispose();
  return out;
}

function regressionR2(actual:number[],predicted:number[]):number {
  if(actual.length===0)return 0;
  const mean=actual.reduce((sum,value)=>sum+value,0)/actual.length;
  const total=actual.reduce((sum,value)=>sum+(value-mean)*(value-mean),0);
  if(total===0)return 0;
  const residual=actual.reduce((sum,value,i)=>sum+(value-predicted[i])*(value-predicted[i]),0);
  return 1-residual/total;
}

async function trainRegression(
  trainX:NumericMatrix,
  testX:NumericMatrix,
  trainY:number[],
  testY:number[],
  means:number[],
  stds:number[],
  featureColumns:FeatureColumn[]
):Promise<NeuralResult>{
  const yMean=trainY.reduce((sum,value)=>sum+value,0)/trainY.length;
  const yStd=Math.sqrt(trainY.reduce((sum,value)=>sum+(value-yMean)*(value-yMean),0)/Math.max(1,trainY.length-1))||1;
  const normalizedY=trainY.map(value=>[(value-yMean)/yStd]);

  const model=tf.sequential();
  model.add(tf.layers.dense({units:32,activation:"relu",inputShape:[featureColumns.length]}));
  model.add(tf.layers.dropout({rate:0.1}));
  model.add(tf.layers.dense({units:16,activation:"relu"}));
  model.add(tf.layers.dense({units:1}));
  model.compile({optimizer:tf.train.adam(0.01),loss:"meanSquaredError"});

  const xTrain=tf.tensor2d(normalizeRows(trainX,means,stds));
  const yTrain=tf.tensor2d(normalizedY);
  await model.fit(xTrain,yTrain,{epochs:30,batchSize:Math.min(64,trainX.length),verbose:0,shuffle:true});
  xTrain.dispose(); yTrain.dispose();

  const predictionsScaled=tensorValues(model.predict(tf.tensor2d(normalizeRows(testX,means,stds))));
  const predictions=predictionsScaled.map(value=>value*yStd+yMean);
  const score=regressionR2(testY,predictions);
  const featureImportance:Record<string,number>={};

  for(let column=0;column<featureColumns.length;column+=1){
    const permuted=testX.map(row=>row.slice());
    for(let i=permuted.length-1;i>0;i-=1){
      const swapIndex=(i*37)% (i+1);
      const tmp=permuted[i][column];
      permuted[i][column]=permuted[swapIndex][column];
      permuted[swapIndex][column]=tmp;
    }
    const shuffled=tensorValues(model.predict(tf.tensor2d(normalizeRows(permuted,means,stds)))).map(value=>value*yStd+yMean);
    const shuffledScore=regressionR2(testY,shuffled);
    featureImportance[featureColumns[column].name]=Math.max(0,score-shuffledScore);
  }

  const totalImportance=Object.values(featureImportance).reduce((sum,value)=>sum+value,0)||1;
  for(const name of Object.keys(featureImportance)) featureImportance[name]/=totalImportance;

  model.dispose();
  return {
    modelType:"TensorFlow.js MLP",
    task:"regression",
    score,
    scoreLabel:"holdout R²",
    featureImportance,
    notes:[
      "Small local neural network trained entirely in the browser.",
      "Feature importance is permutation-based sensitivity, not causal importance.",
      "Use neural evidence as supporting predictive evidence rather than proof of causation."
    ]
  };
}

async function trainClassification(
  trainX:NumericMatrix,
  testX:NumericMatrix,
  trainY:number[],
  testY:number[],
  means:number[],
  stds:number[],
  featureColumns:FeatureColumn[]
):Promise<NeuralResult>{
  const model=tf.sequential();
  model.add(tf.layers.dense({units:32,activation:"relu",inputShape:[featureColumns.length]}));
  model.add(tf.layers.dropout({rate:0.1}));
  model.add(tf.layers.dense({units:16,activation:"relu"}));
  model.add(tf.layers.dense({units:1,activation:"sigmoid"}));
  model.compile({optimizer:tf.train.adam(0.01),loss:"binaryCrossentropy"});

  const xTrain=tf.tensor2d(normalizeRows(trainX,means,stds));
  const yTrain=tf.tensor2d(trainY.map(value=>[value]));
  await model.fit(xTrain,yTrain,{epochs:30,batchSize:Math.min(64,trainX.length),verbose:0,shuffle:true});
  xTrain.dispose(); yTrain.dispose();

  const probabilities=tensorValues(model.predict(tf.tensor2d(normalizeRows(testX,means,stds))));
  const predictions=probabilities.map(value=>value>=0.5?1:0);
  const correct=predictions.reduce((sum,value,i)=>sum+(value===testY[i]?1:0),0);
  const score=correct/Math.max(1,testY.length);
  const featureImportance:Record<string,number>={};

  for(let column=0;column<featureColumns.length;column+=1){
    const permuted=testX.map(row=>row.slice());
    for(let i=permuted.length-1;i>0;i-=1){
      const swapIndex=(i*37)% (i+1);
      const tmp=permuted[i][column];
      permuted[i][column]=permuted[swapIndex][column];
      permuted[swapIndex][column]=tmp;
    }
    const shuffled=tensorValues(model.predict(tf.tensor2d(normalizeRows(permuted,means,stds))));
    const shuffledPredictions=shuffled.map(value=>value>=0.5?1:0);
    const shuffledCorrect=shuffledPredictions.reduce((sum,value,i)=>sum+(value===testY[i]?1:0),0);
    featureImportance[featureColumns[column].name]=Math.max(0,score-shuffledCorrect/Math.max(1,testY.length));
  }

  const totalImportance=Object.values(featureImportance).reduce((sum,value)=>sum+value,0)||1;
  for(const name of Object.keys(featureImportance)) featureImportance[name]/=totalImportance;

  model.dispose();
  return {
    modelType:"TensorFlow.js MLP",
    task:"classification",
    score,
    scoreLabel:"holdout accuracy",
    featureImportance,
    notes:[
      "Small local neural network trained entirely in the browser.",
      "Binary classification only in this lightweight neural evidence path.",
      "Feature importance is permutation-based sensitivity, not causal importance."
    ]
  };
}

async function run(payload:NeuralPayload):Promise<WorkerResponse>{
  const featureColumns=payload.featureColumns;
  if(featureColumns.length===0)return {ok:false,reason:"No numeric features were supplied."};

  const completeRows=payload.rows.filter((row:unknown[])=>featureColumns.every(column=>Number.isFinite(numberValue(row[column.index]))));
  const withTarget=completeRows.filter((row:unknown[])=>payload.targetType==="number" || row[payload.targetColumn.index]!==null&&row[payload.targetColumn.index]!==undefined&&String(row[payload.targetColumn.index]).trim()!=="");
  if(withTarget.length<100)return {ok:false,reason:"TensorFlow neural evidence requires at least 100 complete rows."};

  const matrix:NumericMatrix=withTarget.map((row:unknown[])=>featureColumns.map(column=>numberValue(row[column.index])));
  const split=Math.max(20,Math.floor(matrix.length*0.2));
  const trainX=matrix.slice(0,matrix.length-split);
  const testX=matrix.slice(matrix.length-split);

  const means=featureColumns.map((_,column)=>trainX.reduce((sum,row)=>sum+row[column],0)/trainX.length);
  const stds=featureColumns.map((_,column)=>Math.sqrt(trainX.reduce((sum,row)=>sum+(row[column]-means[column])*(row[column]-means[column]),0)/Math.max(1,trainX.length-1))||1);

  if(payload.targetType==="number"){
    const targets=withTarget.map(row=>numberValue(row[payload.targetColumn.index]));
    if(targets.some(value=>!Number.isFinite(value)))return {ok:false,reason:"The numeric target contains unsupported values."};
    const trainY=targets.slice(0,targets.length-split);
    const testY=targets.slice(targets.length-split);
    return {ok:true,result:await trainRegression(trainX,testX,trainY,testY,means,stds,featureColumns)};
  }

  const labels=[...new Set(withTarget.map(row=>String(row[payload.targetColumn.index])))];
  if(labels.length!==2)return {ok:false,reason:"The neural evidence path currently supports binary classification only."};
  const encoded=withTarget.map(row=>String(row[payload.targetColumn.index])===labels[1]?1:0);
  const trainY=encoded.slice(0,encoded.length-split);
  const testY=encoded.slice(encoded.length-split);
  return {ok:true,result:await trainClassification(trainX,testX,trainY,testY,means,stds,featureColumns)};
}

self.onmessage=async(event:MessageEvent<NeuralPayload>)=>{
  try{self.postMessage(await run(event.data));}
  catch(error){self.postMessage({ok:false,reason:error instanceof Error?error.message:String(error)} as WorkerResponse);}
};
