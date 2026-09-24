import * as tf from "@tensorflow/tfjs";

function finite(v){return Number.isFinite(v)?Number(v):null;}
function normalizeRows(rows,means,stds){return rows.map(r=>r.map((v,i)=>(Number(v)-means[i])/(stds[i]||1)));}
async function run(payload){
  const cols=payload.featureColumns, target=payload.targetColumn, rows=payload.rows;
  const targetType=payload.targetType;
  const usable=rows.map((r,i)=>({r,i})).filter(x=>x.r.every(v=>v!==null&&v!=="")&&x.r[0]!==undefined);
  if(usable.length<100) return {ok:false,reason:"TensorFlow neural evidence requires at least 100 complete rows."};
  const X=usable.map(x=>cols.map(c=>Number(x.r[c.index])));
  const yRaw=usable.map(x=>x.r[target.index]);
  if(X.some(r=>r.some(v=>!Number.isFinite(v)))) return {ok:false,reason:"TensorFlow neural evidence currently requires numeric features."};
  const means=cols.map((_,j)=>X.reduce((a,r)=>a+r[j],0)/X.length);
  const stds=cols.map((_,j)=>Math.sqrt(X.reduce((a,r)=>a+(r[j]-means[j])**2,0)/Math.max(1,X.length-1)));
  const split=Math.max(20,Math.floor(X.length*0.2));
  const trainX=X.slice(0,X.length-split),testX=X.slice(X.length-split);
  let trainY,testY,loss,finalMetric,model;
  if(targetType==="number"){
    trainY=yRaw.slice(0,yRaw.length-split).map(Number).map(v=>[v]);testY=yRaw.slice(yRaw.length-split).map(Number);
    const mean=trainY.reduce((a,r)=>a+r[0],0)/Math.max(1,trainY.length);const sd=Math.sqrt(trainY.reduce((a,r)=>a+(r[0]-mean)**2,0)/Math.max(1,trainY.length-1))||1;
    trainY=trainY.map(r=>[(r[0]-mean)/sd]);
    testY=testY.map(v=>(v-mean)/sd);
    model=tf.sequential();model.add(tf.layers.dense({units:32,activation:"relu",inputShape:[cols.length]}));model.add(tf.layers.dropout({rate:.1}));model.add(tf.layers.dense({units:16,activation:"relu"}));model.add(tf.layers.dense({units:1}));
    model.compile({optimizer:tf.train.adam(.01),loss:"meanSquaredError"});
    const xt=tf.tensor2d(normalizeRows(trainX,means,stds)),yt=tf.tensor2d(trainY);
    await model.fit(xt,yt,{epochs:30,batchSize:Math.min(64,trainX.length),verbose:0,shuffle:true});xt.dispose();yt.dispose();
    const pred=Array.from(await model.predict(tf.tensor2d(normalizeRows(testX,means,stds))).dataSync());
    const y=testY;const mse=y.reduce((a,v,i)=>a+(v-pred[i])**2,0)/y.length;const ym=y.reduce((a,v)=>a+v,0)/y.length;const tss=y.reduce((a,v)=>a+(v-ym)**2,0);finalMetric=tss>0?1-(mse*y.length)/tss:0;loss=mse;
  }else{
    const classes=[...new Set(yRaw.map(String))];if(classes.length!==2)return {ok:false,reason:"TensorFlow neural evidence currently supports binary classification only."};
    trainY=yRaw.slice(0,yRaw.length-split).map(v=>[String(v)===classes[1]?1:0]);testY=yRaw.slice(yRaw.length-split).map(v=>String(v)===classes[1]?1:0);
    model=tf.sequential();model.add(tf.layers.dense({units:32,activation:"relu",inputShape:[cols.length]}));model.add(tf.layers.dropout({rate:.1}));model.add(tf.layers.dense({units:16,activation:"relu"}));model.add(tf.layers.dense({units:1,activation:"sigmoid"}));
    model.compile({optimizer:tf.train.adam(.01),loss:"binaryCrossentropy"});
    const xt=tf.tensor2d(normalizeRows(trainX,means,stds)),yt=tf.tensor2d(trainY);
    await model.fit(xt,yt,{epochs:30,batchSize:Math.min(64,trainX.length),verbose:0,shuffle:true});xt.dispose();yt.dispose();
    const pred=Array.from(await model.predict(tf.tensor2d(normalizeRows(testX,means,stds))).dataSync()).map(v=>v>=.5?1:0);
    finalMetric=pred.reduce((a,v,i)=>a+(v===testY[i]?1:0),0)/pred.length;loss=1-finalMetric;
  }
  const base=finalMetric;
  const importance={};
  for(let j=0;j<cols.length;j++){
    const perm=testX.map(r=>r.slice());for(let i=perm.length-1;i>0;i--){const k=Math.floor((i+1)*0.37)% (i+1);const tmp=perm[i][j];perm[i][j]=perm[k][j];perm[k][j]=tmp;}
    const pred=Array.from(await model.predict(tf.tensor2d(normalizeRows(perm,means,stds))).dataSync());
    let metric;
    if(targetType==="number"){const y=testY,mse=pred.reduce((a,v,i)=>a+(v-y[i])**2,0)/y.length,ym=y.reduce((a,v)=>a+v,0)/y.length,tss=y.reduce((a,v)=>a+(v-ym)**2,0);metric=tss>0?1-(mse*y.length)/tss:0;}
    else {const p=pred.map(v=>v>=.5?1:0);metric=p.reduce((a,v,i)=>a+(v===testY[i]?1:0),0)/p.length;}
    importance[cols[j].name]=Math.max(0,base-metric);
  }
  const sum=Object.values(importance).reduce((a,v)=>a+Number(v),0)||1;for(const k of Object.keys(importance))importance[k]=Number(importance[k])/sum;
  model.dispose();
  return {ok:true,result:{modelType:"TensorFlow.js MLP",task:targetType==="number"?"regression":"classification",score:base,scoreLabel:targetType==="number"?"holdout R²":"holdout accuracy",featureImportance:importance,notes:["Small local neural network trained entirely in the browser.","Feature importance is permutation-based sensitivity, not causal importance.","Use the neural result as supporting predictive evidence, not as proof of causation."]}};
}
self.onmessage=async e=>{try{self.postMessage(await run(e.data));}catch(err){self.postMessage({ok:false,reason:err instanceof Error?err.message:String(err)})}};
