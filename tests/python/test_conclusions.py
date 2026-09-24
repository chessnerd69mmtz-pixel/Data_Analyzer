import sys,json
sys.path.insert(0,"public/python")
from conclusion_engine import build_conclusions

def make_dataset():
    rows=[]
    for i in range(120):
        x=float(i)
        z=float((i*7)%19)
        y=2*x+0.5*z
        rows.append([x,z,y,"A" if i%2==0 else "B"])
    return {
      "datasetId":"conclusion-test",
      "columns":[
        {"name":"FactorX","type":"number"},
        {"name":"FactorZ","type":"number"},
        {"name":"Target","type":"number"},
        {"name":"Group","type":"string"}
      ],
      "rows":rows
    }

def test_user_focus_and_discovery():
    p={
      "targetColumn":"Target",
      "groupingColumns":["Group"],
      "selectedColumns":["FactorX","FactorZ"],
      "columnSelectionMode":"include",
      "rowFilters":[],
      "confidenceLevel":0.95,
      "analysisType":"correlation",
      "missingDataHandling":"drop",
      "userFocusFactors":["FactorX"],
      "conclusionQuestion":"Which factors matter most?",
      "scanOtherFactors":True,
      "conclusionDepth":"standard",
      "robustnessResamples":100
    }
    out=build_conclusions(make_dataset(),p,[])
    assert out["userFocusFactors"]==["FactorX"]
    assert any(x["factor"]=="FactorX" and x["priority"]=="user-focus" for x in out["conclusions"])
    assert any(x["factor"]=="FactorZ" and x["priority"]=="discovered" for x in out["conclusions"])

def test_focus_is_not_the_only_scan():
    p={
      "targetColumn":"Target","groupingColumns":[],"selectedColumns":["FactorX"],
      "columnSelectionMode":"include","rowFilters":[],"confidenceLevel":0.95,
      "analysisType":"correlation","missingDataHandling":"drop","userFocusFactors":["FactorX"],
      "scanOtherFactors":False,"conclusionDepth":"standard","robustnessResamples":50
    }
    out=build_conclusions(make_dataset(),p,[])
    assert all(x["factor"]=="FactorX" for x in out["conclusions"])
