import math
import numpy as np,pandas as pd
from scipy import stats
from sklearn.feature_selection import mutual_info_regression,mutual_info_classif
from sklearn.ensemble import ExtraTreesRegressor,ExtraTreesClassifier,RandomForestRegressor,RandomForestClassifier
from sklearn.model_selection import KFold,StratifiedKFold,cross_val_score
import statsmodels.api as sm

ALPHA={0.9:0.1,0.95:0.05,0.99:0.01}

def _corr_power(r,n,alpha=0.05):
    try:
        r=abs(float(r));n=int(n)
        if n<4:return None
        if r>=0.999:return 1.0
        z=math.sqrt(max(1e-12,n-3))*abs(np.arctanh(r))
        crit=stats.norm.ppf(1-alpha/2)
        return float(max(0,min(1,1-stats.norm.cdf(crit-z)+stats.norm.cdf(-crit-z))))
    except:return None

def _num(v):
    try:
        x=float(v)
        return x if math.isfinite(x) else None
    except:
        return None

def _frame(dataset):
    cols=[c["name"] for c in dataset["columns"]]
    df=pd.DataFrame(dataset["rows"],columns=cols)
    types={c["name"]:c["type"] for c in dataset["columns"]}
    for c,t in types.items():
        if t=="number": df[c]=pd.to_numeric(df[c],errors="coerce")
        elif t=="date": df[c]=pd.to_datetime(df[c],errors="coerce")
        elif t=="boolean": df[c]=df[c].map(lambda x: True if str(x).lower()=="true" else False if str(x).lower()=="false" else np.nan)
        else: df[c]=df[c].map(lambda x: np.nan if x is None or (isinstance(x,str) and not x.strip()) else x)
    return df,types

def _effect_label(v):
    a=abs(float(v))
    if a>=0.5:return "large"
    if a>=0.3:return "moderate"
    if a>=0.1:return "small"
    return "very-small"

def _strength(adjp,robust,checks,focus=False):
    if adjp is None:return "inconclusive"
    fails=sum(1 for c in checks if c["status"]=="fail")
    warns=sum(1 for c in checks if c["status"]=="warning")
    if fails:return "weak"
    if adjp<0.001 and robust>=0.9 and warns<=1:return "very-strong"
    if adjp<ALPHA[0.95] and robust>=0.75 and warns<=2:return "strong"
    if adjp<ALPHA[0.95] and robust>=0.5:return "moderate"
    return "weak"

def _bootstrap_corr(x,y,resamples,rng):
    vals=[]
    n=len(x)
    if n<30:return 0.0,None
    take=max(100,min(int(resamples),1000))
    for _ in range(take):
        idx=rng.integers(0,n,n)
        try:
            r=stats.spearmanr(x[idx],y[idx]).statistic
            if np.isfinite(r):vals.append(float(r))
        except:pass
    if not vals:return 0.0,None
    arr=np.asarray(vals,float)
    lo,hi=np.quantile(arr,[0.025,0.975])
    baseline=float(np.mean(np.sign(arr)==np.sign(np.median(arr))))
    return baseline,(float(lo),float(hi))

def _permutation_corr(x,y,resamples,rng):
    observed=abs(float(stats.spearmanr(x,y).statistic))
    n=len(x)
    if n<30:return 1.0
    count=0;take=max(100,min(int(resamples),1000))
    for _ in range(take):
        perm=rng.permutation(y)
        try:
            rv=abs(float(stats.spearmanr(x,perm).statistic))
            count+=rv>=observed
        except:pass
    return float((count+1)/(take+1))

def _numeric_factor(df,target,factor,p,res,res_ids,rng):
    d=df[[target,factor]].dropna()
    checks=[]
    if len(d)<30 or d[target].nunique()<2 or d[factor].nunique()<2:
        return None
    x=d[factor].to_numpy(float);y=d[target].to_numpy(float)
    pear=float(stats.pearsonr(x,y).statistic);pp=float(stats.pearsonr(x,y).pvalue)
    spear=float(stats.spearmanr(x,y).statistic);sp=float(stats.spearmanr(x,y).pvalue)
    normal_ok=True
    try:
        if len(x)<=5000:
            normal_ok=bool(stats.shapiro(x).pvalue>=ALPHA[p.get("confidenceLevel",0.95)] and stats.shapiro(y).pvalue>=ALPHA[p.get("confidenceLevel",0.95)])
    except: normal_ok=True
    method_r=spear if (not normal_ok or abs(spear-pear)>0.15) else pear
    method_p=sp if (not normal_ok or abs(spear-pear)>0.15) else pp
    robust,ci=_bootstrap_corr(x,y,p.get("robustnessResamples",300),rng)
    perm_p=_permutation_corr(x,y,p.get("robustnessResamples",300),rng)
    checks.append({"name":"Parametric/rank agreement","status":"pass" if abs(pear-spear)<0.15 else "warning","detail":f"Pearson r={pear:.3f}; Spearman rho={spear:.3f}."})
    checks.append({"name":"Bootstrap stability","status":"pass" if robust>=0.8 else "warning" if robust>=0.55 else "fail","detail":f"{robust*100:.1f}% of bootstrap estimates preserved the dominant direction.","value":robust})
    checks.append({"name":"Permutation test","status":"pass" if perm_p<0.05 else "warning","detail":f"Permutation p={perm_p:.4f}.","value":perm_p})
    power=_corr_power(method_r,len(d),ALPHA.get(p.get("confidenceLevel",0.95),0.05))
    checks.append({"name":"Observed-effect power screen","status":"pass" if (power or 0)>=0.8 else "warning","detail":f"Approximate power for the observed correlation={power:.3f}." if power is not None else "Power could not be estimated.","value":power})
    unique_ratio=d[factor].nunique()/max(len(d),1)
    leakage=False
    lname=(factor+" "+target).lower()
    if unique_ratio>0.98 or abs(method_r)>0.995 or any(k in factor.lower() for k in ["future","post","outcome","label","target"]):
        leakage=True
        checks.append({"name":"Potential target leakage","status":"warning","detail":"The factor may encode an identifier, post-outcome information, or an almost exact target transformation."})
    else:
        checks.append({"name":"Potential target leakage","status":"pass","detail":"No simple leakage heuristic was triggered."})
    # partial regression against a small set of numeric covariates
    candidates=[c for c in df.columns if c not in [target,factor] and pd.api.types.is_numeric_dtype(df[c])]
    conf=[]
    for c in candidates:
        z=df[[target,factor,c]].dropna()
        if len(z)>=30 and z[c].nunique()>1:
            try:
                rr=abs(float(stats.spearmanr(z[c],z[target]).statistic))
                rc=abs(float(stats.spearmanr(z[c],z[factor]).statistic))
                if rr>=0.25 and rc>=0.25:conf.append((rr*rc,c))
            except:pass
    conf=[x[1] for x in sorted(conf,reverse=True)[:5]]
    partial=None
    if conf:
        z=df[[target,factor,*conf]].dropna()
        if len(z)>=30:
            try:
                X=sm.add_constant(z[[factor,*conf]])
                m=sm.OLS(z[target].astype(float),X).fit()
                coef=float(m.params[factor]);pv=float(m.pvalues[factor]);partial=float(stats.pearsonr(z[factor],m.resid + coef*z[factor])[0])
                checks.append({"name":"Confounder-adjusted regression","status":"pass" if pv<0.05 else "warning","detail":f"Adjusted coefficient={coef:.4g}; p={pv:.4g}; candidate covariates: {', '.join(conf)}."})
            except Exception: pass
    else:
        checks.append({"name":"Confounder screen","status":"not-run","detail":"No numeric candidate confounder met the screening threshold."})
    # nonlinear signal through mutual information
    mi=0.0
    try:
        mi=float(mutual_info_regression(x.reshape(-1,1),y,random_state=42)[0])
    except:pass
    nonlinear=mi>0.05 and abs(method_r)<0.25
    if nonlinear:checks.append({"name":"Nonlinear relationship screen","status":"warning","detail":f"Mutual information={mi:.3f} suggests structure not fully represented by correlation.","value":mi})
    else:checks.append({"name":"Nonlinear relationship screen","status":"pass","detail":f"Mutual information={mi:.3f}.","value":mi})
    matches=[r for r in res if r.get("comparisonColumns") and factor in r.get("comparisonColumns",[])]
    ids=[r.get("resultId") for r in matches if r.get("resultId")]
    adj=min([float(r.get("adjustedPValue",r.get("pValue",1))) for r in matches],default=float(method_p))
    if not matches:
        adj=method_p
    direction="positive" if method_r>0 else "negative" if method_r<0 else "none"
    caveats=["Association does not establish causation."]
    alternatives=[]
    if conf: alternatives.append("Other variables are associated with both the factor and target and may partly explain the relationship.")
    if nonlinear: alternatives.append("The relationship may be nonlinear.")
    if leakage: alternatives.append("Potential target leakage should be investigated before treating predictive evidence as trustworthy.")
    if abs(pear-spear)>=0.15: alternatives.append("Pearson and Spearman disagree materially, suggesting sensitivity to distribution or influential observations.")
    strength=_strength(adj,robust,checks)
    return {"factor":factor,"checks":checks,"effect":method_r,"effectLabel":"correlation coefficient","ci":ci,"adjp":adj,"robust":robust,"nonlinear":nonlinear,"mi":mi,"direction":direction,"strength":strength,"ids":ids,"caveats":caveats,"alternatives":alternatives,"method":"Pearson/Spearman + bootstrap + permutation + mutual information","p":method_p,"partial":partial}

def _categorical_factor(df,target,factor,p,res_ids):
    d=df[[target,factor]].dropna()
    if len(d)<30 or d[factor].nunique()<2:return None
    levels=d[factor].astype(str).value_counts()
    levels=levels[levels>=5].index.tolist()
    if len(levels)<2:return None
    d=d[d[factor].astype(str).isin(levels)]
    checks=[];groups=[d.loc[d[factor].astype(str)==g,target].to_numpy(float) for g in levels]
    groups=[g for g in groups if len(g)>=5]
    if len(groups)<2:return None
    if len(groups)==2:
        stat,pv=stats.ttest_ind(groups[0],groups[1],equal_var=False);a,b=groups
        pooled=math.sqrt(((len(a)-1)*a.var(ddof=1)+(len(b)-1)*b.var(ddof=1))/max(1,len(a)+len(b)-2))
        effect=float((a.mean()-b.mean())/pooled) if pooled else 0.0
        test="Welch t-test"
    else:
        stat,pv=stats.f_oneway(*groups);allv=np.concatenate(groups);grand=allv.mean()
        ssb=sum(len(g)*(g.mean()-grand)**2 for g in groups);sst=sum(((g-grand)**2).sum() for g in groups)
        effect=float(ssb/sst) if sst else 0.0;test="One-way ANOVA"
    # robust group resampling by sampling within groups
    rng=np.random.default_rng(42);take=max(100,min(int(p.get("robustnessResamples",300)),1000));keep=0
    base_sign=np.sign(effect)
    for _ in range(take):
        try:
            bs=[g[rng.integers(0,len(g),len(g))] for g in groups]
            if len(bs)==2:
                diff=float(np.mean(bs[0])-np.mean(bs[1]));keep+=int(np.sign(diff)==base_sign or base_sign==0)
            else:
                st,_=stats.f_oneway(*bs);keep+=int(st>=stat)
        except:pass
    robust=keep/max(take,1)
    checks.append({"name":"Bootstrap/group resampling stability","status":"pass" if robust>=0.8 else "warning" if robust>=0.55 else "fail","detail":f"Bootstrap stability={robust*100:.1f}%.","value":robust})
    unequal=max(len(g) for g in groups)/max(1,min(len(g) for g in groups))
    checks.append({"name":"Group balance","status":"pass" if unequal<=3 else "warning","detail":f"Largest/smallest group ratio={unequal:.2f}."})
    mi=0.0
    try:
        codes=pd.Categorical(d[factor].astype(str)).codes
        mi=float(mutual_info_regression(codes.reshape(-1,1),d[target].to_numpy(float),random_state=42)[0])
    except:pass
    checks.append({"name":"Mutual information","status":"pass","detail":f"MI={mi:.3f}.","value":mi})
    if len(groups)==2:direction="higher-groups" if groups[0].mean()>groups[1].mean() else "lower-groups"
    else:direction="mixed"
    caveats=["Group differences do not establish causation."]
    alternatives=[]
    if unequal>3:alternatives.append("Unequal group sizes may reduce precision for the smaller group.")
    if mi>0.1:alternatives.append("The factor contains predictive information beyond a simple mean comparison.")
    matches=[r for r in res if r.get("groupingColumn")==factor]
    ids=[r.get("resultId") for r in matches if r.get("resultId")]
    adj=min([float(r.get("adjustedPValue",r.get("pValue",1))) for r in matches],default=float(pv))
    return {"factor":factor,"checks":checks,"effect":effect,"effectLabel":"standardized group effect" if len(groups)==2 else "eta-squared","ci":None,"adjp":adj,"robust":robust,"nonlinear":False,"mi":mi,"direction":direction,"strength":_strength(adj,robust,checks),"ids":ids,"caveats":caveats,"alternatives":alternatives,"method":test,"p":float(pv)}

def _simpson_screen(df,target,factor):
    if df[factor].dtype.kind not in "biufc" and df[factor].nunique()>20:return None
    cats=[c for c in df.columns if c not in [target,factor] and df[c].dtype=="object" and 2<=df[c].nunique()<=8]
    for c in cats[:8]:
        d=df[[target,factor,c]].dropna()
        if len(d)<60:continue
        try:
            overall=float(stats.spearmanr(d[factor],d[target]).statistic)
            signs=[]
            for _,g in d.groupby(c):
                if len(g)>=20:signs.append(np.sign(float(stats.spearmanr(g[factor],g[target]).statistic)))
            if len(signs)>=2 and np.sign(overall)!=0 and any(s!=0 and s!=np.sign(overall) for s in signs):
                return c
        except:pass
    return None

def _model_benchmark(df,target,features):
    if len(features)<1 or len(df)<80:return None
    try:
        d=df[[target,*features]].dropna();X=pd.get_dummies(d[features],drop_first=True,dtype=float)
        if X.shape[1]==0:return None
        y=d[target];models={}
        if pd.api.types.is_numeric_dtype(y):
            y=y.astype(float);cv=KFold(5,shuffle=True,random_state=42)
            for name,m in [("ExtraTrees",ExtraTreesRegressor(n_estimators=100,random_state=42,n_jobs=1)),("RandomForest",RandomForestRegressor(n_estimators=100,random_state=42,n_jobs=1))]:
                models[name]=float(np.mean(cross_val_score(m,X,y,cv=cv,scoring="r2")))
        elif y.nunique()==2:
            yy=pd.Categorical(y).codes;cv=StratifiedKFold(5,shuffle=True,random_state=42)
            for name,m in [("ExtraTrees",ExtraTreesClassifier(n_estimators=100,random_state=42,class_weight="balanced",n_jobs=1)),("RandomForest",RandomForestClassifier(n_estimators=100,random_state=42,class_weight="balanced",n_jobs=1))]:
                models[name]=float(np.mean(cross_val_score(m,X,yy,cv=cv,scoring="balanced_accuracy")))
        else:return None
        return models
    except:return None

def build_conclusions(dataset,p,results):
    df,types=_frame(dataset);target=p.get("targetColumn")
    if target not in df:return {"question":p.get("conclusionQuestion"),"userFocusFactors":p.get("userFocusFactors",[]),"discoveredFactors":[],"conclusions":[],"overallMessages":["The requested target column is not present."]}
    focus=[f for f in (p.get("userFocusFactors") or []) if f in df.columns and f!=target]
    all_candidates=[c for c in df.columns if c!=target]
    ordered=[]
    for f in focus:
        if f not in ordered:ordered.append(f)
    if p.get("scanOtherFactors",True):
        others=[c for c in all_candidates if c not in ordered]
        # Use all eligible factors but keep the expensive checks bounded by type-compatible columns.
        ordered.extend(others)
    rng=np.random.default_rng(42);records=[]
    # First-pass numeric and categorical evidence
    user_set=set(focus)
    for f in ordered:
        local_p=dict(p)
        if f not in user_set:
            local_p["robustnessResamples"]=min(int(p.get("robustnessResamples",300)),100)
        depth=p.get("conclusionDepth","standard")
        if depth=="standard": local_p["robustnessResamples"]=min(int(local_p.get("robustnessResamples",100)),100)
        elif depth=="deep": local_p["robustnessResamples"]=min(int(local_p.get("robustnessResamples",300)),600)
        else: local_p["robustnessResamples"]=min(int(local_p.get("robustnessResamples",1000)),1000)
        if types.get(f)=="number":
            rec=_numeric_factor(df,target,f,local_p,results,[],rng)
        elif types.get(target)=="number":
            rec=_categorical_factor(df,target,f,local_p,[])
        else:
            rec=None
            d=df[[target,f]].dropna()
            if len(d)>=30:
                try:
                    codes=pd.Categorical(d[f].astype(str)).codes
                    y=pd.Categorical(d[target].astype(str)).codes
                    mi=float(mutual_info_classif(codes.reshape(-1,1),y,random_state=42)[0])
                    rec={"factor":f,"checks":[{"name":"Categorical mutual information","status":"pass","detail":f"MI={mi:.3f}.","value":mi}],"effect":mi,"effectLabel":"mutual information","ci":None,"adjp":1-mi if mi<1 else 0,"robust":0.5,"nonlinear":False,"mi":mi,"direction":"mixed","strength":"moderate" if mi>0.1 else "weak","ids":[],"caveats":["Predictive association does not establish causation."],"alternatives":[],"method":"Mutual information","p":1-mi if mi<1 else 0}
                except:pass
        if rec:records.append(rec)
    # discover top factors by empirical evidence while preserving user priority
    user_set=set(focus)
    records.sort(key=lambda r:(0 if r["factor"] in user_set else 1,-abs(float(r.get("effect") or 0)),-float(r.get("adjp",1))))
    discovered=[r["factor"] for r in records if r["factor"] not in user_set]
    # approximate predictive benchmark
    feature_cols=[r["factor"] for r in records[:min(25,len(records))] if types.get(r["factor"]) in ("number","boolean","string")]
    X=df[feature_cols].copy() if feature_cols else pd.DataFrame()
    y=df[target]
    pred_importance={}
    if len(feature_cols)>=1 and len(df)>=50 and types.get(target)=="number":
        try:
            X=pd.get_dummies(X.astype(str) if any(types.get(c)=="string" for c in feature_cols) else X,drop_first=True,dtype=float)
            mask=~y.isna();X=X.loc[mask];yy=y.loc[mask].astype(float)
            if len(X)>=50 and X.shape[1]>0:
                model=ExtraTreesRegressor(n_estimators=160,random_state=42,n_jobs=1).fit(X,yy)
                imp=model.feature_importances_
                for name,val in zip(X.columns,imp): pred_importance[name.split("_")[0]]=pred_importance.get(name.split("_")[0],0)+float(val)
        except Exception:pass
    conclusions=[]
    for rec in records:
        factor=rec["factor"];checks=rec["checks"];pi=float(pred_importance.get(factor,0))
        if pi>0:
            checks.append({"name":"Predictive model importance","status":"pass","detail":f"ExtraTrees normalized importance contribution={pi:.3f}.","value":pi})
            rec["robust"]=min(1.0,0.7*rec["robust"]+0.3)
        else:
            checks.append({"name":"Predictive model importance","status":"not-run","detail":"No stable tree-model importance estimate was available for this factor."})
        simpson=_simpson_screen(df,target,factor)
        if p.get("timeColumn") and p.get("timeColumn") in df.columns:
            tc=p.get("timeColumn");z=df[[tc,target,factor]].dropna();drift_status="not-run";drift_detail="Not enough time-ordered observations."
            if len(z)>=40:
                try:
                    z=z.sort_values(tc);cut=max(10,len(z)//4);a=z[factor].iloc[:cut];b=z[factor].iloc[-cut:]
                    if types.get(factor)=="number":
                        pv=float(stats.ks_2samp(a.astype(float),b.astype(float)).pvalue);drift_status="warning" if pv<0.05 else "pass";drift_detail=f"Early-vs-late KS p={pv:.4f}."
                except Exception:pass
            checks.append({"name":"Time/distribution drift screen","status":drift_status,"detail":drift_detail})
        if simpson:
            checks.append({"name":"Subgroup sign-reversal screen","status":"warning","detail":f"Potential subgroup sign reversal detected when conditioning on {simpson}."})
            rec["alternatives"].append(f"The direction may change across {simpson} groups; possible aggregation paradox.")
        else:
            checks.append({"name":"Subgroup sign-reversal screen","status":"pass","detail":"No simple subgroup sign reversal was detected in the screened categorical variables."})
        practical="high" if abs(float(rec.get("effect") or 0))>=0.5 or pi>=0.2 else "moderate" if abs(float(rec.get("effect") or 0))>=0.3 or pi>=0.1 else "low"
        strength=rec["strength"]
        if rec["nonlinear"] and strength in ("weak","moderate"):strength="moderate"
        direction=rec["direction"]
        verb="is positively associated with" if direction=="positive" else "is negatively associated with" if direction=="negative" else "shows differences in" if direction in ("higher-groups","lower-groups") else "contains predictive information about"
        if strength=="very-strong":lead="Very strong evidence"
        elif strength=="strong":lead="Strong evidence"
        elif strength=="moderate":lead="Moderate evidence"
        elif strength=="weak":lead="Weak evidence"
        else:lead="Inconclusive evidence"
        conclusion=f"{lead}: {factor} {verb} {target}."
        if p.get("conclusionQuestion"):
            conclusion=conclusion+" Focus question: "+str(p["conclusionQuestion"])
        adjp=float(rec.get("adjp",1))
        robust=float(rec.get("robust",0))
        effect_abs=abs(float(rec.get("effect") or 0))
        warning_count=sum(1 for chk in checks if chk["status"]=="warning")
        fail_count=sum(1 for chk in checks if chk["status"]=="fail")
        power_values=[float(chk.get("value")) for chk in checks if chk["name"]=="Observed-effect power screen" and chk.get("value") is not None]
        power=max(power_values) if power_values else 0.0
        # Validity score is a transparent evidence-quality ranking, not a probability of truth.
        p_component=max(0.0,min(25.0,25.0*(-math.log10(max(adjp,1e-12)))/6.0))
        effect_component=max(0.0,min(20.0,effect_abs*40.0))
        robustness_component=20.0*max(0.0,min(1.0,robust))
        power_component=10.0*max(0.0,min(1.0,power))
        predictive_component=10.0*max(0.0,min(1.0,pi*5.0))
        warning_penalty=min(15.0,warning_count*3.0+fail_count*7.0)
        validity=round(max(0.0,min(100.0,p_component+effect_component+robustness_component+power_component+predictive_component-warning_penalty)),2)
        derivation=[
            f"Analyzed {len(df)} dataset rows against target '{target}' and factor '{factor}'.",
            f"Primary method: {rec['method']}.",
            f"Observed effect: {float(rec.get('effect') or 0):.4f} ({rec.get('effectLabel') or 'effect'}).",
            f"Adjusted p-value used for ranking: {adjp:.6g}.",
            f"Robustness stability: {robust*100:.1f}%."
        ]
        if power_values: derivation.append(f"Approximate observed-effect power: {power:.3f}.")
        if pi>0: derivation.append(f"Tree-model predictive importance: {pi*100:.1f}%.")
        if rec.get("ci"): derivation.append(f"Bootstrap 95% interval: [{rec['ci'][0]:.4f}, {rec['ci'][1]:.4f}].")
        if rec.get("ids"): derivation.append("Linked statistical result IDs: "+", ".join(rec["ids"])+".")
        selection=(f"Validity score {validity:.2f}/100 from significance, effect magnitude, robustness, power, predictive evidence, "
                   f"and explicit penalties for warning/fail checks. User priority was {str(factor in user_set).lower()}.")
        conclusions.append({
            "factor":factor,
            "priority":"user-focus" if factor in user_set else "discovered",
            "conclusion":conclusion,
            "evidenceStrength":strength,
            "practicalImportance":practical,
            "direction":direction,
            "tests":[rec["method"]],
            "checks":checks,
            "effectSize":float(rec.get("effect") or 0),
            "effectLabel":rec.get("effectLabel"),
            "confidenceInterval":rec.get("ci"),
            "adjustedPValue":adjp,
            "robustnessStability":robust,
            "predictiveImportance":pi,
            "caveats":rec["caveats"],
            "alternativeExplanations":rec["alternatives"],
            "supportingResultIds":rec["ids"],
            "validityScore":validity,
            "rank":0,
            "sampleSize":int(len(df[[target,factor]].dropna())),
            "targetColumn":target,
            "factorType":types.get(factor,"unknown"),
            "derivationSteps":derivation,
            "selectionRationale":selection
        })
    conclusions.sort(key=lambda c:(-c["validityScore"],0 if c["priority"]=="user-focus" else 1,c["factor"].lower()))
    conclusions=conclusions[:10]
    for rank,item in enumerate(conclusions,1):
        item["rank"]=rank
    benchmark=_model_benchmark(df,target,feature_cols)
    overall=[
        "User-selected factors were analyzed first and remain visible separately from automatically discovered factors.",
        "Additional factors are scanned when 'scanOtherFactors' is enabled.",
        "Predictive importance is not causal evidence.",
        "A non-significant result is not treated as proof of no effect."
    ]
    if benchmark: overall.append("Classical ML benchmark CV scores: "+", ".join(k+"="+f"{v:.3f}" for k,v in benchmark.items())+".")
    return {
        "question":p.get("conclusionQuestion"),
        "userFocusFactors":focus,
        "discoveredFactors":discovered,
        "conclusions":conclusions,
        "overallMessages":overall
    }
