"""
Smoke tests for the Test Skill Finder MCP.

Golden numbers are measured from the current `skills/` folder, so adding or removing
skills forces this file to be updated deliberately rather than silently drifting.

Run:  .venv/Scripts/python.exe -m pytest tests -q
"""

import pathlib
import sys

import anyio
import pytest
from fastmcp import Client

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import server as srv  # noqa: E402
import skillindex as si  # noqa: E402

# ---- golden values measured from skills/ ---------------------------------------------
EXPECTED_SKILLS = 56
EXPECTED_PACKS = {"playwright": 11, "selenium": 11, "cypress": 12, "api-testing": 8}
EXPECTED_STLC_SKILLS = 14
EXPECTED_TOOL_COUNT = 15
EXPECTED_PHASES = 7

UPSTREAM_SAMPLE = "pw-api-tester"
AUTHORED_SAMPLES = ["cy-wait-fixer", "api-contract-validator", "api-security-tester"]


@pytest.fixture(scope="module")
def index() -> si.SkillIndex:
    return srv._index()


# ---- parser ---------------------------------------------------------------------------


def test_frontmatter_parser_handles_folded_description():
    fm, body = si.parse_frontmatter(
        "---\n"
        "name: demo\n"
        "description: >-\n"
        "  First line of the description\n"
        "  and the second line.\n"
        "license: MIT\n"
        "metadata:\n"
        "  author: TheTestingAcademy\n"
        "  pack: demo-pack\n"
        "  version: 1.0.0\n"
        "---\n"
        "# Demo\n\nBody text.\n"
    )
    assert fm["name"] == "demo"
    assert fm["description"] == "First line of the description and the second line."
    assert fm["metadata"]["pack"] == "demo-pack"
    assert fm["metadata"]["version"] == "1.0.0"
    assert body.strip().startswith("# Demo")


def test_every_skill_parses_and_matches_folder(index):
    for skill in index.skills:
        assert skill.name, f"{skill.rel_path} has no name"
        assert skill.description, f"{skill.name} has no description"
        assert skill.license, f"{skill.name} has no license"
        assert skill.pack or skill.stlc_phase, f"{skill.name} has neither pack nor stlc-phase"
        assert skill.name == skill.folder, f"{skill.name} != folder {skill.folder}"


# ---- catalogue shape ------------------------------------------------------------------


def test_skill_count_and_packs(index):
    assert len(index.skills) == EXPECTED_SKILLS
    assert {k: len(v) for k, v in index.packs().items()} == EXPECTED_PACKS
    assert sum(1 for s in index.skills if s.kind == "stlc") == EXPECTED_STLC_SKILLS


def test_stlc_phases(index):
    assert len(index.phases()) == EXPECTED_PHASES
    assert "Test Design" in index.phases()
    assert "Defect Management" in index.phases()


def test_strict_validation_passes(index):
    report = index.validate()
    assert report["ok"] is True, report["problems"]


def test_trigger_phrases_extracted(index):
    pw = index.get(UPSTREAM_SAMPLE)
    assert pw is not None
    assert any("API tests" in p for p in pw.trigger_phrases), pw.trigger_phrases


def test_use_when_bullets_extracted(index):
    for name in [UPSTREAM_SAMPLE, *AUTHORED_SAMPLES]:
        skill = index.get(name)
        assert skill is not None, name
        assert skill.use_when, f"{name} has no 'When to use' bullets"


# ---- search ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "query,expected_in_top",
    [
        ("playwright api", "pw-api-tester"),
        ("flaky cypress test", "cy-flaky-debugger"),
        ("cy.intercept mock network", "cy-network-mocker"),
        ("test plan", "test-plan-generator"),
        ("test case creator", "test-case-writer"),
        ("bug triage", "bug-triage-assistant"),
        ("boundary values", "api-negative-boundary-designer"),
        ("bola idor security", "api-security-tester"),
        ("schema contract breaking change", "api-contract-validator"),
        ("selenium grid", "se-grid-configurator"),
        ("accessibility audit", "pw-accessibility-auditor"),
        ("postman collection", "api-collection-organizer"),
        ("p95 latency load", "api-performance-smoker"),
        ("parallel cypress shard", "cy-parallel-runner"),
    ],
)
def test_search_finds_expected_skill(index, query, expected_in_top):
    names = [m.skill.name for m in index.search(query, limit=5)]
    assert expected_in_top in names, f"{query!r} -> {names}"


def test_search_is_deterministic(index):
    first = [m.skill.name for m in index.search("api testing", limit=10)]
    second = [m.skill.name for m in index.search("api testing", limit=10)]
    assert first == second
    scores = [m.score for m in index.search("api testing", limit=10)]
    assert scores == sorted(scores, reverse=True)


def test_search_reports_why(index):
    match = index.search("cypress report", limit=1)[0]
    assert match.matched_on, "search must explain the ranking"
    assert match.score > 0


def test_search_no_match_returns_empty(index):
    # A token that cannot appear in any skill: no match must return [], never a guess.
    assert index.search("zzzqqxvv") == []


def test_require_all_tokens_is_stricter(index):
    loose = len(index.search("playwright visual", limit=50))
    strict = len(index.search("playwright visual", require_all_tokens=True, limit=50))
    assert strict <= loose


def test_pack_filter(index):
    results = index.search("api", pack="cypress", limit=50)
    assert results
    assert all(m.skill.pack == "cypress" for m in results)


def test_content_search_finds_code(index):
    hits = index.search_content("cy.intercept")
    assert hits
    assert any(h["name"] == "cy-network-mocker" for h in hits)
    assert hits[0]["hits"][0]["line"] > 0


def test_related_skills_prefers_same_pack(index):
    related = index.related("pw-api-tester", limit=10)
    assert related
    assert any(r["same_category"] for r in related)


# ---- MCP surface ----------------------------------------------------------------------


def _run(coro):
    return anyio.run(lambda: coro)


def test_tool_count_and_names():
    async def main():
        async with Client(srv.mcp) as client:
            return [t.name for t in await client.list_tools()]

    names = _run(main())
    assert len(names) == EXPECTED_TOOL_COUNT
    for expected in (
        "list_skills",
        "list_packs",
        "search_skills",
        "find_skill_for_task",
        "get_skill",
        "search_skill_content",
        "recommend_skills_for_phase",
        "export_skill_bundle",
    ):
        assert expected in names


def test_find_skill_for_task_over_protocol():
    async def main():
        async with Client(srv.mcp) as client:
            return (await client.call_tool(
                "find_skill_for_task",
                {"task": "I need to stub the payments API in a Cypress test"},
            )).data

    result = _run(main())
    assert result["suggestion_count"] > 0
    names = [s["name"] for s in result["suggestions"]]
    assert "cy-network-mocker" in names
    assert all(s["why"] for s in result["suggestions"])


def test_get_skill_returns_body_and_sections():
    async def main():
        async with Client(srv.mcp) as client:
            return (await client.call_tool("get_skill", {"name": "cy-wait-fixer"})).data

    skill = _run(main())
    assert skill["name"] == "cy-wait-fixer"
    assert "## Workflow" in skill["body"]
    assert "Guardrails" in skill["sections"]
    assert skill["use_when"]


def test_unknown_skill_raises_with_suggestions():
    async def main():
        async with Client(srv.mcp) as client:
            with pytest.raises(Exception) as exc:
                await client.call_tool("get_skill", {"name": "no-such-skill"})
            return str(exc.value)

    message = _run(main())
    assert "No skill named" in message


def test_resource_returns_raw_skill():
    async def main():
        async with Client(srv.mcp) as client:
            return await client.read_resource("skill://api-contract-validator")

    res = _run(main())
    assert "name: api-contract-validator" in res[0].text
    assert "Guardrails" in res[0].text


def test_index_and_stats_resources():
    async def main():
        async with Client(srv.mcp) as client:
            idx = (await client.read_resource("skills://index"))[0].text
            stats = (await client.read_resource("skills://stats"))[0].text
            return idx, stats

    idx_text, stats_text = _run(main())
    assert f'"skills_total": {EXPECTED_SKILLS}' in idx_text
    assert '"skills_total"' in stats_text


def test_recommend_skills_for_phase():
    async def main():
        async with Client(srv.mcp) as client:
            chain = (await client.call_tool("recommend_skills_for_phase", {})).data
            one = (await client.call_tool(
                "recommend_skills_for_phase", {"phase": "Test Design"}
            )).data
            return chain, one

    chain, one = _run(main())
    assert len(chain["chain"]) == EXPECTED_PHASES
    assert chain["chain"][0]["phase"] == "Requirement Analysis"
    assert one["phase"] == "Test Design"
    assert one["skills"]


def test_read_bundled_file_and_reject_traversal():
    async def main():
        async with Client(srv.mcp) as client:
            files = (await client.call_tool(
                "list_skill_files", {"name": "test-plan-generator"}
            )).data
            content = (await client.call_tool(
                "read_skill_file",
                {"name": "test-plan-generator", "relative_path": "references/test-plan-template.md"},
            )).data
            with pytest.raises(Exception) as exc:
                await client.call_tool(
                    "read_skill_file",
                    {"name": "test-plan-generator", "relative_path": "../../../server.py"},
                )
            return files, content, str(exc.value)

    files, content, error = _run(main())
    assert files["extra_file_count"] == 4
    assert content["bytes"] > 0
    assert "must stay inside the skill folder" in error


def test_export_markdown_bundle():
    async def main():
        async with Client(srv.mcp) as client:
            return (await client.call_tool(
                "export_skill_bundle",
                {"names": ["cy-wait-fixer", "api-auth-tester"], "format": "md",
                 "filename": "pytest-bundle.md"},
            )).data

    result = _run(main())
    path = pathlib.Path(result["path"])
    assert path.is_file()
    assert result["skills_exported"] == 2
    text = path.read_text(encoding="utf-8")
    assert "name: cy-wait-fixer" in text and "name: api-auth-tester" in text
    path.unlink()
