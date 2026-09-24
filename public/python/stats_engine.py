from conclusion_engine import build_conclusions
import json,math
import numpy as np,pandas as pd
from scipy import stats
from sklearn.ensemble import RandomForestClassifier,RandomForestRegressor,IsolationForest
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.model_selection import KFold,StratifiedKFold,cross_val_score
from sklearn.inspection import permutation_importance
from statsmodels.stats.multitest import multipletests
import statsmodels.api as sm

ALPHA={0.9:0.1,0.95:0.05,0.99:0.01}
def finite(x):
 try:
  x=float(x);return x if math.isfinite(x) else None
 except:return None
def clean(x):
 if isinstance(x,dict):return {str(k):clean(v) for k,v in x.items()}
 if isinstance(x,(list,tuple)):return [clean(v) for v in x]
 if isinstance(x,(float,np.floating)):return finite(x)
 if isinstance(x,(int,np.integer)):return int(x)
 return x
def frame(dataset):
 cols=[c['name'] for c in dataset['columns']];df=pd.DataFrame(dataset['rows'],columns=cols);types={c['name']:c['type'] for c in dataset['columns']}
 for c,t in types.items():
  if t=='number':df[c]=pd.to_numeric(df[c],errors='coerce')
  elif t=='date':df[c]=pd.to_datetime(df[c],errors='coerce')
  elif t=='boolean':df[c]=df[c].map(lambda v: True if str(v).lower()=='true' else False if str(v).lower()=='false' else np.nan)
  else:df[c]=df[c].map(lambda v: np.nan if v is None or (isinstance(v,str) and not v.strip()) else v)
 return df,types
def filters(df,types,fs):
 for f in fs or []:
  c,o,v=f['column'],f['operator'],f.get('value','')
  if c not in df:return df.iloc[0:0]
  s=df[c]
  if o=='isBlank':df=df[s.isna()|(s.astype(str).str.strip()=='')];continue
  if o=='isNotBlank':df=df[~(s.isna()|(s.astype(str).str.strip()==''))];continue
  if types.get(c)=='number':
   q=pd.to_numeric(pd.Series([v]),errors='coerce').iloc[0]
   if pd.isna(q):return df.iloc[0:0]
   masks={'=':s==q,'!=':s!=q,'>':s>q,'>=':s>=q,'<':s<q,'<=':s<=q};df=df[masks[o]]
  else:
   z=s.astype(str);vv=str(v);masks={'=':z==vv,'!=':z!=vv,'contains':z.str.contains(vv,case=False,na=False),'startsWith':z.str.startswith(vv,na=False),'endsWith':z.str.endswith(vv,na=False)};df=df[masks[o]]
 return df
def selected(p,cols):
 s=p.get('selectedColumns') or []
 return [c for c in cols if c not in s] if p.get('columnSelectionMode')=='exclude' else s
def base(p,did,atype,test,target,n,label,stat,pv,el,ev,caveats=None,**kw):
 return {'resultId':f'{atype}_{abs(hash((did,test,target,n)))%10000000000}','inputDatasetId':did,'analysisType':atype,'testUsed':test,'targetColumn':target,'n':int(n),'statistic':float(stat),'statisticLabel':label,'pValue':float(pv),'effectSize':float(ev),'effectSizeLabel':el,'confidenceLevel':p.get('confidenceLevel',0.95),'significant':False,'caveats':caveats or [],**kw}
def prepare(dataset,p):
 df,types=frame(dataset);start=len(df);df=filters(df,types,p.get('rowFilters'));after=len(df);target=p.get('targetColumn');features=selected(p,[c['name'] for c in dataset['columns']]);cols=list(dict.fromkeys([target,*p.get('groupingColumns',[]),p.get('timeColumn'),*features]));cols=[c for c in cols if c]
 missing=int(df[cols].isna().sum().sum()) if cols else 0
 if p.get('missingDataHandling') in ('mean','median'):
  for c in cols:
   if types.get(c)=='number':
    val=df[c].mean() if p['missingDataHandling']=='mean' else df[c].median();df[c]=df[c].fillna(val)
 return df.dropna(subset=cols),df,start,after,missing,types
def corr(df,types,features,p,did):
 t=p['targetColumn'];out=[]
 if types.get(t)!='number':return out
 for c in features:
  if c==t or types.get(c)!='number':continue
  sub=df[[t,c]].dropna()
  if len(sub)<30 or sub[t].nunique()<2 or sub[c].nunique()<2:continue
  x,y=sub[t].to_numpy(float),sub[c].to_numpy(float)
  try:
   rp=stats.shapiro(x)[1] if len(x)<=5000 else 1;rq=stats.shapiro(y)[1] if len(y)<=5000 else 1
   if rp>=ALPHA[p['confidenceLevel']] and rq>=ALPHA[p['confidenceLevel']]:method='Pearson correlation';r,pv=stats.pearsonr(x,y)
   else:method='Spearman rank correlation';r,pv=stats.spearmanr(x,y)
   out.append(base(p,did,'correlation',method,t,len(sub),'r',r,pv,'correlation coefficient',r,caveats=['Association does not establish causation.'],comparisonColumns=[c],direction='positive' if r>0 else 'negative',dataPoints=[{'x':float(a),'y':float(b)} for a,b in zip(x[:500],y[:500])]))
  except Exception:pass
 return out
def groups(df,types,p,did):
 t=p['targetColumn'];gs=p.get('groupingColumns') or []
 if not gs:return []
 gcol=gs[0];d=df[[t,gcol]].dropna()
 if types.get(t)=='number':
  levels=list(pd.unique(d[gcol]));arr=[d.loc[d[gcol]==g,t].to_numpy(float) for g in levels];arr=[a for a in arr if len(a)>=2]
  if len(arr)<2:return []
  if len(arr)==2:
   st,pv=stats.ttest_ind(arr[0],arr[1],equal_var=False);pooled=math.sqrt(((len(arr[0])-1)*arr[0].var(ddof=1)+(len(arr[1])-1)*arr[1].var(ddof=1))/(len(arr[0])+len(arr[1])-2));ev=(arr[0].mean()-arr[1].mean())/pooled if pooled else 0;test='Welch t-test';label='t'
  else:
   st,pv=stats.f_oneway(*arr);ev=float(st);test='One-way ANOVA';label='F'
  return [base(p,did,'group-comparison',test,t,len(d),label,st,pv,'effect size',ev,groups=[{'name':str(g),'n':int((d[gcol]==g).sum()),'mean':float(d.loc[d[gcol]==g,t].mean()),'median':float(d.loc[d[gcol]==g,t].median())} for g in levels],groupingColumn=gcol,caveats=['Group differences do not establish causation.'])]
 tab=pd.crosstab(d[gcol],d[t]);chi,pv,_,_=stats.chi2_contingency(tab);n=int(tab.to_numpy().sum());v=math.sqrt(chi/max(n*max(1,min(tab.shape)-1),1))
 return [base(p,did,'group-comparison','Chi-square independence',t,n,'chi-square',chi,pv,"Cramer's V",v,groupingColumn=gcol)]
def trend(df,types,p,did):
 t,tc=p['targetColumn'],p.get('timeColumn')
 if not tc or types.get(t)!='number':return []
 d=df[[t,tc]].dropna()
 if len(d)<30:return []
 x=pd.to_datetime(d[tc],errors='coerce') if types.get(tc)=='date' else pd.to_numeric(d[tc],errors='coerce');ok=~pd.isna(x);d=d.loc[ok];x=x.loc[ok];y=d[t].to_numpy(float)
 if types.get(tc)=='date':x=np.array([(v-x.iloc[0]).days for v in x])
 else:x=np.array(x,float)
 if len(np.unique(x))<3:return []
 s=stats.linregress(x,y)
 return [base(p,did,'trend','Linear regression trend',t,len(d),'slope',s.slope,s.pvalue,'R-squared',s.rvalue**2,direction='increasing' if s.slope>0 else 'decreasing',timeColumn=tc,confidenceInterval=[s.slope-1.96*s.stderr,s.slope+1.96*s.stderr] if s.stderr is not None else None,dataPoints=[{'x':float(a),'y':float(b)} for a,b in zip(x[:500],y[:500])])]
def outliers(df,types,p,did):
 t=p['targetColumn']
 if types.get(t)!='number':return []
 s=df[t].dropna().astype(float);n=len(s)
 if n<30 or s.std(ddof=1)==0:return []
 z=(s-s.mean())/s.std(ddof=1);idx=int(np.argmax(np.abs(z)));zv=abs(float(z.iloc[idx]));pv=float(min(1,2*stats.norm.sf(zv)))
 return [base(p,did,'outliers','Extreme z-score screen',t,n,'absolute z-score',zv,pv,'absolute z-score',zv,dataPoints=[{'index':i,'value':float(v),'isCandidate':i==idx} for i,v in enumerate(s.iloc[:500])])]
def feature_importance(df,types,features,p,did):
 t=p['targetColumn'];d=df[[t,*features]].dropna();X=pd.get_dummies(d[features],drop_first=True);y=d[t]
 if len(d)<30 or X.shape[1]==0:return []
 if types.get(t)=='number':
  model=RandomForestRegressor(n_estimators=120,random_state=42,n_jobs=1);score=float(np.mean(cross_val_score(model,X,y,cv=KFold(5,shuffle=True,random_state=42),scoring='r2')));model.fit(X,y);perm=permutation_importance(model,X,y,n_repeats=20,random_state=42,n_jobs=1,scoring='r2');lab='CV R-squared'
 else:
  model=RandomForestClassifier(n_estimators=120,random_state=42,class_weight='balanced',n_jobs=1);score=float(np.mean(cross_val_score(model,X,y,cv=StratifiedKFold(5,shuffle=True,random_state=42),scoring='balanced_accuracy')));model.fit(X,y);perm=permutation_importance(model,X,y,n_repeats=20,random_state=42,n_jobs=1,scoring='balanced_accuracy');lab='CV balanced accuracy'
 agg={}
 for name,val in zip(X.columns,perm.importances_mean):agg[name.split('_')[0]]=agg.get(name.split('_')[0],0)+float(val)
 top=sorted(agg.items(),key=lambda x:x[1],reverse=True)
 return [base(p,did,'feature-importance','Random Forest permutation importance',t,len(d),lab,score,'permutation importance',top[0][1] if top else 0,crossValidatedScore=score,crossValidatedScoreLabel=lab,dataPoints=[{'label':k,'value':v} for k,v in top[:20]],caveats=['Predictive importance is not causal evidence.'])]
def descriptive(df,types,features,p,did):
 out=[]
 for c in features:
  s=df[c].dropna();n=len(s)
  if not n:continue
  if types.get(c)=='number':
   stat=float(s.mean());ev=float(s.std(ddof=1)) if n>1 else 0;label='mean';el='standard deviation';pts=[{'label':'mean','value':stat},{'label':'median','value':float(s.median())},{'label':'min','value':float(s.min())},{'label':'max','value':float(s.max())}]
  else:stat=float(s.nunique());ev=0;label='unique count';el='n/a';pts=[{'label':'unique','value':int(s.nunique())}]
  out.append(base(p,did,'descriptive','Descriptive statistics',c,n,label,stat,0,el,ev,dataPoints=pts))
 return out
def normality(df,types,features,p,did):
 out=[]
 for c in features:
  if types.get(c)!='number':continue
  s=df[c].dropna().astype(float);n=len(s)
  if n<30:continue
  sample=s.sample(min(n,5000),random_state=42);w,pv=stats.shapiro(sample)
  out.append(base(p,did,'normality','Shapiro-Wilk normality test',c,n,'W',w,pv,'absolute deviation from normal',abs(1-w)))
 return out
def regression(df,types,features,p,did):
 t=p['targetColumn'];feats=[c for c in features if c!=t and types.get(c) in ('number','boolean')]
 if types.get(t)!='number' or not feats:return []
 d=df[[t,*feats]].dropna();X=pd.get_dummies(d[feats],drop_first=True,dtype=float);X=sm.add_constant(X);m=sm.OLS(d[t].astype(float),X).fit();params=m.params.drop('const');best=str(params.abs().idxmax()) if len(params) else t;ev=float(params.get(best,0))
 return [base(p,did,'regression','Multiple OLS regression',t,len(d),'R-squared',m.rsquared,float(m.f_pvalue),'absolute coefficient',abs(ev),comparisonColumns=[best],dataPoints=[{'label':k,'value':float(v)} for k,v in params.items()],caveats=['Inspect regression assumptions before causal interpretation.'])]
def clustering(df,types,features,p,did):
 nums=[c for c in features if types.get(c)=='number'];d=df[nums].dropna()
 if len(d)<30 or len(nums)<2:return []
 X=(d-d.mean())/d.std(ddof=0);best=None
 for k in range(2,min(6,len(X)-1)+1):
  km=KMeans(n_clusters=k,random_state=42,n_init=10).fit(X);sil=float(silhouette_score(X,km.labels_))
  if best is None or sil>best[0]:best=(sil,k)
 if not best:return []
 return [base(p,did,'clustering','K-means clustering',p['targetColumn'],len(d),'silhouette',best[0],0,'silhouette score',best[0],dataPoints=[{'label':str(best[1]),'value':best[0]}],caveats=['Clusters are exploratory and depend on selected features and scaling.'])]
def anomaly(df,types,features,p,did):
 nums=[c for c in features if types.get(c)=='number'];d=df[nums].dropna()
 if len(d)<30 or not nums:return []
 m=IsolationForest(n_estimators=150,random_state=42,contamination='auto').fit(d);scores=-m.score_samples(d);mx=float(scores.max())
 return [base(p,did,'anomaly-detection','Isolation Forest anomaly detection',p['targetColumn'],len(d),'maximum anomaly score',mx,0,'maximum anomaly score',mx,dataPoints=[{'label':str(i),'value':float(v)} for i,v in enumerate(np.sort(scores)[-20:][::-1])])]
def analyze(dataset,p):
 did=dataset['datasetId'];df,raw,start,after,missing,types=prepare(dataset,p);features=[c for c in selected(p,[x['name'] for x in dataset['columns']]) if c in df.columns];kind=p['analysisType'];r=[]
 if kind=='correlation':r=corr(df,types,features,p,did)
 elif kind=='group-comparison':r=groups(df,types,p,did)
 elif kind=='trend':r=trend(df,types,p,did)
 elif kind=='outliers':r=outliers(df,types,p,did)
 elif kind=='feature-importance':r=feature_importance(df,types,features,p,did)
 elif kind=='descriptive':r=descriptive(df,types,features,p,did)
 elif kind=='normality':r=normality(df,types,features,p,did)
 elif kind=='regression':r=regression(df,types,features,p,did)
 elif kind=='clustering':r=clustering(df,types,features,p,did)
 elif kind=='anomaly-detection':r=anomaly(df,types,features,p,did)
 if r:
  adj=multipletests([x['pValue'] for x in r],alpha=ALPHA[p['confidenceLevel']],method='fdr_bh')[1]
  for x,a in zip(r,adj):x['adjustedPValue']=float(a);x['significant']=bool(a<ALPHA[p['confidenceLevel']])
 summary={'inputRows':start,'rowsAfterFilters':after,'rowsRemovedByFilters':start-after,'rowsRemovedForMissing':after-len(df),'finalRows':len(df),'columns':len(dataset['columns']),'columnTypes':[{'name':c['name'],'type':types[c['name']],'missing':int(raw[c['name']].isna().sum())} for c in dataset['columns']],'missingBeforeHandling':missing,'missingBeforeHandlingByColumn':[{'name':c,'missing':int(raw[c].isna().sum())} for c in features]}
 conclusion=build_conclusions(dataset,p,r)
 return {'results':clean(r),'dataSummary':clean(summary),'parameters':p,'messages':[],'failedChecks':[] if r else ['The selected analysis did not have enough compatible data to produce a result.'],'multipleTesting':{'applied':bool(r),'method':'Benjamini-Hochberg FDR','numberOfTests':len(r)},'conclusions':clean(conclusion)}
def main(payload_json):
 payload=json.loads(payload_json);return json.dumps(clean(analyze(payload['dataset'],payload['parameters'])))
