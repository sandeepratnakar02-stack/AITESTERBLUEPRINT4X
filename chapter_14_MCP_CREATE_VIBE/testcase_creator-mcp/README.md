# Test Creator MCP

A **read-only** MCP server that exposes the VWO test-case catalogue
(`../data/vwo_5000_test_cases.csv` — 5000 cases, 17 modules) as queryable tools, so a QA or
Dev can ask *"what should we run for module X?"* and get a deterministic, traceable answer.

Built with **FastMCP 4.1.0**. No LLM calls, no randomness, no database, no mutation of the CSV.

---

## Quick start

```bash
cd chapter_14_MCP_CREATE_VIBE/testcase_creator-mcp

uv venv --python 3.13
uv pip install --python .venv/Scripts/python.exe fastmcp
uv pip install --python .venv/Scripts/python.exe pytest      # optional, for tests

.venv/Scripts/python.exe server.py                            # stdio (default)
.venv/Scripts/python.exe server.py --transport http --port 8765   # team sharing
.venv/Scripts/python.exe -m pytest tests -q                   # 16 tests
```

The CSV is found automatically. To point at a different export, set `TESTCASE_CSV`:

```bash
TESTCASE_CSV=/path/to/other_cases.csv .venv/Scripts/python.exe server.py
```

---

## Connecting a client

### VS Code / Cursor — `.vscode/mcp.json`

```json
{
  "servers": {
    "testcase-creator": {
      "type": "stdio",
      "command": "c:\\AITESTERBLUEPRINT4X\\chapter_14_MCP_CREATE_VIBE\\testcase_creator-mcp\\.venv\\Scripts\\python.exe",
      "args": [
        "c:\\AITESTERBLUEPRINT4X\\chapter_14_MCP_CREATE_VIBE\\testcase_creator-mcp\\server.py"
      ]
    }
  }
}
```

### Claude Desktop / Cursor (Claude-style config)

```json
{
  "mcpServers": {
    "testcase-creator": {
      "command": "c:\\AITESTERBLUEPRINT4X\\chapter_14_MCP_CREATE_VIBE\\testcase_creator-mcp\\.venv\\Scripts\\python.exe",
      "args": ["c:\\AITESTERBLUEPRINT4X\\chapter_14_MCP_CREATE_VIBE\\testcase_creator-mcp\\server.py"]
    }
  }
}
```

### MCP Inspector (debugging)

```bash
npx @modelcontextprotocol/inspector@latest --web --config <cfg>.json
```

> The Inspector requires the `mcpServers` key (the VS Code `servers` key is rejected).
> Stdio cold start can exceed the Inspector's ~20 s connect timeout — click connect twice if
> the first attempt reports `Failed`.

### FastMCP CLI (verified syntax in 4.1.0)

```bash
# list tools / resources / prompts over a real stdio connection
.venv/Scripts/fastmcp list --command ".venv/Scripts/python.exe server.py" --resources --prompts

# call a tool (use --target explicitly)
.venv/Scripts/fastmcp call --command ".venv/Scripts/python.exe server.py" \
    --target get_top_test_cases_for_module \
    --input-json '{"module":"Funnels","top_n":5,"min_priority":"High"}' --json

# read a resource / resource template
.venv/Scripts/fastmcp call --command ".venv/Scripts/python.exe server.py" --target testcases://schema --json
.venv/Scripts/fastmcp call --command ".venv/Scripts/python.exe server.py" --target testcase://VWO-1001 --json
```

> `fastmcp list server.py:mcp` does **not** work in 4.1.0 — the CLI wants either a Python file it
> can launch itself or an explicit `--command`. The `--command` form above is verified working.

### HTTP (shared with the team)

```bash
.venv/Scripts/python.exe server.py --transport http --port 8765
# MCP endpoint: http://127.0.0.1:8765/mcp/
```

⚠ Add an auth story before binding beyond `127.0.0.1`.

---

## Tools (20)

### Ground truth — discover before filtering
| Tool | Purpose |
|---|---|
| `get_dataset_schema` | Columns, meanings, every valid filter value, the ranking rule |
| `list_modules` | The 17 modules (+ counts) |
| `list_filter_values` | Valid values + counts for any field |
| `get_dataset_stats` | Distributions, or a cross-tab (`group_by`) |
| `validate_dataset` | Integrity check: duplicate keys, blanks, enum drift |

### Retrieval
| Tool | Purpose |
|---|---|
| `search_test_cases` | General query: module, priorities, `min_priority`, test types, browser, device, status, keyword, sort, paging |
| `get_test_case` | One full case by Issue Key |
| `get_test_cases_by_ids` | Batch fetch by keys (reports missing ones) |
| `get_test_cases_by_module` | Module + optional narrowing |
| `get_test_cases_by_priority` | Exact priority or a floor |
| `get_test_case_variants` | Browser/device siblings of the same design |

### Ranking
| Tool | Purpose |
|---|---|
| `get_top_test_cases_for_module` | **Headline tool** — ranked execution list for a module |
| `get_smoke_suite` | Cross-module smoke set (Highest cases per module) |

### Counts & limits
| Tool | Purpose |
|---|---|
| `count_test_cases` | Count only, optional `group_by` — cheap pre-flight |
| `get_priority_breakdown` | module × priority matrix |

### Dedupe & coverage
| Tool | Purpose |
|---|---|
| `get_unique_test_designs` | Collapse the 5000 rows to ~1520 designs |
| `get_module_coverage_matrix` | module × test-type matrix |
| `find_coverage_gaps` | Missing / thin module × test-type combinations |
| `find_duplicate_designs` | Explain the duplicate titles (variant expansion) |

### Export
| Tool | Purpose |
|---|---|
| `export_test_cases` | Write `md` / `csv` (Jira-compatible 14 columns) / `json` to `output/` |

### Resources & prompt
- `testcases://schema`, `testcases://modules`, `testcase://{issue_key}`
- Prompt `plan_module_testing(module, priority_floor)` — a step-by-step plan template

---

## Ranking rule (deterministic)

```
score = priority_rank * 100 + status_rank * 10
tie-break: Issue Key ascending
priority_rank: Highest 4 > High 3 > Medium 2 > Low 1
status_rank:   Ready 3 > Automated 2 > Draft 1 > Deprecated 0
```

`Deprecated` is excluded from ranking unless `include_deprecated=true`.
Test type carries **no weight** — v1 deliberately avoids opinion-based claims about which
test types matter more.

---

## Things you must know about this dataset

Measured from the source file:

- **5000 rows, 14 columns, 0 blank cells**, keys `VWO-1001`…`VWO-6000` (sequential, unique).
- **3480 of 5000 summaries are duplicates → only 1520 unique designs.** Browser × Device is a
  multiplier, not extra coverage. Use `unique_designs_only=true` (or
  `get_unique_test_designs`) when planning, or you will schedule the same test many times.
- The content is **templated/generated** (12 title verbs, fixed sentence templates for
  description/steps/expected result). Treat rankings as *"per this dataset's rules"*, never as
  real risk assessments.
- `Issue Type` is always `Test` and the header matches Jira field names, so the `csv` export
  can be re-imported into Jira.

---

## Layout

```
testcase_creator-mcp/
├── server.py           FastMCP app: 20 tools, 3 resources, 1 prompt
├── dataset.py          CSV loader + query/rank/coverage engine (no MCP dependency)
├── tests/test_smoke.py 16 tests incl. golden numbers + in-process protocol round trips
├── pyproject.toml      packaging + console script
├── requirements.txt
└── output/             generated exports (gitignored)
```

`dataset.py` has no MCP imports, so it can be unit-tested or reused standalone.

---

## Not in v1

- Executing tests — Playwright / Selenium / Appium MCP cover execution; this server **plans and handoffs**.
- Writing back to Jira or mutating the CSV.
- Drafting new test cases (`generate_test_case_draft`) — designed in
  `../01_TestCreatorMCP.Plan.md` §5 Group G, deferred to a later phase.
