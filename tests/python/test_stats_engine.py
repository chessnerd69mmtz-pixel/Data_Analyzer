import sys
sys.path.insert(0, "public/python")
import stats_engine

def dataset():
    return {
        "datasetId": "test",
        "columns": [
            {"name": "x", "originalName": "x", "type": "number"},
            {"name": "y", "originalName": "y", "type": "number"},
        ],
        "rows": [[i, 2*i+1] for i in range(1, 41)],
    }

def params(kind):
    return {
        "targetColumn": "y",
        "groupingColumns": [],
        "columnSelectionMode": "include",
        "selectedColumns": ["x"],
        "rowFilters": [],
        "confidenceLevel": 0.95,
        "analysisType": kind,
        "missingDataHandling": "drop",
    }

def test_core_modes():
    assert stats_engine.analyze(dataset(), params("correlation"))["results"]
    assert stats_engine.analyze(dataset(), params("regression"))["results"]
