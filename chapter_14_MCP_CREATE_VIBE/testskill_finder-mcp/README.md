# Test Skill Finder MCP

An MCP server that turns a folder of agent **skills** into something any LLM client can search.
Ask for a capability in plain words — *"playwright api"*, *"flaky cypress test"*, *"test plan"*,
*"boundary values"*, *"postman collection"*, *"bola idor"* — and get the skill that covers it,
with an explanation of **why** it matched.

Built with **FastMCP 4.1.0**. No LLM calls, no embeddings, no database: lexical, deterministic,
repeatable.

> **Source of truth: the `skills/` folder.** 56 skills = 41 files downloaded from
> [PramodDutta/skillmasterclass](https://github.com/PramodDutta/skillmasterclass) (36 skills)
> plus a Cypress pack (12) and an API-testing pack (8) authored in the same house format.

---

## Catalogue

| Category | Count | Examples |
|---|---|---|
| STLC phases (`01`–`07`) | **14** | `jira-requirement-analyzer`, `test-plan-generator`, `test-scenario-designer`, `api-test-designer`, `test-case-writer`, `test-data-generator`, `automation-script-generator`, `regression-suite-selector`, `test-execution-tracker`, `bug-reporter`, `bug-triage-assistant`, `rca-analyzer`, `test-closure-reporter`, `test-coverage-analyzer` |
| Playwright pack | **11** | `pw-test-generator`, `pw-api-tester`, `pw-locator-fixer`, `pw-flaky-debugger`, `pw-network-mocker`, `pw-visual-regression`, `pw-accessibility-auditor`, `pw-trace-analyzer`, `pw-fixture-designer`, `pw-page-object-builder`, `pw-ci-configurator` |
| Selenium pack | **11** | `se-test-generator`, `se-locator-strategist`, `se-wait-fixer`, `se-grid-configurator`, `se-cross-browser-runner`, `se-framework-scaffolder`, `se-flaky-debugger`, `se-page-object-builder`, `se-data-driven-designer`, `se-driver-manager`, `se-report-integrator` |
| **Cypress pack** (authored) | **12** | `cy-test-generator`, `cy-locator-strategist`, `cy-page-object-builder`, `cy-data-driven-designer`, `cy-wait-fixer`, `cy-network-mocker`, `cy-flaky-debugger`, `cy-api-tester`, `cy-cross-browser-runner`, `cy-parallel-runner`, `cy-report-integrator`, `cy-framework-scaffolder` |
| **API-testing pack** (authored) | **8** | `api-contract-validator`, `api-auth-tester`, `api-negative-boundary-designer`, `api-security-tester`, `api-performance-smoker`, `api-mock-server-builder`, `api-chaining-workflow-tester`, `api-collection-organizer` |
| | **56** | |

Every skill is a `SKILL.md` with YAML frontmatter (`name`, `description`, `license`,
`metadata.pack` **or** `metadata.stlc-phase`, `version`) and the house body structure:
`## When to use` → `## Workflow` → `## Output shape` → `## Guardrails`.

---

## Quick start

```bash
cd chapter_14_MCP_CREATE_VIBE/testskill_finder-mcp

uv venv --python 3.13
uv pip install --python .venv/Scripts/python.exe fastmcp pytest

.venv/Scripts/python.exe scripts/sync_skills.py        # (re)download the upstream skills — idempotent
.venv/Scripts/python.exe server.py                       # stdio
.venv/Scripts/python.exe server.py --transport http --port 8770    # team sharing
.venv/Scripts/python.exe -m pytest tests -q              # 37 tests
PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe scripts/verify_mcp.py   # 28 end-to-end MCP checks
```

Point at a different skills folder with `SKILLS_DIR=/path/to/skills`.

---

## Connecting a client

### VS Code / Cursor — `.vscode/mcp.json`

```json
{
  "servers": {
    "testskill-finder": {
      "type": "stdio",
      "command": "c:\\AITESTERBLUEPRINT4X\\chapter_14_MCP_CREATE_VIBE\\testskill_finder-mcp\\.venv\\Scripts\\python.exe",
      "args": [
        "c:\\AITESTERBLUEPRINT4X\\chapter_14_MCP_CREATE_VIBE\\testskill_finder-mcp\\server.py"
      ]
    }
  }
}
```

### Claude Desktop / Cursor — same entry under the `mcpServers` key

```json
{
  "mcpServers": {
    "testskill-finder": {
      "command": "<absolute path to>\\.venv\\Scripts\\python.exe",
      "args": ["<absolute path to>\\server.py"]
    }
  }
}
```

### FastMCP CLI (verified syntax in 4.1.0)

```bash
.venv/Scripts/fastmcp list --command ".venv/Scripts/python.exe server.py" --resources --prompts
.venv/Scripts/fastmcp call --command ".venv/Scripts/python.exe server.py" \
    --target find_skill_for_task \
    --input-json '{"task":"stub the payments API in a Cypress test"}' --json
```

> `fastmcp list server.py:mcp` does **not** work in 4.1.0 — use `--command`, and `--target` for `call`.

> **Windows console gotcha:** skill content contains non-ASCII characters (`→`, `—`, `·`). The FastMCP
> CLI renders results with `rich`, which raises `UnicodeEncodeError` on a legacy `cp1252` console.
> Prefix CLI commands with `PYTHONIOENCODING=utf-8` (or run in Windows Terminal / VS Code's terminal).
> This affects only the CLI's display — the MCP payload itself is UTF-8 and real clients receive it intact.

### HTTP (share with a team)

```bash
.venv/Scripts/python.exe server.py --transport http --port 8770
# MCP endpoint: http://127.0.0.1:8770/mcp/
```

⚠ Add authentication before binding beyond `127.0.0.1`.

---

## Tools (15)

### Discovery
| Tool | Purpose |
|---|---|
| `list_skills` | List/filter skills by pack, kind, STLC phase or folder group |
| `list_packs` | Every framework pack and STLC phase with its members |
| `get_skill_stats` | Counts by kind / pack / phase / group |
| `validate_skills` | Structural check (missing fields, name↔folder mismatch, missing sections) |

### Finding
| Tool | Purpose |
|---|---|
| `search_skills` | Ranked keyword search with `matched_on` for every hit |
| `find_skill_for_task` | Natural-language task → best skills + why + the author's `use_when` |
| `search_skill_content` | Full-text search inside bodies, line-anchored snippets |
| `get_related_skills` | Neighbours: same pack/phase first, then shared vocabulary |

### Reading
| Tool | Purpose |
|---|---|
| `get_skill` | One skill's full instructions (metadata + body + sections + related) |
| `get_skill_metadata` | Frontmatter and triggers only (cheap) |
| `list_skill_files` | Files bundled with a skill (references, scripts, prompts) |
| `read_skill_file` | Read one bundled file (path-traversal guarded) |

### Workflow & export
| Tool | Purpose |
|---|---|
| `recommend_skills_for_phase` | One STLC phase, or the whole ordered lifecycle chain |
| `get_skill_index` | Complete catalogue in one compact, token-efficient payload |
| `export_skill_bundle` | Export skills to `output/` as `md`, `json` or a folder `bundle` |

**Resources:** `skills://index` · `skills://packs` · `skills://stats` · `skill://{name}` (resource template)
**Prompts:** `find_skill(keyword)` · `apply_skill(skill_name, task)` · `build_skill_chain(task)`

---

## How ranking works (deterministic)

```
score = Σ over query tokens of  token_weight × field_weight
field_weight : name 45 · pack 55 · stlc phase 22 · description 18 · trigger phrase 28 · title 8 · body 3
token_weight : IDF-style, clamped to [0.25, 3.0]  → specific words count more than generic ones
name matches : strongest counts in full, extras at 25 %   → "api"/"test" spam cannot win
specificity  : matching a rare intent token (weight ≥ 2.5, e.g. "stub", "bola", "flaky")
               adds +120; ignoring it multiplies the score by 0.5
order        : (-score, name)   → equal scores always come out alphabetically
```

Three deliberate design choices:

1. **No embeddings, no LLM.** Search is lexical, so results are identical on every run and can
   be audited. `matched_on` on each hit makes the ranking explainable.
2. **No invented answers.** Zero matches returns an empty list plus a hint listing valid packs and
   phases — the server instructions tell the client to report "no match" rather than fabricate a skill.
3. **The skills folder is the only source of truth.** `validate_skills` guards its structure, and
   `scripts/sync_skills.py` re-downloads the upstream set idempotently.

### Ranking examples (measured)

| Query | Top result |
|---|---|
| `playwright api` | `pw-api-tester` |
| `I need to stub the payments API in a Cypress test` | `api-mock-server-builder` |
| `flaky cypress test` | `cy-flaky-debugger` |
| `test plan` | `test-plan-generator` |
| `boundary values` | `api-negative-boundary-designer` |
| `selenium grid` | `se-grid-configurator` |
| `postman collection` | `api-collection-organizer` |
| `bola idor` | `api-security-tester` |
| `test case creator` | `test-case-writer` |
| `parallel cypress shard` | `cy-parallel-runner` |
| `test coverage report` | `test-coverage-analyzer` |

---

## Layout

```
testskill_finder-mcp/
├── skills/                      SOURCE OF TRUTH — 56 SKILL.md files
│   ├── 01-requirement-analysis/ … 07-test-closure/     (14 STLC skills)
│   └── framework-packs/
│       ├── playwright-pack/      (11)   ← downloaded
│       ├── selenium-pack/        (11)   ← downloaded
│       ├── cypress-pack/         (12)   ← authored here
│       └── api-testing-pack/     (8)    ← authored here
├── skillindex.py                parser + index + deterministic search (no MCP imports)
├── server.py                    FastMCP app: 15 tools, 4 resources, 3 prompts
├── scripts/sync_skills.py       idempotent downloader (stdlib only)
├── scripts/verify_mcp.py        end-to-end check: every tool, resource and prompt over stdio
├── tests/test_skill_finder.py   37 tests incl. golden counts + protocol round trips
├── output/                      generated bundles (gitignored)
└── pyproject.toml · requirements.txt · README.md
```

`skillindex.py` has no FastMCP dependency, so it can be unit-tested or reused standalone
(e.g. as a plain library for a CLI or a RAG index).

---

## Verification

| Check | Command | Result |
|---|---|---|
| Unit + protocol tests | `.venv/Scripts/python.exe -m pytest tests -q` | **37 passed** |
| End-to-end MCP (real stdio subprocess, from a different cwd) | `PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe scripts/verify_mcp.py` | **28/28 checks passed** |
| Upstream mirror | `.venv/Scripts/python.exe scripts/sync_skills.py` | `written=0 unchanged=41 failed=0` (byte-identical) |
| HTTP transport | `server.py --transport http --port 8770` + an external client | 15 tools listed and called over HTTP |

`scripts/verify_mcp.py` asserts, over the wire: all 15 tools, the 3 static resources plus the
`skill://{name}` template, all 3 prompts, the error paths (unknown skill, path traversal), and the
key search rankings. Exit code 0 means everything above is green.

---

## Provenance & licensing

- Upstream 36 skills: **MIT**, `metadata.author: TheTestingAcademy`, from
  `PramodDutta/skillmasterclass` → `skillmasterclass/skills`. Downloaded verbatim by
  `scripts/sync_skills.py`; re-run it to refresh (it reports `written` / `unchanged` / `failed`).
- The 20 Cypress and API-testing skills in this repo follow the same format and are also MIT.

## Not in v1

- Executing a skill (this server **finds and serves** skills; the client applies them).
- Semantic/embedding search — deliberately lexical for determinism.
- Writing back to `skills/` (read-only apart from `export_skill_bundle` writing to `output/`).
