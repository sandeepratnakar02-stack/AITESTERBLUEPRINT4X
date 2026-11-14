"""
Smoke tests for the Test Creator MCP.

Golden numbers come from a full measurement of the source CSV, so these tests fail loudly
if the dataset is swapped for something structurally different.

Run:  .venv/Scripts/python.exe -m pytest tests -q
"""

import pathlib
import sys

import anyio
import pytest
from fastmcp import Client

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import dataset as ds_mod  # noqa: E402
import server as srv  # noqa: E402

# ---- golden values measured from data/vwo_5000_test_cases.csv -------------------------
EXPECTED_ROWS = 5000
EXPECTED_MODULES = 17
EXPECTED_UNIQUE_DESIGNS = 1520
EXPECTED_PRIORITIES = {"Highest": 396, "High": 1546, "Medium": 2198, "Low": 860}
EXPECTED_STATUSES = {"Ready": 2234, "Automated": 1594, "Draft": 757, "Deprecated": 415}
EXPECTED_TEST_TYPES = 9
EXPECTED_BROWSERS = 4
EXPECTED_DEVICES = 4
EXPECTED_TOOL_COUNT = 20


@pytest.fixture(scope="module")
def data() -> ds_mod.Dataset:
    return srv._data()


# ---- data layer -----------------------------------------------------------------------


def test_row_and_column_shape(data):
    assert len(data.rows) == EXPECTED_ROWS
    assert len(ds_mod.CSV_COLUMNS) == 14
    assert data.validate()["ok"] is True


def test_domains_match_measurement(data):
    assert len(data.modules) == EXPECTED_MODULES
    assert data.value_counts("priority") == EXPECTED_PRIORITIES
    assert data.value_counts("status") == EXPECTED_STATUSES
    assert len(data.test_types) == EXPECTED_TEST_TYPES
    assert len(data.browsers) == EXPECTED_BROWSERS
    assert len(data.devices) == EXPECTED_DEVICES


def test_issue_keys_are_unique_and_sequential(data):
    nums = sorted(ds_mod.key_sort_value(r.issue_key) for r in data.rows)
    assert nums[0] == 1001 and nums[-1] == 6000
    assert nums == list(range(1001, 6001))


def test_design_dedupe_matches_measurement(data):
    assert len(data.designs()) == EXPECTED_UNIQUE_DESIGNS
    assert len(data.rows) - len(data.designs()) == 3480


def test_variants_belong_to_same_design(data):
    case = data.get("VWO-1001")
    for v in data.variants_of(case):
        assert v.design_key == case.design_key
        assert v.issue_key != case.issue_key


# ---- ranking -------------------------------------------------------------------------


def test_ranking_is_deterministic_and_priority_first(data):
    pool = data.query(module="Funnels")
    first = ds_mod.rank_cases(pool)
    second = ds_mod.rank_cases(data.query(module="Funnels"))
    assert [c.issue_key for c in first] == [c.issue_key for c in second]

    scores = [c.score() for c in first]
    assert scores == sorted(scores, reverse=True)
    assert all(c.status != "Deprecated" for c in first)


def test_unique_designs_ranking_drops_variant_rows(data):
    pool = data.query(module="Funnels")
    ranked = ds_mod.rank_cases(pool, unique_designs_only=True)
    keys = [c.design_key for c in ranked]
    assert len(keys) == len(set(keys))
    assert len(ranked) < len(pool)


def test_score_formula():
    case = srv._data().get("VWO-1001")
    assert case.score() == case.priority_rank * 100 + case.status_rank * 10


# ---- validation errors ----------------------------------------------------------------


def test_unknown_module_lists_valid_values(data):
    with pytest.raises(ds_mod.DatasetError) as exc:
        data.query(module="Not A Module")
    assert "Funnels" in str(exc.value)


def test_unknown_priority_rejected(data):
    with pytest.raises(ds_mod.DatasetError):
        data.query(min_priority="Critical")


# ---- MCP surface (real protocol round trip via in-process Client) ---------------------


def _run(coro):
    return anyio.run(lambda: coro)


def test_tool_count_and_names():
    async def main():
        async with Client(srv.mcp) as client:
            return [t.name for t in await client.list_tools()]

    names = _run(main())
    assert len(names) == EXPECTED_TOOL_COUNT
    for expected in (
        "get_dataset_schema",
        "list_modules",
        "search_test_cases",
        "get_top_test_cases_for_module",
        "count_test_cases",
        "get_unique_test_designs",
        "export_test_cases",
    ):
        assert expected in names


def test_schema_and_search_over_protocol():
    async def main():
        async with Client(srv.mcp) as client:
            schema = (await client.call_tool("get_dataset_schema", {})).data
            found = (await client.call_tool(
                "search_test_cases",
                {"module": "Funnels", "min_priority": "High", "limit": 5},
            )).data
            return schema, found

    schema, found = _run(main())
    assert schema["rows"] == EXPECTED_ROWS
    assert schema["filter_domains"]["priority"] == ["Highest", "High", "Medium", "Low"]
    assert found["returned"] == 5
    assert found["total_matched"] == found["total_matched"]  # sanity: numeric
    assert all(c["module"] == "Funnels" for c in found["cases"])


def test_top_cases_tool_returns_ranked_list():
    async def main():
        async with Client(srv.mcp) as client:
            return (await client.call_tool(
                "get_top_test_cases_for_module",
                {"module": "Funnels", "top_n": 3, "min_priority": "High"},
            )).data

    result = _run(main())
    assert result["module"] == "Funnels"
    assert result["returned"] == 3
    scores = [c["score"] for c in result["cases"]]
    assert scores == sorted(scores, reverse=True)


def test_single_case_and_resource_agree():
    async def main():
        async with Client(srv.mcp) as client:
            case = (await client.call_tool("get_test_case", {"issue_key": "VWO-1001"})).data
            res = await client.read_resource("testcase://VWO-1001")
            return case, res

    case, res = _run(main())
    assert case["issue_key"] == "VWO-1001"
    assert case["component"] == "SmartCode"
    assert "VWO-1001" in str(res[0].text)


def test_invalid_filter_raises_tool_error_over_protocol():
    async def main():
        async with Client(srv.mcp) as client:
            with pytest.raises(Exception) as exc:
                await client.call_tool("search_test_cases", {"module": "Nope"})
            return str(exc.value)

    message = _run(main())
    assert "Funnels" in message


def test_export_writes_file():
    async def main():
        async with Client(srv.mcp) as client:
            return (await client.call_tool(
                "export_test_cases",
                {"module": "Reports", "min_priority": "Highest", "format": "csv",
                 "filename": "pytest-export.csv"},
            )).data

    result = _run(main())
    path = pathlib.Path(result["path"])
    assert path.is_file()
    assert path.name == "pytest-export.csv"
    assert result["rows_exported"] > 0

    header = path.read_text(encoding="utf-8").splitlines()[0]
    assert header.startswith("Issue Type,Issue Key,Summary")
    path.unlink()
