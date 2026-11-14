"""
Test Creator MCP — server definition (FastMCP 4.1.0).

Turns `data/vwo_5000_test_cases.csv` into queryable MCP tools so a QA/Dev can ask
"what should we run for module X?" and get a deterministic, traceable answer.

Run:
    python server.py                         # stdio (default) — for editors/IDEs
    python server.py --transport http --port 8765
    fastmcp run server.py:mcp                # FastMCP CLI
    fastmcp list server.py:mcp               # print the tool list
"""

import json
import os
import re
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from fastmcp import Context, FastMCP
from fastmcp.exceptions import ToolError

import dataset as ds_mod
from dataset import (
    DEFAULT_EXCLUDED_STATUSES,
    DEFAULT_LIMIT,
    MAX_LIMIT,
    Dataset,
    DatasetError,
    PRIORITY_ORDER,
    STATUS_ORDER,
    key_sort_value,
)

INSTRUCTIONS = """\
Test Creator MCP — read-only access to the VWO test-case catalogue (5000 cases, 17 modules).

How to use it well:
1. Discover before filtering. Call `get_dataset_schema`, `list_modules` or
   `list_filter_values` first — do not guess module or test-type names.
2. Plan cheaply. Use `count_test_cases` / `get_priority_breakdown` before pulling rows.
3. For "what should we run?", use `get_top_test_cases_for_module`.

Determinism contract (do not restate results as risk judgements):
* Ranking is deterministic: score = priority_rank*100 + status_rank*10, tie-break Issue Key
  ascending. 'Deprecated' cases are excluded from ranking unless include_deprecated=true.
* The dataset is templated/generated: browser x device rows are variants of ~1500 designs,
  not independent coverage. Pass unique_designs_only=true to collapse them.
* Always cite the Issue Key (e.g. VWO-1024) so a human can verify any answer.
"""

mcp = FastMCP("testcreator-mcp", instructions=INSTRUCTIONS, version="0.1.0")

OUTPUT_DIR = Path(__file__).resolve().parent / "output"


# --------------------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------------------


@contextmanager
def _errors() -> Iterator[None]:
    """Convert data-layer failures into clean, actionable MCP tool errors."""
    try:
        yield
    except DatasetError as exc:
        raise ToolError(str(exc)) from exc
    except FileNotFoundError as exc:  # pragma: no cover - defensive
        raise ToolError(
            f"Dataset file missing: {exc}. Set the TESTCASE_CSV environment variable."
        ) from exc


def _data() -> Dataset:
    return ds_mod.get_dataset()


def _clamp(limit: int | None, default: int = DEFAULT_LIMIT) -> int:
    value = default if limit is None else int(limit)
    if value < 0:
        raise ToolError("limit must be >= 0")
    return min(value, MAX_LIMIT)


def _page(cases: list[Any], limit: int | None, offset: int | None) -> dict[str, Any]:
    lim, off = _clamp(limit), max(0, int(offset or 0))
    window = cases[off : off + lim]
    return {
        "total_matched": len(cases),
        "returned": len(window),
        "offset": off,
        "limit": lim,
        "has_more": off + lim < len(cases),
        "cases": window,
    }


# --------------------------------------------------------------------------------------
# Group A — Ground truth
# --------------------------------------------------------------------------------------


@mcp.tool(tags={"core"})
def get_dataset_schema() -> dict[str, Any]:
    """Describe the test-case dataset: columns, meanings, valid filter values and the ranking rule.

    Call this first when you are unsure what fields or filter values exist.
    Returns the field list, every valid enum value (module / priority / test type / browser /
    device / status), row counts and the exact ranking formula used by other tools.
    """
    with _errors():
        return ds_mod.schema_payload(_data())


@mcp.tool(tags={"core"})
def list_modules(include_counts: bool = True) -> dict[str, Any]:
    """List the modules (the 'Component' column) available to filter on.

    Args:
        include_counts: include the number of test cases per module (default true).
    """
    with _errors():
        dataset = _data()
        if include_counts:
            counts = dataset.value_counts("module")
            return {"count": len(dataset.modules), "modules": counts}
        return {"count": len(dataset.modules), "modules": dataset.modules}


@mcp.tool(tags={"core"})
def list_filter_values(field: str = "all") -> dict[str, Any]:
    """List the valid values (and counts) for a filterable field.

    Args:
        field: one of module, priority, test_type, browser, device, status, or 'all'.
            Invalid values return an error listing the valid ones.
    """
    with _errors():
        dataset = _data()
        if field.strip().lower() in ("all", ""):
            return {
                "module": dataset.value_counts("module"),
                "priority": dataset.value_counts("priority"),
                "test_type": dataset.value_counts("test_type"),
                "browser": dataset.value_counts("browser"),
                "device": dataset.value_counts("device"),
                "status": dataset.value_counts("status"),
            }
        return {field: dataset.value_counts(field)}


@mcp.tool(tags={"advanced"})
def get_dataset_stats(group_by: list[str] | None = None) -> dict[str, Any]:
    """Return distribution statistics, optionally as cross-tabulations.

    Args:
        group_by: pairs are expected, e.g. ["module","priority"] for a module x priority
            matrix, or ["module","test_type"] for a coverage matrix. Omit for overall counts.
            Supported fields: module, priority, test_type, browser, device, status.
    """
    with _errors():
        dataset = _data()
        if not group_by:
            return {
                "rows": len(dataset.rows),
                "unique_designs": len(dataset.designs()),
                "distributions": {
                    "module": dataset.value_counts("module"),
                    "priority": dataset.value_counts("priority"),
                    "test_type": dataset.value_counts("test_type"),
                    "browser": dataset.value_counts("browser"),
                    "device": dataset.value_counts("device"),
                    "status": dataset.value_counts("status"),
                },
            }
        fields = [f.strip().lower() for f in group_by]
        if len(fields) == 2 and sorted(fields) == ["module", "priority"]:
            return dataset.priority_breakdown()
        if len(fields) == 2 and sorted(fields) == ["module", "test_type"]:
            return dataset.coverage_matrix()
        matrix: dict[str, dict[str, int]] = {}
        for row in dataset.rows:
            key = " | ".join(str(getattr(row, ds_mod.CSV_to_attr().get(f, f), "")) for f in fields)
            matrix[key] = matrix.get(key, 0) + 1
        return {"group_by": fields, "counts": dict(sorted(matrix.items()))}


@mcp.tool(tags={"advanced"})
def validate_dataset() -> dict[str, Any]:
    """Check dataset integrity: duplicate keys, blank cells, unknown enum values.

    Useful right after replacing the CSV with a newer export. Returns ok=true when clean.
    """
    with _errors():
        return _data().validate()


# --------------------------------------------------------------------------------------
# Group B — Core retrieval
# --------------------------------------------------------------------------------------


@mcp.tool(tags={"core"})
def search_test_cases(
    module: str | None = None,
    priorities: list[str] | None = None,
    min_priority: str | None = None,
    test_types: list[str] | None = None,
    browsers: list[str] | None = None,
    devices: list[str] | None = None,
    statuses: list[str] | None = None,
    exclude_statuses: list[str] | None = None,
    keyword: str | None = None,
    search_fields: list[str] | None = None,
    sort_by: str = "issue_key",
    descending: bool = False,
    limit: int | None = DEFAULT_LIMIT,
    offset: int | None = 0,
    full_records: bool = False,
) -> dict[str, Any]:
    """Search test cases with any combination of filters. This is the general-purpose query tool.

    Args:
        module: exact module/Component name, e.g. 'Funnels'. See list_modules.
        priorities: exact priorities to include, e.g. ["Highest","High"].
        min_priority: priority floor - e.g. 'High' returns High + Highest.
        test_types: e.g. ["Functional","Security"]. See list_filter_values.
        browsers: e.g. ["Chrome 148"].
        devices: e.g. ["mobile (iOS)"].
        statuses: exact statuses to include, e.g. ["Ready"].
        exclude_statuses: statuses to drop, e.g. ["Deprecated","Draft"].
        keyword: case-insensitive substring search.
        search_fields: which fields keyword searches (default summary, description, labels).
            Any of: summary, description, labels, steps, expected_result, preconditions,
            test_type, priority, module.
        sort_by: issue_key | priority | status | module | test_type | summary.
        descending: reverse the sort.
        limit: max rows to return (default 25, hard max 200).
        offset: pagination offset.
        full_records: true returns every column, false returns a compact projection.

    Returns total_matched plus the page of cases.
    """
    with _errors():
        cases = _data().query(
            module=module,
            priorities=priorities,
            min_priority=min_priority,
            test_types=test_types,
            browsers=browsers,
            devices=devices,
            statuses=statuses,
            exclude_statuses=exclude_statuses,
            keyword=keyword,
            search_fields=search_fields,
            sort_by=sort_by,
            descending=descending,
        )
        projection = (lambda c: c.to_dict()) if full_records else (lambda c: c.to_summary_dict())
        page = _page([projection(c) for c in cases], limit, offset)
        page["filters_applied"] = {
            k: v
            for k, v in {
                "module": module,
                "priorities": priorities,
                "min_priority": min_priority,
                "test_types": test_types,
                "browsers": browsers,
                "devices": devices,
                "statuses": statuses,
                "exclude_statuses": exclude_statuses,
                "keyword": keyword,
            }.items()
            if v
        }
        return page


@mcp.tool(tags={"core"})
def get_test_case(issue_key: str) -> dict[str, Any]:
    """Fetch one full test case by its Issue Key (e.g. 'VWO-1024').

    Use this to expand a case returned by a list/search tool. Unknown keys return an error
    naming the closest valid range (keys run VWO-1001..VWO-6000).
    """
    with _errors():
        dataset = _data()
        case = dataset.get(issue_key)
        if case is None:
            num = key_sort_value(issue_key)
            hint = (
                f"Valid keys are VWO-1001 .. VWO-6000 ({len(dataset.rows)} cases)."
                if num is None
                else f"Widest valid ranges: VWO-1001..VWO-{1000 + len(dataset.rows)}, "
                f"you asked for {issue_key}."
            )
            raise ToolError(f"No test case with Issue Key '{issue_key}'. {hint}")
        result = case.to_dict()
        result["variant_count"] = len(dataset.variants_of(case))
        return result


@mcp.tool(tags={"advanced"})
def get_test_cases_by_ids(issue_keys: list[str]) -> dict[str, Any]:
    """Batch-fetch full test cases by a list of Issue Keys.

    Args:
        issue_keys: e.g. ["VWO-1001","VWO-1500"]. Unknown keys are reported in `not_found`
            rather than failing the whole request.
    """
    with _errors():
        dataset = _data()
        found, missing = [], []
        for key in issue_keys or []:
            case = dataset.get(key)
            (found.append(case.to_dict()) if case else missing.append(key))
        return {"requested": len(issue_keys or []), "found": len(found),
                "not_found": missing, "cases": found}


@mcp.tool(tags={"core"})
def get_test_cases_by_module(
    module: str,
    test_type: str | None = None,
    priority: str | None = None,
    min_priority: str | None = None,
    status: str | None = None,
    limit: int | None = DEFAULT_LIMIT,
    offset: int | None = 0,
) -> dict[str, Any]:
    """Get the test cases for one module, optionally narrowed further.

    Args:
        module: module name, e.g. 'Reports'. Required.
        test_type: single test type, e.g. 'Regression'.
        priority: single exact priority, e.g. 'Highest'.
        min_priority: priority floor, e.g. 'High' (High + Highest).
        status: single status, e.g. 'Ready'.
        limit: max rows (default 25, max 200).
        offset: pagination offset.
    """
    with _errors():
        cases = _data().query(
            module=module,
            priorities=[priority] if priority else None,
            min_priority=min_priority,
            test_types=[test_type] if test_type else None,
            statuses=[status] if status else None,
        )
        page = _page([c.to_summary_dict() for c in cases], limit, offset)
        page["module"] = module
        return page


@mcp.tool(tags={"core"})
def get_test_cases_by_priority(
    priority: str | None = None,
    min_priority: str | None = None,
    module: str | None = None,
    status: str | None = None,
    limit: int | None = DEFAULT_LIMIT,
    offset: int | None = 0,
) -> dict[str, Any]:
    """Get test cases by priority, either exactly or as a floor.

    Args:
        priority: exact priority - 'Highest' | 'High' | 'Medium' | 'Low'.
        min_priority: floor instead of exact - 'High' returns High + Highest.
        module: optional module restriction.
        status: optional single status, e.g. 'Ready'.
        limit: max rows (default 25, max 200).
        offset: pagination offset.
    """
    with _errors():
        if not priority and not min_priority:
            raise ToolError(
                "Provide either 'priority' (e.g. 'Highest') or 'min_priority' (e.g. 'High'). "
                f"Valid priorities: {_data().priorities}"
            )
        cases = _data().query(
            module=module,
            priorities=[priority] if priority else None,
            min_priority=min_priority,
            statuses=[status] if status else None,
        )
        page = _page([c.to_summary_dict() for c in cases], limit, offset)
        page["priority_filter"] = {"priority": priority, "min_priority": min_priority}
        return page


@mcp.tool(tags={"advanced"})
def get_test_case_variants(issue_key: str) -> dict[str, Any]:
    """List the browser/device variants of a case (rows sharing the same test design).

    The dataset repeats each design across browsers and devices, so executing every row of a
    design is usually redundant. Returns the sibling rows plus a browser x device matrix.
    """
    with _errors():
        dataset = _data()
        case = dataset.get(issue_key)
        if case is None:
            raise ToolError(f"No test case with Issue Key '{issue_key}'.")
        variants = dataset.variants_of(case)
        matrix: dict[str, list[str]] = {}
        for row in [case, *variants]:
            matrix.setdefault(row.browser, [])
            if row.device not in matrix[row.browser]:
                matrix[row.browser].append(row.device)
        return {
            "design": case.summary,
            "design_key": case.design_key,
            "total_rows_for_design": len(variants) + 1,
            "variant_count": len(variants),
            "browsers_devices": {b: sorted(d) for b, d in sorted(matrix.items())},
            "variants": [v.to_summary_dict() for v in variants],
        }


# --------------------------------------------------------------------------------------
# Group C — Ranking
# --------------------------------------------------------------------------------------


@mcp.tool(tags={"core"})
def get_top_test_cases_for_module(
    module: str,
    top_n: int = 10,
    min_priority: str | None = None,
    test_types: list[str] | None = None,
    include_deprecated: bool = False,
    unique_designs_only: bool = False,
    full_records: bool = False,
) -> dict[str, Any]:
    """Rank the test cases to execute first for a module. The headline tool.

    Ranking is fully deterministic:
        score = priority_rank*100 + status_rank*10, tie-break Issue Key ascending
        priority_rank: Highest 4, High 3, Medium 2, Low 1
        status_rank:   Ready 3, Automated 2, Draft 1, Deprecated 0
    'Deprecated' is excluded unless include_deprecated=true. Test type carries no weight -
    v1 deliberately makes no opinion-based claims about which test types matter more.

    Args:
        module: module to rank, e.g. 'Funnels'. Required.
        top_n: how many cases to return (1..200, default 10).
        min_priority: only consider cases at or above this priority, e.g. 'High'.
        test_types: restrict to these test types, e.g. ["Functional","Security"].
        include_deprecated: keep Deprecated cases in the pool (default false).
        unique_designs_only: collapse browser/device variants so each design appears once.
        full_records: return every column instead of a compact projection.

    Returns the ranked cases with their score, the pool size and the rule that was applied.
    """
    with _errors():
        dataset = _data()
        pool = dataset.query(module=module, min_priority=min_priority, test_types=test_types)
        excluded = () if include_deprecated else DEFAULT_EXCLUDED_STATUSES
        ranked = ds_mod.rank_cases(pool, exclude_statuses=excluded,
                                   unique_designs_only=unique_designs_only)
        top = ranked[: _clamp(top_n, default=10)]
        return {
            "module": module,
            "pool_size": len(pool),
            "ranked_pool_size": len(ranked),
            "returned": len(top),
            "ranking_rule": (
                "score = priority_rank*100 + status_rank*10; tie-break Issue Key asc; "
                f"excluded_statuses={list(excluded)}; unique_designs_only={unique_designs_only}"
            ),
            "cases": [
                (c.to_dict(include_score=True) if full_records
                 else {**c.to_summary_dict(), "score": c.score(),
                       "score_explanation": c.score_explanation()})
                for c in top
            ],
        }


@mcp.tool(tags={"advanced"})
def get_smoke_suite(
    max_per_module: int = 5,
    modules: list[str] | None = None,
    min_priority: str = "Highest",
    include_automated: bool = True,
) -> dict[str, Any]:
    """Build a cross-module smoke suite: the highest-priority cases per module.

    Args:
        max_per_module: cases per module (default 5, max 200).
        modules: restrict to these modules (default: all 17).
        min_priority: priority floor for the suite (default 'Highest').
        include_automated: allow Automated cases alongside Ready (default true).

    Returns the selected cases grouped by module plus a total.
    """
    with _errors():
        dataset = _data()
        wanted = modules or dataset.modules
        unknown = [m for m in wanted if m not in dataset.modules]
        if unknown:
            raise ToolError(f"Unknown module(s): {unknown}. Valid modules: {dataset.modules}")
        statuses_ok = ["Ready", "Automated"] if include_automated else ["Ready"]
        per_module: dict[str, list[dict[str, Any]]] = {}
        total = 0
        for module in wanted:
            pool = dataset.query(module=module, min_priority=min_priority,
                                 statuses=statuses_ok)
            ranked = ds_mod.rank_cases(pool, exclude_statuses=())
            chosen = ranked[: _clamp(max_per_module, default=5)]
            per_module[module] = [
                {**c.to_summary_dict(), "score": c.score()} for c in chosen
            ]
            total += len(chosen)
        return {
            "min_priority": min_priority,
            "statuses": statuses_ok,
            "max_per_module": max_per_module,
            "modules_included": len(wanted),
            "total_cases": total,
            "by_module": per_module,
        }


# --------------------------------------------------------------------------------------
# Group D — Counts and limits
# --------------------------------------------------------------------------------------


@mcp.tool(tags={"core"})
def count_test_cases(
    module: str | None = None,
    priorities: list[str] | None = None,
    min_priority: str | None = None,
    test_types: list[str] | None = None,
    browsers: list[str] | None = None,
    devices: list[str] | None = None,
    statuses: list[str] | None = None,
    exclude_statuses: list[str] | None = None,
    keyword: str | None = None,
    group_by: str | None = None,
) -> dict[str, Any]:
    """Count test cases for a filter, optionally grouped. Cheap - use before pulling rows.

    Args:
        module / priorities / min_priority / test_types / browsers / devices / statuses /
        exclude_statuses / keyword: same meaning as in search_test_cases.
        group_by: optional breakdown field - module, priority, test_type, browser, device
            or status.
    """
    with _errors():
        dataset = _data()
        cases = dataset.query(
            module=module, priorities=priorities, min_priority=min_priority,
            test_types=test_types, browsers=browsers, devices=devices,
            statuses=statuses, exclude_statuses=exclude_statuses, keyword=keyword,
        )
        if not group_by:
            return {"total": len(cases)}
        mapping = {"module": "component", "component": "component", "priority": "priority",
                   "test_type": "test_type", "browser": "browser", "device": "device",
                   "status": "status"}
        attr = mapping.get(group_by.strip().lower())
        if attr is None:
            raise ToolError(
                f"Unknown group_by '{group_by}'. Valid: {sorted(mapping)}"
            )
        counts: dict[str, int] = {}
        for case in cases:
            key = str(getattr(case, attr))
            counts[key] = counts.get(key, 0) + 1
        if attr == "priority":
            counts = dict(sorted(counts.items(), key=lambda kv: -PRIORITY_ORDER.get(kv[0], 0)))
        elif attr == "status":
            counts = dict(sorted(counts.items(), key=lambda kv: -STATUS_ORDER.get(kv[0], 0)))
        else:
            counts = dict(sorted(counts.items()))
        return {"total": len(cases), "group_by": group_by, "counts": counts}


@mcp.tool(tags={"core"})
def get_priority_breakdown(module: str | None = None) -> dict[str, Any]:
    """Show the priority mix per module - quickly reveals where 'Highest' coverage is thin.

    Args:
        module: limit the report to one module (default: all 17).
    """
    with _errors():
        return _data().priority_breakdown(module)


# --------------------------------------------------------------------------------------
# Group E — Dedupe and coverage
# --------------------------------------------------------------------------------------


@mcp.tool(tags={"core"})
def get_unique_test_designs(
    module: str | None = None,
    test_type: str | None = None,
    min_priority: str | None = None,
    limit: int | None = DEFAULT_LIMIT,
    offset: int | None = 0,
) -> dict[str, Any]:
    """List distinct test *designs*, collapsing browser/device duplicates.

    The dataset holds 5000 rows but only ~1500 unique designs; each design is repeated across
    browsers and devices. Use this for planning, and search_test_cases for raw rows.

    Args:
        module / test_type / min_priority: optional filters.
        limit: max designs returned (default 25, max 200).
        offset: pagination offset.
    """
    with _errors():
        dataset = _data()
        cases = dataset.query(module=module, test_types=[test_type] if test_type else None,
                              min_priority=min_priority)
        groups: dict[str, list[Any]] = {}
        for case in cases:
            groups.setdefault(case.design_key, []).append(case)
        designs = [
            {
                "design_key": key,
                "summary": rows[0].summary,
                "module": rows[0].component,
                "test_type": rows[0].test_type,
                "priority": rows[0].priority,
                "row_count": len(rows),
                "browsers": sorted({r.browser for r in rows}),
                "devices": sorted({r.device for r in rows}),
                "statuses": sorted({r.status for r in rows}, key=lambda s: -STATUS_ORDER.get(s, 0)),
                "sample_issue_key": rows[0].issue_key,
            }
            for key, rows in sorted(groups.items())
        ]
        page = _page(designs, limit, offset)
        page["unique_designs_matched"] = len(designs)
        page["rows_matched"] = len(cases)
        return page


@mcp.tool(tags={"core"})
def get_module_coverage_matrix(modules: list[str] | None = None) -> dict[str, Any]:
    """Show how many cases each module has per test type (module x test-type matrix).

    Answers questions like "does Reports have any Performance tests?".

    Args:
        modules: restrict to these modules (default: all 17).
    """
    with _errors():
        return _data().coverage_matrix(modules)


@mcp.tool(tags={"advanced"})
def find_coverage_gaps(
    min_cases: int = 1,
    modules: list[str] | None = None,
    test_types: list[str] | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    """Find module x test-type combinations that are MISSING or below a threshold.

    Args:
        min_cases: flag combinations with fewer than this many cases (default 1 = only
            truly missing combinations).
        modules / test_types: restrict the search space.
        limit: max gaps to return (default 50).

    Each gap is labelled 'missing' (0 cases) or 'thin' (below the threshold).
    """
    with _errors():
        dataset = _data()
        gaps = dataset.coverage_gaps(min_cases=min_cases, modules=modules, test_types=test_types)
        return {
            "min_cases": min_cases,
            "checked_combinations": (len(modules or dataset.modules)
                                     * len(test_types or dataset.test_types)),
            "gap_count": len(gaps),
            "returned": min(len(gaps), _clamp(limit, default=50)),
            "gaps": gaps[: _clamp(limit, default=50)],
        }


@mcp.tool(tags={"advanced"})
def find_duplicate_designs(
    module: str | None = None,
    min_row_count: int = 2,
    limit: int = 25,
) -> dict[str, Any]:
    """Find designs that appear on multiple rows (the browser/device expansion).

    Args:
        module: optional module restriction.
        min_row_count: only report designs with at least this many rows (default 2).
        limit: max designs to return (default 25).

    Use this to explain why the file contains duplicate titles, and to spot rows you would
    otherwise execute twice.
    """
    with _errors():
        dataset = _data()
        cases = dataset.query(module=module)
        groups: dict[str, list[Any]] = {}
        for case in cases:
            groups.setdefault(case.design_key, []).append(case)
        dupes = [
            {
                "design_key": key,
                "summary": rows[0].summary,
                "module": rows[0].component,
                "test_type": rows[0].test_type,
                "row_count": len(rows),
                "issue_keys": [r.issue_key for r in rows],
                "browsers": sorted({r.browser for r in rows}),
                "devices": sorted({r.device for r in rows}),
            }
            for key, rows in groups.items()
            if len(rows) >= min_row_count
        ]
        dupes.sort(key=lambda d: (-d["row_count"], d["module"], d["summary"]))
        return {
            "distinct_designs": len(groups),
            "rows_in_dataset": len(cases),
            "duplicated_designs": len(dupes),
            "rows_in_duplicated_designs": sum(d["row_count"] for d in dupes),
            "duplicates": dupes[: _clamp(limit, default=25)],
        }


# --------------------------------------------------------------------------------------
# Group F — Export / handoff
# --------------------------------------------------------------------------------------


FORMATS = ("md", "csv", "json")


@mcp.tool(tags={"advanced"})
def export_test_cases(
    module: str | None = None,
    priorities: list[str] | None = None,
    min_priority: str | None = None,
    test_types: list[str] | None = None,
    browsers: list[str] | None = None,
    devices: list[str] | None = None,
    statuses: list[str] | None = None,
    exclude_statuses: list[str] | None = None,
    keyword: str | None = None,
    format: str = "md",
    filename: str | None = None,
    ranked: bool = False,
    max_rows: int = MAX_LIMIT,
) -> dict[str, Any]:
    """Export a filtered selection to a file under the server's output/ folder and return its path.

    The CSV output keeps the original 14-column Jira-compatible header, so it can be imported
    back into Jira (columns: Issue Type, Issue Key, Summary, ... Status).

    Args:
        module / priorities / min_priority / test_types / browsers / devices / statuses /
        exclude_statuses / keyword: same meaning as in search_test_cases.
        format: 'md' (handover doc), 'csv' (Jira-compatible), or 'json'.
        filename: optional file name; a timestamped name is generated when omitted.
        ranked: apply the deterministic ranking order instead of Issue-Key order.
        max_rows: safety cap on exported rows (default 200).

    Returns the absolute path, row count and the filters used.
    """
    with _errors():
        dataset = _data()
        cases = dataset.query(
            module=module, priorities=priorities, min_priority=min_priority,
            test_types=test_types, browsers=browsers, devices=devices,
            statuses=statuses, exclude_statuses=exclude_statuses, keyword=keyword,
        )
        if ranked:
            cases = ds_mod.rank_cases(cases, exclude_statuses=())
        cap = _clamp(max_rows, default=MAX_LIMIT)
        exported = cases[:cap]

        fmt = (format or "md").strip().lower()
        if fmt not in FORMATS:
            raise ToolError(f"Unsupported format '{format}'. Valid: {list(FORMATS)}")

        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        if filename:
            safe = re.sub(r"[^A-Za-z0-9._-]", "_", Path(filename).name)
            if not safe or safe in (".", ".."):
                raise ToolError("filename must contain at least one letter or digit")
            name = safe
        else:
            stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
            hint = re.sub(r"[^a-z0-9]+", "-", (module or "all").lower()).strip("-")
            name = f"testcases-{hint}-{stamp}.{fmt}"
        if not name.lower().endswith(f".{fmt}"):
            name = f"{name}.{fmt}"

        target = (OUTPUT_DIR / name).resolve()
        if target.parent != OUTPUT_DIR.resolve():
            raise ToolError("filename must not contain path separators")

        if fmt == "json":
            target.write_text(json.dumps([c.to_dict() for c in exported], indent=2),
                              encoding="utf-8")
        elif fmt == "csv":
            import csv as _csv

            with target.open("w", encoding="utf-8", newline="") as fh:
                writer = _csv.DictWriter(fh, fieldnames=list(ds_mod.CSV_COLUMNS))
                writer.writeheader()
                for case in exported:
                    writer.writerow(case.to_csv_row())
        else:
            lines = [
                f"# Test cases — {module or 'all modules'}",
                "",
                f"- Generated: {datetime.now(timezone.utc).isoformat(timespec='seconds')}",
                f"- Rows exported: {len(exported)} of {len(cases)} matched",
                f"- Dataset: `{dataset.source.name}` ({len(dataset.rows)} cases)"
                + (" (ranked by priority then status)" if ranked else ""),
                "",
                "| Issue Key | Module | Test Type | Priority | Status | Browser | Device | Summary |",
                "| --- | --- | --- | --- | --- | --- | --- | --- |",
            ]
            for case in exported:
                lines.append(
                    f"| {case.issue_key} | {case.component} | {case.test_type} | "
                    f"{case.priority} | {case.status} | {case.browser} | {case.device} | "
                    f"{case.summary} |"
                )
            target.write_text("\n".join(lines) + "\n", encoding="utf-8")

        return {
            "path": str(target),
            "format": fmt,
            "rows_exported": len(exported),
            "rows_matched": len(cases),
            "truncated": len(cases) > len(exported),
            "ranked": ranked,
            "filters_applied": {
                k: v
                for k, v in {
                    "module": module, "priorities": priorities, "min_priority": min_priority,
                    "test_types": test_types, "browsers": browsers, "devices": devices,
                    "statuses": statuses, "exclude_statuses": exclude_statuses, "keyword": keyword,
                }.items()
                if v
            },
        }


# --------------------------------------------------------------------------------------
# Resources — deterministic, cacheable reads
# --------------------------------------------------------------------------------------


@mcp.resource("testcases://schema", mime_type="application/json")
def resource_schema() -> dict[str, Any]:
    """The dataset schema and valid filter values (same payload as get_dataset_schema)."""
    return ds_mod.schema_payload(_data())


@mcp.resource("testcases://modules", mime_type="application/json")
def resource_modules() -> dict[str, Any]:
    """All modules with their case counts."""
    return _data().value_counts("module")


@mcp.resource("testcase://{issue_key}", mime_type="application/json")
def resource_test_case(issue_key: str) -> dict[str, Any]:
    """A single test case by Issue Key, e.g. testcase://VWO-1024."""
    case = _data().get(issue_key)
    if case is None:
        raise ToolError(f"No test case with Issue Key '{issue_key}'.")
    return case.to_dict()


# --------------------------------------------------------------------------------------
# Prompt — reusable instruction template
# --------------------------------------------------------------------------------------


@mcp.prompt(tags={"core"})
def plan_module_testing(module: str, priority_floor: str = "High") -> str:
    """Draft a test plan for one module using this server's tools."""
    return (
        f"Build a test plan for the '{module}' module, covering priorities {priority_floor} and above.\n\n"
        f"1. Call list_modules + get_priority_breakdown(module='{module}') to see the priority mix.\n"
        f"2. Call get_module_coverage_matrix(modules=['{module}']) to see which test types exist.\n"
        f"3. Call count_test_cases(module='{module}', min_priority='{priority_floor}') to size the work.\n"
        f"4. Call get_top_test_cases_for_module(module='{module}', min_priority='{priority_floor}', "
        f"top_n=15, unique_designs_only=true) for the ranked execution list.\n"
        f"5. Optionally call export_test_cases(module='{module}', min_priority='{priority_floor}', "
        f"format='md') to produce a handover document.\n\n"
        "Report the ranked list with Issue Keys, note any coverage gaps you found, and state the "
        "ranking rule that produced the order. Do not invent test cases that are not in the dataset."
    )


def main() -> None:
    """Entry point. Defaults to stdio; pass --transport http --port N for team sharing."""
    import argparse

    parser = argparse.ArgumentParser(description="Test Creator MCP server")
    parser.add_argument("--transport", default=os.environ.get("MCP_TRANSPORT", "stdio"),
                        choices=["stdio", "http", "sse", "streamable-http"])
    parser.add_argument("--host", default=os.environ.get("MCP_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("MCP_PORT", "8765")))
    args = parser.parse_args()

    if args.transport == "stdio":
        mcp.run()
    else:
        mcp.run(transport=args.transport, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
