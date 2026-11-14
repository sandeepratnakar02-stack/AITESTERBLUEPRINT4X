# 01 — Test Creator MCP · Plan

> Status: **IMPLEMENTED** — see `testcase_creator-mcp/` (20 tools, 16 tests passing, registered in
> `.vscode/mcp.json` as `testcase-creator`). §5 Group G (authoring tools) remains deferred.
> Chapter: `chapter_14_MCP_CREATE_VIBE` · Stack: **FastMCP (Python)** · Data: `data/vwo_5000_test_cases.csv`

---

## 1. Objective (from `00_Objective.md`)

> "We have a list of vwo_5000_test_cases. Our task is to give them this test case as a tool. The tools that we
> are going to develop will be available in this CSV, which we are going to read. We are going to give them access
> so they can get the test case by: priority, module, maximum and minimum limitations. They can find the top test
> cases that have to be executed for a particular module. I want you to build a lot of tools that can be helpful
> for us as a test creator MCP."

**In one line:** a shareable, read-only MCP server that turns the 5000-row VWO test-case CSV into queryable
tools — so a QA/Dev can ask "give me the top 10 cases to run for Funnels" or "how many Highest-priority cases
are not yet automated?" and get a deterministic, traceable answer.

---

## 2. Verified Facts (measured, not assumed)

Per the house rules in `chapter_01_LLM_BASICS/ANTI-HALLUCINATION.rules.md`, everything below was measured
from the actual file.

| Fact | Value |
|---|---|
| Rows | **5000** |
| Columns | **14** — `Issue Type, Issue Key, Summary, Description, Priority, Component, Labels, Test Type, Preconditions, Steps, Expected Result, Browser, Device, Status` |
| Blank cells | **0** in every column |
| Issue Key | `VWO-1001` → `VWO-6000`, **sequential, 5000 unique** |
| `Issue Type` | always `Test` (1 value) → this CSV is **Jira-export shaped** |
| Components (modules) | **17** — 265–333 cases each |
| Priority | **4**, ordinal — `Highest` 396 · `High` 1546 · `Medium` 2198 · `Low` 860 |
| Test Type | **9** — Functional 1516 · Negative 810 · UI/UX 515 · API 415 · Boundary 406 · Regression 379 · Security 368 · Accessibility 321 · Performance 270 |
| Browser | **4** — Chrome 148 · Safari 19 · Edge 148 · Firefox 141 |
| Device | **4** — desktop · mobile (iOS) · mobile (Android) · tablet |
| Status | **4** — Ready 2234 · Automated 1594 · Draft 757 · Deprecated 415 |
| `Steps` format | 4 steps joined by `" | "` — **in all 5000 rows** |
| `Labels` | **153** distinct, always `<module-slug> <type-slug> regression` |
| Title verbs | 12 only — `verify, check, validate, ensure, confirm, test, prevent, handle, reject, re-verify, regression-check, measure` |
| **Duplicate summaries** | **3480 of 5000** duplicates → only **1520 unique titles** |
| Design groups `(module, type, object, priority, status)` | **4213** distinct, max **5** rows per combo |

### 2.1 The two findings that should shape the design

1. **Browser × Device is a multiplier, not extra coverage.** 1520 unique designs expand into 5000 rows.
   A "test creator" therefore needs **dedupe-aware** tools, or users will plan to execute the same test 4–16×.
2. **The content is templated/synthetic.** Description, Steps, Preconditions and Expected Result follow fixed
   sentence templates. Consequences:
   - A `generate_test_case_draft` tool can reproduce the house style **exactly** (good, deterministic).
   - But this is a **generated corpus**, not curated real-world QA data. Ranking outputs must be labelled as
     "per this dataset's rules", never presented as a real risk assessment.

---

## 3. Design Principles

1. **Ground truth first.** No tool should require the caller to guess a valid filter value. Every enum
   (module, priority, type, browser, device, status) must be discoverable via a tool/resource.
2. **Deterministic & repeatable.** Same input → same output, including stable tie-breaks. No randomness, no LLM
   inference inside the server.
3. **Read-only v1.** The CSV is never mutated. The only writes are exports into a dedicated `output/` folder.
4. **Explicit limits.** Every list-returning tool has a bounded `limit` (with a documented max) so a client can
   never be flooded with 5000 rows.
5. **Traceable.** Every returned case carries its `Issue Key`, so any answer can be audited back to a row.
6. **Cheap by default, rich on request.** Provide lightweight `count_*` / matrix tools so the client can plan
   before pulling rows.

---

## 4. Architecture

```
chapter_14_MCP_CREATE_VIBE/
├── 00_Objective.md
├── 01_TestCreatorMCP.Plan.md        <- this document
├── data/
│   └── vwo_5000_test_cases.csv      <- read-only source of truth (3.7 MB)
└── testcase_creator-mcp/
    ├── pyproject.toml               <- FastMCP dependency, entry point
    ├── README.md                    <- how to install/share (QA + Dev)
    ├── src/testcreator_mcp/
    │   ├── server.py                <- FastMCP app; registers all tools/resources/prompts
    │   ├── dataset.py               <- CSV load + in-memory index (load once at startup)
    │   ├── models.py                <- TestCase dataclass, Filter/Query params, enums
    │   ├── ranking.py               <- deterministic scoring for "top cases"
    │   ├── coverage.py              <- dedupe, coverage matrix, gap detection
    │   ├── export.py                <- Markdown / CSV / JSON / Jira-CSV writers
    │   └── authoring.py             <- draft generation + validation
    ├── tests/                       <- pytest, golden-value assertions
    └── output/                      <- generated exports (gitignored except .gitkeep)
```

**Decisions (to confirm before coding):**

| Decision | Choice | Rationale |
|---|---|---|
| Framework | **FastMCP 4.1.0** (latest on PyPI, verified; requires Python ≥ 3.10) | user requirement |
| Storage | **In-memory index over stdlib `csv`** — no DB | 5000 rows is ~3.7 MB; a DB adds cost with no benefit |
| Dependencies | Minimal: `fastmcp` (+ `pytest` dev only). No pandas | keeps the shared package light for other QA/Dev |
| Python env | Dedicated venv in this chapter (recommend **3.13** for widest wheel coverage) | matches the ch09/ch10 pattern in this repo |
| Data path | Resolved from env `TESTCREATOR_CSV`, defaulting to the bundled file | lets others point at their own export |
| Transport | **stdio** for local/laptop use, **HTTP** for team sharing | one codebase, two deployment modes |
| Versioning | Tools are additive; renaming a tool is a breaking change → bump `0.x` | consumers cache tool lists |

> **Before writing code:** confirm the FastMCP 4.x API surface (decorators, `run()` transports, CLI) against the
> installed package — `uv pip install fastmcp==4.1.0` then check `fastmcp --help` and its bundled docs.
> Do **not** assume 2.x-era APIs; this repo has already been bitten by MCP package drift (Playwright/Appium).

---

## 5. Tool Catalogue

Format: **`tool_name`** — purpose · key inputs · returns · why it earns a slot.
Grouped by job. ✅ = recommended for **v1**; 🔜 = v2/fast-follow.

### Group A — Ground truth (prevents hallucinated filters)

| # | Tool | Purpose / inputs / returns |
|---|---|---|
| A1 ✅ | **`get_dataset_schema`** | Columns, meaning, value domains, row count, one sample record. Inputs: none. Returns: schema + sample. *The anti-hallucination anchor.* |
| A2 ✅ | **`list_modules`** | The 17 modules + case count each. Input: `include_counts`. |
| A3 ✅ | **`list_filter_values`** | All valid values + counts for priority / test type / browser / device / status. Input: `field`. |
| A4 🔜 | **`get_dataset_stats`** | Distribution cross-tabs: module×priority, module×type, status×priority. Input: `group_by[]`. |
| A5 🔜 | **`validate_dataset`** | Integrity check: schema match, blanks, duplicate keys, enum drift. Returns pass/fail + problems. *Guards every future CSV drop.* |

### Group B — Core retrieval (the explicit ask)

| # | Tool | Purpose / inputs / returns |
|---|---|---|
| B1 ✅ | **`search_test_cases`** | The workhorse. Inputs: `module, priority[], min_priority, test_type[], browser[], device[], status[], keyword, has_text_in, sort, limit, offset, fields`. Returns: matching cases + total count. |
| B2 ✅ | **`get_test_case`** | Exact lookup by `Issue Key` (e.g. `VWO-1024`). Returns: full record. |
| B3 ✅ | **`get_test_cases_by_module`** | Convenience: module + optional test type / priority / status, paginated. *Mirrors how QA actually asks.* |
| B4 ✅ | **`get_test_cases_by_priority`** | Convenience: priority floor **or** exact set (`Highest`+`High`, etc.), optional module. |
| B5 🔜 | **`get_test_cases_by_ids`** | Batch fetch from a list of keys (bulk handoff, spreadsheet ↔ MCP round-trip). |
| B6 🔜 | **`get_test_case_variants`** | Given one key, return sibling rows sharing the same design across browser/device. *Directly exploits finding 2.1.* |

### Group C — Ranking ("top test cases for a module")

| # | Tool | Purpose / inputs / returns |
|---|---|---|
| C1 ✅ | **`get_top_test_cases_for_module`** | **The headline tool.** Inputs: `module, top_n, min_priority, exclude_status[], unique_designs_only, include_score`. Returns: ranked cases with their score + the reason it ranked there. Scoring spec in §6. |
| C2 🔜 | **`get_smoke_suite`** | Cross-module smoke set: Highest-priority `Ready` cases, `max_per_module`. Inputs: `max_per_module, modules[]`. |

### Group D — Counts & limits ("maximum and minimum limitations")

| # | Tool | Purpose / inputs / returns |
|---|---|---|
| D1 ✅ | **`count_test_cases`** | Same filter surface as `search_test_cases`, but returns **only counts** (optionally grouped by a field). Cheap pre-flight before pulling rows. |
| D2 ✅ | **`get_priority_breakdown`** | module × priority matrix with totals — instantly shows where `Highest` coverage is thin (e.g. A/B Testing has only 12 Highest). |
| D3 🔜 | **`estimate_effort`** | Cases × per-type minutes → rough duration band. **Must be flagged as a heuristic**, with the minutes-per-type table exposed as an editable parameter, never as a fact. |

### Group E — Dedupe & coverage intelligence (the real differentiator)

| # | Tool | Purpose / inputs / returns |
|---|---|---|
| E1 ✅ | **`get_unique_test_designs`** | Collapses the 5000 rows to ~1520 designs; returns designs + variant count + browser/device coverage. Inputs: `module, test_type, min_priority, limit`. |
| E2 🔜 | **`find_duplicate_groups`** | Groups identical/near-identical designs and shows the expansion (up to 5 rows per design group). Explains *why* the file has 3480 duplicate titles. |
| E3 ✅ | **`get_module_coverage_matrix`** | module × test-type counts. Answers "does Reports have any Performance tests?" |
| E4 🔜 | **`find_coverage_gaps`** | Ranks module×type combos that are **absent or below a threshold**. Inputs: `min_cases, modules[], test_types[]`. *The most valuable planning output.* |

### Group F — Export & handoff (sharing with QA/Dev)

| # | Tool | Purpose / inputs / returns |
|---|---|---|
| F1 ✅ | **`export_test_cases`** | Writes a filtered set to `output/` as **Markdown / CSV / JSON / Jira-import CSV** (the 14 columns already match Jira fields). Input: filters + `format` + `filename`. Returns: absolute path + row count. |
| F2 🔜 | **`generate_test_plan`** | Per-module execution plan in ordered batches (Smoke → Core → Regression → Extended) with counts and the filters used, so it is reproducible. |

### Group G — Authoring (true "test *creator*")

| # | Tool | Purpose / inputs / returns |
|---|---|---|
| G1 🔜 | **`generate_test_case_draft`** | Emits a **new** case in the exact house schema, reusing the 12 observed verbs, the `[Module] Type: verb object` title pattern, the 4-step template and the label convention. Next `Issue Key` suggested. |
| G2 🔜 | **`validate_test_case_draft`** | Checks a proposed case against the schema, enum domains, title/label/step patterns, and flags near-duplicates against the existing 1500 designs. |

### Group H — FastMCP-native surface (beyond tools)

FastMCP supports more than tools; using these makes the server self-describing:

- **Resources** (deterministic, cacheable reads):
  - `testcases://schema` — the ground-truth schema (same payload as A1)
  - `testcases://modules` — the 17 modules + counts
  - `testcase://{issue_key}` — one case by key
  - `testcases://module/{module}/summary` — per-module summary card
- **Prompts** (reusable instruction templates):
  - `plan_module_testing(module, priority_floor)` — "build a test plan for X at ≥ High"
  - `review_new_test_case(case_text)` — "review this draft against house conventions"
- **Structured output + errors:** declare return schemas so clients get typed fields; raise tool errors with
  actionable messages (valid values listed) instead of bare failures.

### 5.1 v1 recommendation

**v1 = 10 tools:** `A1, A2, A3, B1, B2, B3, B4, C1, D1, D2, E1, E3, F1` (13 marked ✅ above).

**Why not all 24 at once:** every tool definition is injected into the client's context and competes for the
model's attention. A 24-tool server measurably degrades tool selection. Ship the 13 that cover the stated
objective, then add Groups D2–G2. FastMCP's tagging/`enabled` support can also expose a **"core" vs "full"**
profile from the *same* codebase — one server, two sizes.

---

## 6. Ranking & Limit Semantics (must be approved before coding)

`get_top_test_cases_for_module` needs a rule. Proposed **deterministic** score, documented in the tool's
description so any client can explain the order:

```
score = priority_rank × 100  +  type_weight × 10  +  status_rank
tie-break: Issue Key ascending (stable, repeatable)
```

| Dimension | Mapping | Status |
|---|---|---|
| `priority_rank` | Highest 4 · High 3 · Medium 2 · Low 1 | **derived** — the only truly ordinal field |
| `status_rank` | Ready 3 · Automated 2 · Draft 1 · Deprecated 0 | **derived**; `Deprecated` excluded by default |
| `type_weight` | e.g. Functional 5 · Regression 4 · Security 3 · Accessibility 3 · Boundary 2 · Negative 2 · API 2 · Performance 1 · UI/UX 1 | **⚠ POLICY — needs your sign-off.** Not derivable from the data. |

**Limits:** every list tool clamps `limit` to a documented max (proposed 200) and defaults to 20–25;
`count_test_cases` is unlimited (counts are cheap). `min_priority` and `max`/`min` bounds are exposed exactly
as the objective asks ("maximum and minimum limitations").

---

## 7. Build Phases

| Phase | Deliverable | Exit criteria |
|---|---|---|
| **0. Scaffold** | venv + `pip install fastmcp==4.1.0`; confirm API surface against installed package | `fastmcp --help` inspected; API confirmed, not assumed |
| **1. Data layer** | `dataset.py` + `models.py` + `validate_dataset` logic | pytest asserts the §2 numbers exactly (5000 / 17 / 396 / 1520) |
| **2. Core tools** | v1 tools A1–A3, B1–B4, D1, D2 | every tool callable via MCP Inspector; invalid filter values rejected with the valid list |
| **3. Intelligence** | C1, E1, E3, F1 | ranking output stable across runs; exports byte-identical for identical input |
| **4. Hardening** | pagination, error messages, output schemas, README | 0 unhandled exceptions on a fuzz pass over all filter combos |
| **5. Extend** | Groups D3–G2 (+ resources & prompts) | tool count/profile switch proven |
| **6. Share** | packaging + `.vscode/mcp.json` snippet + HTTP mode | a second machine connects and reproduces the same answers |

---

## 8. Verification Strategy

- **Golden-value tests** — assert the measured totals (§2) so a swapped CSV fails loudly.
- **Determinism test** — run each ranking/export tool twice; outputs must be identical.
- **Boundary tests** — `limit=0`, `limit=99999`, unknown module, unknown priority, empty result, `offset` past end.
- **MCP Inspector** — the same workflow already proven in this repo:
  `npx @modelcontextprotocol/inspector@latest --web --config <cfg>.json`, then connect and call each tool.
  (Known quirks: config needs the `mcpServers` key; stdio cold starts can exceed the ~20 s connect timeout,
  so retry once.)
- **Cross-client check** — verify at least one non-VS Code client (e.g. Claude Desktop or the Inspector CLI)
  sees the same tool list.

---

## 9. Sharing & Distribution

1. **Local (stdio):** `python server.py` in `testcase_creator-mcp/`, wired via a `.vscode/mcp.json`
   snippet shipped in the README.
2. **Team (HTTP):** run as an HTTP MCP server so several QA/Dev can point at one instance.
   ⚠ Requires an auth story before exposing beyond localhost — this repo already learned that lesson with
   the GitHub PAT (see §10).
3. **Package:** `pyproject.toml` with an entry point so `uvx`/`pipx` install works without cloning.
4. **Data:** bundle the CSV, and allow `TESTCREATOR_CSV` override. The CSV contains no secrets.

---

## 10. Risks, Guardrails & Open Questions

**Guardrails**
- Do **not** claim the dataset is real QA intelligence — it is templated. Every ranking response should carry
  the rule used, and every case its `Issue Key`.
- No secrets in the repo. If HTTP mode adds a token, add the config file to `.gitignore` first
  (the `*-mcp.json` rule added earlier already covers that pattern).
- Keep `output/` gitignored; exports are artifacts, not source.

**Open questions — need your decision before coding**

1. **Ranking policy:** do you approve the `type_weight` table in §6, or should ranking be **priority → status
   only** (no opinion about test types)?
2. **Deprecated / Draft:** exclude by default in "top cases" (proposed), or include with a flag?
3. **Dedupe default:** should "top test cases" collapse browser/device variants to **1 per design** by default
   (`unique_designs_only=True`)? This is the single biggest lever on output usefulness.
4. **Scope of v1:** 13 core tools, or do you want the generative tools (`generate_test_case_draft`) in v1?
5. **Format:** exactly the same 14-column CSV out, or a Jira-import CSV with `Priority`/`Component` mapped
   to Jira's expectations?
6. **Audience/transport:** laptop-only stdio, or a shared HTTP instance for the team?
7. **Is this CSV the permanent source of truth**, or will it be replaced by a Jira sync later? (Affects whether
   we need `validate_dataset` guards and whether keys should be treated as stable.)

---

## 11. Non-Goals (v1)

- Executing tests (Playwright / Selenium / Appium MCP already cover execution — this server **plans and hands off**).
- Writing back to Jira or mutating the CSV.
- Screen-scraping or generating assertions from live application state.
- Any LLM call inside the server: outputs must stay deterministic and auditable.
