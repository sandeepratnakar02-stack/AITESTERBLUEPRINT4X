"""
Test Creator MCP — data layer.

Loads the VWO test-case CSV once and exposes a small, deterministic query engine.

Design rules (see 01_TestCreatorMCP.Plan.md):
  * Read-only. The CSV is never mutated.
  * No LLM calls, no randomness. Same input -> same output, stable tie-breaks.
  * Every returned case carries its Issue Key so any answer is auditable.

Fact measured from the source dataset (vwo_5000_test_cases.csv):
  5000 rows / 14 columns / 0 blanks / keys VWO-1001..VWO-6000 (sequential, unique)
  17 modules, 4 priorities, 9 test types, 4 browsers, 4 devices, 4 statuses.
"""

from __future__ import annotations

import csv
import os
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Iterable, Sequence

# --------------------------------------------------------------------------------------
# Constants — the ONLY place these orders are defined.
# --------------------------------------------------------------------------------------

#: Priority is the single truly ordinal column in the dataset (Highest = most urgent).
PRIORITY_ORDER: dict[str, int] = {"Highest": 4, "High": 3, "Medium": 2, "Low": 1}

#: Status is ordinal for *execution readiness*: Ready > Automated > Draft > Deprecated.
STATUS_ORDER: dict[str, int] = {"Ready": 3, "Automated": 2, "Draft": 1, "Deprecated": 0}

#: Statuses excluded from ranking by default. Deprecated = 415/5000 rows in the source file.
DEFAULT_EXCLUDED_STATUSES: tuple[str, ...] = ("Deprecated",)

CSV_COLUMNS: tuple[str, ...] = (
    "Issue Type",
    "Issue Key",
    "Summary",
    "Description",
    "Priority",
    "Component",
    "Labels",
    "Test Type",
    "Preconditions",
    "Steps",
    "Expected Result",
    "Browser",
    "Device",
    "Status",
)

#: Steps in the source file are always joined with this separator (all 5000 rows).
STEP_SEPARATOR = " | "

DEFAULT_LIMIT = 25
MAX_LIMIT = 200

#: Fields a keyword search looks at by default.
DEFAULT_SEARCH_FIELDS: tuple[str, ...] = ("summary", "description", "labels")


class DatasetError(RuntimeError):
    """Raised when the dataset cannot be loaded or is structurally invalid."""


# --------------------------------------------------------------------------------------
# Model
# --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class TestCase:
    """One row of the source CSV, normalised to snake_case attribute names."""

    issue_type: str
    issue_key: str
    summary: str
    description: str
    priority: str
    component: str
    labels: str
    test_type: str
    preconditions: str
    steps: str
    expected_result: str
    browser: str
    device: str
    status: str

    @property
    def steps_list(self) -> list[str]:
        """Steps split on the dataset's ' | ' separator, numbered prefix stripped."""
        parts = [p.strip() for p in self.steps.split(STEP_SEPARATOR) if p.strip()]
        return [re.sub(r"^\d+\.\s*", "", p) for p in parts]

    @property
    def priority_rank(self) -> int:
        return PRIORITY_ORDER.get(self.priority, 0)

    @property
    def status_rank(self) -> int:
        return STATUS_ORDER.get(self.status, 0)

    @property
    def design_key(self) -> str:
        """
        Identity of the *test design*, ignoring browser/device expansion.

        Measured: 3480 of 5000 summaries are duplicates -> only 1520 unique designs.
        Two rows with the same design_key are variants of the same test.
        """
        return self.summary.strip().lower()

    @property
    def object_under_test(self) -> str:
        """The part of the summary after ':' — e.g. '[Funnels] UI/UX: verify layout of X' -> 'verify layout of X'."""
        return self.summary.split(":", 1)[1].strip() if ":" in self.summary else self.summary.strip()

    def score(self) -> int:
        """
        Deterministic ranking score.

        score = priority_rank * 100 + status_rank * 10

        Deliberately contains NO test-type weighting: type importance is a policy opinion
        rather than something derivable from the data, so v1 stays opinion-free.
        Tie-break is Issue Key ascending (see rank()).
        """
        return self.priority_rank * 100 + self.status_rank * 10

    def score_explanation(self) -> str:
        return (
            f"priority={self.priority}({self.priority_rank}) "
            f"status={self.status}({self.status_rank}) "
            f"-> {self.score()}"
        )

    def to_dict(self, include_score: bool = False) -> dict[str, Any]:
        d = asdict(self)
        if include_score:
            d["score"] = self.score()
            d["score_explanation"] = self.score_explanation()
        return d

    def to_summary_dict(self) -> dict[str, Any]:
        """Compact projection for list endpoints."""
        return {
            "issue_key": self.issue_key,
            "summary": self.summary,
            "module": self.component,
            "priority": self.priority,
            "test_type": self.test_type,
            "status": self.status,
            "browser": self.browser,
            "device": self.device,
        }

    def to_csv_row(self) -> dict[str, str]:
        """Row in the ORIGINAL 14-column order (Jira-import compatible)."""
        return {
            "Issue Type": self.issue_type,
            "Issue Key": self.issue_key,
            "Summary": self.summary,
            "Description": self.description,
            "Priority": self.priority,
            "Component": self.component,
            "Labels": self.labels,
            "Test Type": self.test_type,
            "Preconditions": self.preconditions,
            "Steps": self.steps,
            "Expected Result": self.expected_result,
            "Browser": self.browser,
            "Device": self.device,
            "Status": self.status,
        }


# --------------------------------------------------------------------------------------
# Loading
# --------------------------------------------------------------------------------------


def _candidate_paths() -> list[Path]:
    here = Path(__file__).resolve()
    env = os.environ.get("TESTCASE_CSV")
    paths = [Path(env)] if env else []
    paths += [
        here.parents[1] / "data" / "vwo_5000_test_cases.csv",  # chapter_14/data/...
        here.parent / "data" / "vwo_5000_test_cases.csv",  # bundled next to the package
        Path.cwd() / "data" / "vwo_5000_test_cases.csv",
        Path.cwd() / "vwo_5000_test_cases.csv",
    ]
    return paths


def resolve_csv_path() -> Path:
    """Locate the dataset: $TESTCASE_CSV wins, otherwise search the usual spots."""
    for p in _candidate_paths():
        if p.is_file():
            return p
    tried = "\n  ".join(str(p) for p in _candidate_paths())
    raise DatasetError(
        "Could not find vwo_5000_test_cases.csv. Set the TESTCASE_CSV environment "
        f"variable to its full path. Tried:\n  {tried}"
    )


class Dataset:
    """Immutable in-memory view of the test-case CSV (~3.7 MB, 5000 rows)."""

    def __init__(self, rows: Sequence[TestCase], source: Path) -> None:
        self.rows: list[TestCase] = list(rows)
        self.source = source
        self.by_key: dict[str, TestCase] = {r.issue_key: r for r in self.rows}
        self.modules: list[str] = sorted({r.component for r in self.rows})
        self.priorities: list[str] = sorted(
            {r.priority for r in self.rows}, key=lambda p: -PRIORITY_ORDER.get(p, 0)
        )
        self.test_types: list[str] = sorted({r.test_type for r in self.rows})
        self.browsers: list[str] = sorted({r.browser for r in self.rows})
        self.devices: list[str] = sorted({r.device for r in self.rows})
        self.statuses: list[str] = sorted(
            {r.status for r in self.rows}, key=lambda s: -STATUS_ORDER.get(s, 0)
        )
        self._by_module: dict[str, list[TestCase]] = defaultdict(list)
        self._by_design: dict[str, list[TestCase]] = defaultdict(list)
        for r in self.rows:
            self._by_module[r.component].append(r)
            self._by_design[r.design_key].append(r)

    # -- construction ---------------------------------------------------------------

    @classmethod
    def load(cls, path: Path | str | None = None) -> "Dataset":
        csv_path = Path(path) if path else resolve_csv_path()
        if not csv_path.is_file():
            raise DatasetError(f"Dataset file not found: {csv_path}")

        # utf-8-sig tolerates a BOM from Excel/Jira exports.
        with csv_path.open("r", encoding="utf-8-sig", newline="") as fh:
            reader = csv.DictReader(fh)
            missing = [c for c in CSV_COLUMNS if c not in (reader.fieldnames or [])]
            if missing:
                raise DatasetError(
                    f"{csv_path.name} is missing required column(s): {missing}. "
                    f"Found: {reader.fieldnames}"
                )
            rows = [
                TestCase(
                    issue_type=(r["Issue Type"] or "").strip(),
                    issue_key=(r["Issue Key"] or "").strip(),
                    summary=(r["Summary"] or "").strip(),
                    description=(r["Description"] or "").strip(),
                    priority=(r["Priority"] or "").strip(),
                    component=(r["Component"] or "").strip(),
                    labels=(r["Labels"] or "").strip(),
                    test_type=(r["Test Type"] or "").strip(),
                    preconditions=(r["Preconditions"] or "").strip(),
                    steps=(r["Steps"] or "").strip(),
                    expected_result=(r["Expected Result"] or "").strip(),
                    browser=(r["Browser"] or "").strip(),
                    device=(r["Device"] or "").strip(),
                    status=(r["Status"] or "").strip(),
                )
                for r in reader
            ]
        if not rows:
            raise DatasetError(f"{csv_path.name} contains no data rows.")
        return cls(rows, csv_path)

    # -- lookups --------------------------------------------------------------------

    def get(self, issue_key: str) -> TestCase | None:
        return self.by_key.get(issue_key.strip().upper())

    def variants_of(self, case: TestCase) -> list[TestCase]:
        """All rows sharing this row's design (browser/device siblings)."""
        return [r for r in self._by_design[case.design_key] if r.issue_key != case.issue_key]

    def designs(self) -> dict[str, list[TestCase]]:
        """design_key -> rows, for every design in the dataset."""
        return dict(self._by_design)

    # -- validation -----------------------------------------------------------------

    def validate(self) -> dict[str, Any]:
        """Integrity report. Guards the server against a bad replacement CSV."""
        problems: list[str] = []
        keys = [r.issue_key for r in self.rows]
        dupes = [k for k, n in Counter(keys).items() if n > 1]
        if dupes:
            problems.append(f"duplicate Issue Keys: {dupes[:10]} (total {len(dupes)})")

        blanks = 0
        for r in self.rows:
            d = asdict(r)
            blanks += sum(1 for v in d.values() if not str(v).strip())
        if blanks:
            problems.append(f"{blanks} blank cell(s) across all rows")

        unknown_priority = sorted({r.priority for r in self.rows} - set(PRIORITY_ORDER))
        if unknown_priority:
            problems.append(f"priority values outside the documented ordinal set: {unknown_priority}")

        unknown_status = sorted({r.status for r in self.rows} - set(STATUS_ORDER))
        if unknown_status:
            problems.append(f"unrecognised status values: {unknown_status}")

        if len(set(r.issue_type for r in self.rows)) != 1 or self.rows[0].issue_type != "Test":
            problems.append("Issue Type is expected to be uniformly 'Test' in this dataset")

        return {
            "ok": not problems,
            "rows": len(self.rows),
            "unique_designs": len(self._by_design),
            "duplicate_summaries": len(self.rows) - len(self._by_design),
            "source": str(self.source),
            "problems": problems,
        }

    # -- stats ----------------------------------------------------------------------

    def value_counts(self, column: str) -> dict[str, int]:
        mapping = {
            "module": "component",
            "component": "component",
            "priority": "priority",
            "test_type": "test_type",
            "browser": "browser",
            "device": "device",
            "status": "status",
            "issue_type": "issue_type",
        }
        attr = mapping.get(column.strip().lower())
        if attr is None:
            raise DatasetError(
                f"Unknown field '{column}'. Valid fields: {sorted(mapping)}"
            )
        counts = Counter(getattr(r, attr) for r in self.rows)
        if attr == "priority":
            return dict(sorted(counts.items(), key=lambda kv: -PRIORITY_ORDER.get(kv[0], 0)))
        if attr == "status":
            return dict(sorted(counts.items(), key=lambda kv: -STATUS_ORDER.get(kv[0], 0)))
        return dict(sorted(counts.items()))

    def priority_breakdown(self, module: str | None = None) -> dict[str, Any]:
        rows = self._by_module.get(module, []) if module else self.rows
        if module and not rows:
            raise DatasetError(f"Unknown module '{module}'. Valid modules: {self.modules}")
        matrix: dict[str, dict[str, int]] = {}
        for r in rows:
            m = matrix.setdefault(r.component, {})
            m[r.priority] = m.get(r.priority, 0) + 1
        # normalise column order
        for m in matrix.values():
            for p in self.priorities:
                m.setdefault(p, 0)
        out = {m: dict(sorted(v.items(), key=lambda kv: -PRIORITY_ORDER.get(kv[0], 0)))
               for m, v in sorted(matrix.items())}
        return {
            "modules": out,
            "totals_by_priority": self.value_counts("priority") if not module else
            dict(sorted(Counter(r.priority for r in rows).items(),
                        key=lambda kv: -PRIORITY_ORDER.get(kv[0], 0))),
        }

    def coverage_matrix(self, modules: Sequence[str] | None = None) -> dict[str, Any]:
        wanted = list(modules) if modules else self.modules
        unknown = [m for m in wanted if m not in self._by_module]
        if unknown:
            raise DatasetError(f"Unknown module(s): {unknown}. Valid modules: {self.modules}")
        matrix: dict[str, dict[str, int]] = {}
        for m in wanted:
            counts = Counter(r.test_type for r in self._by_module[m])
            matrix[m] = {t: counts.get(t, 0) for t in self.test_types}
            matrix[m]["__total__"] = len(self._by_module[m])
        return {"test_types": self.test_types, "modules": matrix}

    def coverage_gaps(
        self, min_cases: int = 1, modules: Sequence[str] | None = None,
        test_types: Sequence[str] | None = None,
    ) -> list[dict[str, Any]]:
        wanted_modules = list(modules) if modules else self.modules
        wanted_types = list(test_types) if test_types else self.test_types
        gaps: list[dict[str, Any]] = []
        for m in wanted_modules:
            counts = Counter(r.test_type for r in self._by_module[m])
            for t in wanted_types:
                n = counts.get(t, 0)
                if n < min_cases:
                    gaps.append(
                        {
                            "module": m,
                            "test_type": t,
                            "cases": n,
                            "shortfall": min_cases - n,
                            "severity": "missing" if n == 0 else "thin",
                        }
                    )
        # thin/missing first, then fewest cases, then alphabetical for stability
        gaps.sort(key=lambda g: (g["cases"], g["module"], g["test_type"]))
        return gaps

    # -- query ----------------------------------------------------------------------

    def query(
        self,
        module: str | None = None,
        priorities: Sequence[str] | None = None,
        min_priority: str | None = None,
        test_types: Sequence[str] | None = None,
        browsers: Sequence[str] | None = None,
        devices: Sequence[str] | None = None,
        statuses: Sequence[str] | None = None,
        exclude_statuses: Sequence[str] | None = None,
        keyword: str | None = None,
        search_fields: Sequence[str] | None = None,
        sort_by: str = "issue_key",
        descending: bool = False,
    ) -> list[TestCase]:
        """Filter the dataset. Unknown enum values raise DatasetError listing valid ones."""
        self._check_values(module=module, priorities=priorities, min_priority=min_priority,
                           test_types=test_types, browsers=browsers, devices=devices,
                           statuses=statuses, exclude_statuses=exclude_statuses)

        min_rank = PRIORITY_ORDER.get(min_priority, 0) if min_priority else None
        wanted_prio = set(priorities) if priorities else None
        wanted_type = set(test_types) if test_types else None
        wanted_browser = set(browsers) if browsers else None
        wanted_device = set(devices) if devices else None
        wanted_status = set(statuses) if statuses else None
        banned_status = set(exclude_statuses) if exclude_statuses else set()

        kw = keyword.strip().lower() if keyword else None
        fields = tuple(search_fields) if search_fields else DEFAULT_SEARCH_FIELDS
        bad_fields = [f for f in fields if f not in CSV_to_attr()]
        if bad_fields:
            raise DatasetError(
                f"Unknown search field(s): {bad_fields}. Valid: {sorted(CSV_to_attr())}"
            )

        out: list[TestCase] = []
        for r in self.rows:
            if module and r.component != module:
                continue
            if wanted_prio and r.priority not in wanted_prio:
                continue
            if min_rank is not None and r.priority_rank < min_rank:
                continue
            if wanted_type and r.test_type not in wanted_type:
                continue
            if wanted_browser and r.browser not in wanted_browser:
                continue
            if wanted_device and r.device not in wanted_device:
                continue
            if wanted_status and r.status not in wanted_status:
                continue
            if banned_status and r.status in banned_status:
                continue
            if kw:
                haystack = " ".join(str(getattr(r, CSV_to_attr()[f])) for f in fields).lower()
                if kw not in haystack:
                    continue
            out.append(r)

        return sort_cases(out, sort_by, descending)

    def _check_values(self, **kwargs: Any) -> None:
        def check(label: str, values: Any, valid: Sequence[str]) -> None:
            if values is None:
                return
            seq = [values] if isinstance(values, str) else list(values)
            bad = [v for v in seq if v not in valid]
            if bad:
                raise DatasetError(
                    f"Invalid {label}: {bad}. Valid values: {list(valid)}"
                )

        check("module", kwargs.get("module"), self.modules)
        check("priority", kwargs.get("priorities"), self.priorities)
        check("min_priority", kwargs.get("min_priority"), self.priorities)
        check("test_type", kwargs.get("test_types"), self.test_types)
        check("browser", kwargs.get("browsers"), self.browsers)
        check("device", kwargs.get("devices"), self.devices)
        check("status", kwargs.get("statuses"), self.statuses)
        check("exclude_status", kwargs.get("exclude_statuses"), self.statuses)


def CSV_to_attr() -> dict[str, str]:
    """Map the friendly search-field names onto TestCase attributes."""
    return {
        "summary": "summary",
        "description": "description",
        "labels": "labels",
        "steps": "steps",
        "expected_result": "expected_result",
        "preconditions": "preconditions",
        "test_type": "test_type",
        "priority": "priority",
        "module": "component",
        "component": "component",
    }


def sort_cases(cases: Iterable[TestCase], sort_by: str = "issue_key",
               descending: bool = False) -> list[TestCase]:
    """
    Stable sort with an Issue-Key tie-break so results are always reproducible.

    sort_by: issue_key | priority | status | module | test_type | summary
    """
    key = (sort_by or "issue_key").strip().lower()
    sorters = {
        "issue_key": lambda c: key_sort_value(c.issue_key),
        "priority": lambda c: c.priority_rank,
        "status": lambda c: c.status_rank,
        "module": lambda c: c.component.lower(),
        "test_type": lambda c: c.test_type.lower(),
        "summary": lambda c: c.summary.lower(),
    }
    if key not in sorters:
        raise DatasetError(f"Unknown sort_by '{sort_by}'. Valid: {sorted(sorters)}")
    fn = sorters[key]
    return sorted(cases, key=lambda c: (fn(c), key_sort_value(c.issue_key)), reverse=descending)


def key_sort_value(issue_key: str) -> int:
    """Numeric part of VWO-1234, for stable ordering. Non-numeric -> large sentinel."""
    m = re.search(r"(\d+)$", issue_key or "")
    return int(m.group(1)) if m else 10**9


def rank_cases(
    cases: Iterable[TestCase],
    exclude_statuses: Sequence[str] = DEFAULT_EXCLUDED_STATUSES,
    unique_designs_only: bool = False,
) -> list[TestCase]:
    """
    Rank highest-priority / most-ready first: score desc, then Issue Key asc.

    exclude_statuses     - default drops 'Deprecated' (415 of 5000 source rows)
    unique_designs_only  - collapse browser/device variants to one row per design
    """
    banned = set(exclude_statuses or ())
    pool = [c for c in cases if c.status not in banned]
    if unique_designs_only:
        seen: set[str] = set()
        deduped: list[TestCase] = []
        for c in sorted(pool, key=lambda c: (-c.score(), key_sort_value(c.issue_key))):
            if c.design_key in seen:
                continue
            seen.add(c.design_key)
            deduped.append(c)
        return deduped
    return sorted(pool, key=lambda c: (-c.score(), key_sort_value(c.issue_key)))


# --------------------------------------------------------------------------------------
# Schema description (ground truth for clients — stops them inventing filter values)
# --------------------------------------------------------------------------------------

FIELD_DESCRIPTIONS: list[dict[str, str]] = [
    {"field": "issue_type", "csv_column": "Issue Type", "description": "Always 'Test' in this dataset."},
    {"field": "issue_key", "csv_column": "Issue Key", "description": "Unique test id, e.g. VWO-1001. Sequential and stable."},
    {"field": "summary", "csv_column": "Summary", "description": "Title. Pattern: '[Module] TestType: <verb> <object>'. Not unique (duplicate designs exist)."},
    {"field": "description", "csv_column": "Description", "description": "One-sentence statement of intent."},
    {"field": "priority", "csv_column": "Priority", "description": "Ordinal: Highest > High > Medium > Low."},
    {"field": "component", "csv_column": "Component", "description": "The module under test (the 'module' filter)."},
    {"field": "labels", "csv_column": "Labels", "description": "House pattern: '<module-slug> <type-slug> regression'."},
    {"field": "test_type", "csv_column": "Test Type", "description": "Functional, UI/UX, Accessibility, Boundary, API, Security, Performance, Negative, Regression."},
    {"field": "preconditions", "csv_column": "Preconditions", "description": "Setup requirements."},
    {"field": "steps", "csv_column": "Steps", "description": "Numbered steps joined by ' | '."},
    {"field": "expected_result", "csv_column": "Expected Result", "description": "Expected outcome."},
    {"field": "browser", "csv_column": "Browser", "description": "Chrome 148, Safari 19, Edge 148, Firefox 141."},
    {"field": "device", "csv_column": "Device", "description": "desktop, mobile (iOS), mobile (Android), tablet."},
    {"field": "status", "csv_column": "Status", "description": "Readiness: Ready > Automated > Draft > Deprecated."},
]


def schema_payload(ds: Dataset) -> dict[str, Any]:
    return {
        "dataset": ds.source.name,
        "source_path": str(ds.source),
        "rows": len(ds.rows),
        "unique_designs": len(ds.designs()),
        "duplicate_design_rows": len(ds.rows) - len(ds.designs()),
        "fields": FIELD_DESCRIPTIONS,
        "filter_domains": {
            "module": ds.modules,
            "priority": ds.priorities,
            "test_type": ds.test_types,
            "browser": ds.browsers,
            "device": ds.devices,
            "status": ds.statuses,
        },
        "orders": {"priority": PRIORITY_ORDER, "status": STATUS_ORDER},
        "ranking_rule": (
            "score = priority_rank * 100 + status_rank * 10; "
            "tie-break Issue Key ascending; 'Deprecated' excluded unless include_deprecated=true"
        ),
    }


# --------------------------------------------------------------------------------------
# Module-level singleton (loaded once per server process)
# --------------------------------------------------------------------------------------

_DATASET: Dataset | None = None


def get_dataset() -> Dataset:
    """Lazy singleton so `--help` / import never fails on a missing CSV."""
    global _DATASET
    if _DATASET is None:
        _DATASET = Dataset.load()
    return _DATASET


def reset_dataset() -> None:
    """Test hook: force a reload on next access."""
    global _DATASET
    _DATASET = None
