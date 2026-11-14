"""
Test Skill Finder MCP — skill index and search engine.

Source of truth: the `skills/` folder. Every `SKILL.md` is parsed for its YAML-ish
frontmatter (name, description, license, metadata.pack | metadata.stlc-phase, version)
and indexed for deterministic keyword search.

No MCP / FastMCP imports live here on purpose: the index is unit-testable and reusable.

Determinism contract
--------------------
* Search is a pure function of (query, filters, index). No randomness, no LLM calls.
* Results are ordered by (-score, name) so equal scores always come out alphabetically.
* Every result reports *which* fields matched, so a caller can explain the ranking.
* All matching is lexical (lower-cased token matching). Semantics come from the skill
  author's wording, never from an inference step.
"""

from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Sequence

# --------------------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------------------

SKILL_FILENAME = "SKILL.md"

#: Words that carry no signal in this domain. Kept deliberately short: "test", "skill",
#: "api", "playwright" etc. ARE signal and must never be dropped.
STOPWORDS: frozenset[str] = frozenset(
    """a an the and or of for to in on with without my me i we you your this that these
    those is are be been being do does did doing can could should would will shall may might
    how what which who when where why please give me show find get need want help about
    into from at by as it its""".split()
)

#: Scoring weights. Changing these changes result order — keep them visible and tested.
WEIGHTS = {
    "name_exact": 120,      # whole query equals the skill name
    "name_phrase": 60,      # query appears as a substring of the name (e.g. "api" in cy-api-tester)
    "name_token": 45,       # query token appears as a name token (prefix-tolerant)
    "pack": 55,             # query token names the pack - a framework mention scopes results
    "phase": 22,            # query token appears in the STLC phase
    "description": 18,      # per token occurrence in the description (capped); curated intent
    "trigger": 28,          # token occurs inside a quoted trigger phrase - the author's own list
    "title": 8,             # token in the H1 title
    "body": 3,              # per token occurrence in the body (capped)
}

#: Extra name matches beyond the strongest one are heavily discounted, so a name holding
#: several generic words ('api', 'test') cannot outrank a skill matching a specific capability.
EXTRA_NAME_MATCH_FACTOR = 0.25

#: A query token this specific names an *intent* ("stub", "flaky", "bola"). Skills matching it
#: are rewarded; skills that ignore it are demoted so generic words cannot win the ranking.
RARE_TOKEN_WEIGHT = 2.5
RARE_HIT_BONUS = 120
RARE_MISS_FACTOR = 0.5

DESCRIPTION_CAP = 4
BODY_CAP = 6


class SkillIndexError(RuntimeError):
    """Raised when the skills folder is missing, empty, or structurally invalid."""


# --------------------------------------------------------------------------------------
# Frontmatter parsing (small, dependency-free, exact for the house SKILL.md format)
# --------------------------------------------------------------------------------------


def _unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    """
    Split a SKILL.md into (frontmatter dict, body).

    Supports the constructs actually used by these skills: plain scalars, folded (`>-`)
    and literal (`|`) blocks, and one level of nested mapping (metadata:).
    """
    match = re.match(r"^---[ \t]*\r?\n(.*?)\r?\n---[ \t]*\r?\n?(.*)$", text, re.S)
    if not match:
        return {}, text

    block, body = match.group(1), match.group(2)
    lines = block.splitlines()
    data: dict[str, Any] = {}
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip() or line.lstrip().startswith("#"):
            i += 1
            continue
        key_match = re.match(r"^([A-Za-z_][\w-]*):(.*)$", line)
        if not key_match:
            i += 1
            continue

        key, rest = key_match.group(1), key_match.group(2).strip()

        # Collect the indented continuation block that follows this key.
        collected: list[str] = []
        j = i + 1
        while j < len(lines):
            nxt = lines[j]
            if nxt.strip() and not nxt[:1].isspace():
                break
            collected.append(nxt)
            j += 1

        if rest in (">", ">-", "|", "|-", ">+", "|+"):
            content = [ln.strip() for ln in collected if ln.strip()]
            data[key] = " ".join(content) if rest.startswith(">") else "\n".join(content)
            i = j
            continue

        if rest == "" and collected:
            nested: dict[str, str] = {}
            for ln in collected:
                if not ln.strip():
                    continue
                sub = re.match(r"^\s+([A-Za-z_][\w-]*):\s*(.*)$", ln)
                if sub:
                    nested[sub.group(1)] = _unquote(sub.group(2))
            data[key] = nested
            i = j
            continue

        data[key] = _unquote(rest)
        i += 1

    return data, body


# --------------------------------------------------------------------------------------
# Model
# --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Skill:
    name: str
    title: str
    description: str
    license: str
    author: str
    version: str
    pack: str | None
    stlc_phase: str | None
    body: str
    raw: str
    path: Path
    skills_root: Path
    extra_files: tuple[str, ...] = ()

    # -- derived ---------------------------------------------------------------------

    @property
    def rel_path(self) -> str:
        return self.path.relative_to(self.skills_root).as_posix()

    @property
    def folder(self) -> str:
        return self.path.parent.name

    @property
    def group(self) -> str:
        """Category folder, e.g. '08-framework-packs/cypress-pack' or '05-test-execution'."""
        return self.path.parent.parent.relative_to(self.skills_root).as_posix()

    @property
    def kind(self) -> str:
        return "pack" if self.pack else "stlc"

    @property
    def category(self) -> str:
        """Human-facing category: the pack name, or the STLC phase."""
        return self.pack or self.stlc_phase or "uncategorised"

    @property
    def trigger_phrases(self) -> tuple[str, ...]:
        """Quoted example utterances from the description — the author's own trigger list."""
        return tuple(re.findall(r'"([^"]{3,120})"', self.description))

    @property
    def use_when(self) -> tuple[str, ...]:
        """Bullet lines under '## When to use'."""
        section = _section(self.body, "When to use")
        return tuple(
            re.sub(r"^\s*[-*]\s*", "", ln).strip()
            for ln in section.splitlines()
            if ln.strip().startswith(("-", "*"))
        )

    @property
    def first_sentence(self) -> str:
        parts = re.split(r"(?<=[.!?])\s", self.description.strip())
        return parts[0] if parts and parts[0] else self.description.strip()

    @property
    def search_text(self) -> str:
        return f"{self.name} {self.title} {self.description} {self.pack or ''} {self.stlc_phase or ''} {self.body}"

    def to_index_row(self) -> dict[str, Any]:
        """Compact row for the index resource and get_skill_index."""
        return {
            "name": self.name,
            "category": self.category,
            "kind": self.kind,
            "description": self.first_sentence,
            "path": self.rel_path,
        }

    def to_dict(self, include_body: bool = False) -> dict[str, Any]:
        data: dict[str, Any] = {
            "name": self.name,
            "title": self.title,
            "description": self.description,
            "category": self.category,
            "kind": self.kind,
            "pack": self.pack,
            "stlc_phase": self.stlc_phase,
            "license": self.license,
            "author": self.author,
            "version": self.version,
            "path": self.rel_path,
            "use_when": list(self.use_when),
            "trigger_phrases": list(self.trigger_phrases),
            "extra_files": list(self.extra_files),
        }
        if include_body:
            data["body"] = self.body
            data["raw"] = self.raw
        return data


def _section(body: str, heading: str) -> str:
    """Return the text under '## <heading>' up to the next '## '."""
    pattern = re.compile(
        rf"^##\s+{re.escape(heading)}\s*$(.*?)(?=^##\s|\Z)", re.S | re.M
    )
    m = pattern.search(body)
    return m.group(1).strip() if m else ""


def _first_heading(body: str) -> str:
    m = re.search(r"^#\s+(.+)$", body, re.M)
    return m.group(1).strip() if m else ""


# --------------------------------------------------------------------------------------
# Tokenisation and search
# --------------------------------------------------------------------------------------


def tokenize(text: str) -> list[str]:
    """Lower-case word tokens. Keep short-but-meaningful tokens like 'ui', 'ci', 'e2e'."""
    return [t for t in re.split(r"[^a-z0-9+#]+", text.lower()) if t]


def query_tokens(query: str) -> tuple[list[str], list[str]]:
    """Return (all tokens, content tokens with stopwords removed)."""
    tokens = tokenize(query)
    content = [t for t in tokens if t not in STOPWORDS]
    return tokens, content


def _name_token_hit(token: str, name_tokens: set[str]) -> bool:
    """
    True when a query token matches a name token.

    Prefix-tolerant for tokens of 4+ characters so 'mock' matches 'mocker' and 'test'
    matches 'tester'/'testing'. Short tokens (api, ui, ci, e2e) must match exactly, which
    keeps the matching predictable.
    """
    if token in name_tokens:
        return True
    if len(token) >= 4:
        for name_token in name_tokens:
            if len(name_token) >= 4 and (
                name_token.startswith(token) or token.startswith(name_token)
            ):
                return True
    return False


@dataclass
class Match:
    skill: Skill
    score: int
    matched_on: list[str] = field(default_factory=list)
    matched_tokens: list[str] = field(default_factory=list)

    def to_dict(self, include_body: bool = False) -> dict[str, Any]:
        return {
            **self.skill.to_dict(include_body=include_body),
            "score": self.score,
            "matched_on": self.matched_on,
            "matched_tokens": self.matched_tokens,
        }


# --------------------------------------------------------------------------------------
# Index
# --------------------------------------------------------------------------------------


class SkillIndex:
    """In-memory index over every SKILL.md under `skills/`."""

    def __init__(self, skills: Sequence[Skill], root: Path) -> None:
        self.skills: list[Skill] = sorted(skills, key=lambda s: s.name)
        self.root = root
        self.by_name: dict[str, Skill] = {s.name: s for s in self.skills}
        self._body_cache: dict[str, str] = {s.name: s.body.lower() for s in self.skills}
        self._desc_cache: dict[str, str] = {s.name: s.description.lower() for s in self.skills}
        self._title_cache: dict[str, str] = {s.name: s.title.lower() for s in self.skills}
        self._trigger_cache: dict[str, str] = {
            s.name: " ".join(s.trigger_phrases).lower() for s in self.skills
        }
        self._line_cache: dict[str, list[str]] = {
            s.name: s.raw.splitlines() for s in self.skills
        }

        # Document frequency per token, used to weight specific words above generic ones.
        # Without this, a query like "stub the payments API in a Cypress test" is dominated
        # by "api"/"test" (which appear almost everywhere) and the mocking skill is buried.
        self._df: Counter[str] = Counter()
        for s in self.skills:
            for tok in set(
                tokenize(
                    f"{s.name} {s.title} {s.description} {s.pack or ''} "
                    f"{s.stlc_phase or ''} {s.body}"
                )
            ):
                self._df[tok] += 1
        self._idf_cache: dict[str, float] = {}

    def token_weight(self, token: str) -> float:
        """
        Deterministic IDF factor for a token, clamped to [0.25, 3.0].

        1.0 means "average specificity". A token in every skill scores below 1; a token in
        one or two skills scores up to the cap. Pure function of the index.
        """
        cached = self._idf_cache.get(token)
        if cached is not None:
            return cached
        total = len(self.skills) or 1
        weight = 1.0 + math.log((total + 1) / (self._df.get(token, 0) + 1))
        weight = max(0.25, min(3.0, weight))
        self._idf_cache[token] = weight
        return weight

    # -- construction ---------------------------------------------------------------

    @classmethod
    def load(cls, root: Path | str | None = None) -> "SkillIndex":
        skills_root = Path(root) if root else default_skills_root()
        if not skills_root.is_dir():
            raise SkillIndexError(f"Skills folder not found: {skills_root}")
        paths = sorted(skills_root.rglob(SKILL_FILENAME))
        if not paths:
            raise SkillIndexError(
                f"No {SKILL_FILENAME} files under {skills_root}. "
                "Run `python scripts/sync_skills.py` to download the upstream skills."
            )
        skills: list[Skill] = []
        for path in paths:
            skills.append(_parse_skill_file(path, skills_root))
        return cls(skills, skills_root)

    # -- views ----------------------------------------------------------------------

    def packs(self) -> dict[str, list[str]]:
        out: dict[str, list[str]] = defaultdict(list)
        for s in self.skills:
            if s.pack:
                out[s.pack].append(s.name)
        return {k: sorted(v) for k, v in sorted(out.items())}

    def phases(self) -> dict[str, list[str]]:
        out: dict[str, list[str]] = defaultdict(list)
        for s in self.skills:
            if s.stlc_phase:
                out[s.stlc_phase].append(s.name)
        return {k: sorted(v) for k, v in sorted(out.items())}

    def groups(self) -> dict[str, list[str]]:
        out: dict[str, list[str]] = defaultdict(list)
        for s in self.skills:
            out[s.group].append(s.name)
        return {k: sorted(v) for k, v in sorted(out.items())}

    def stats(self) -> dict[str, Any]:
        return {
            "skills_total": len(self.skills),
            "by_kind": dict(sorted(Counter(s.kind for s in self.skills).items())),
            "by_pack": {k: len(v) for k, v in self.packs().items()},
            "by_stlc_phase": {k: len(v) for k, v in self.phases().items()},
            "by_group": {k: len(v) for k, v in self.groups().items()},
            "with_extra_files": sorted(s.name for s in self.skills if s.extra_files),
            "skills_root": str(self.root),
        }

    def get(self, name: str) -> Skill | None:
        key = (name or "").strip().lower()
        if key in self.by_name:
            return self.by_name[key]
        # tolerate a path or a trailing /SKILL.md
        for s in self.skills:
            if key in (s.rel_path.lower(), s.folder.lower()):
                return s
        return None

    def filter(
        self,
        pack: str | None = None,
        kind: str | None = None,
        stlc_phase: str | None = None,
        group: str | None = None,
    ) -> list[Skill]:
        out = self.skills
        if pack:
            out = [s for s in out if (s.pack or "").lower() == pack.strip().lower()]
        if kind:
            out = [s for s in out if s.kind == kind.strip().lower()]
        if stlc_phase:
            out = [s for s in out if (s.stlc_phase or "").lower() == stlc_phase.strip().lower()]
        if group:
            out = [s for s in out if s.group.lower() == group.strip().lower()]
        return list(out)

    def valid_packs(self) -> list[str]:
        return sorted(self.packs())

    def valid_phases(self) -> list[str]:
        return sorted(self.phases())

    # -- search ---------------------------------------------------------------------

    def search(
        self,
        query: str,
        *,
        pack: str | None = None,
        kind: str | None = None,
        require_all_tokens: bool = False,
        limit: int = 10,
    ) -> list[Match]:
        """
        Lexical, deterministic ranking. Returns [] when nothing matches (never a guess).

        Scoring is field-weighted (name > pack/phase > description > trigger > title > body)
        and every weight is declared in WEIGHTS so a ranking can be explained.
        """
        query = (query or "").strip()
        if not query:
            return []
        _, content = query_tokens(query)
        if not content:
            content = tokenize(query)
        if not content:
            return []

        phrase = query.lower()
        pool = self.filter(pack=pack, kind=kind)
        matches: list[Match] = []

        for skill in pool:
            name = skill.name.lower()
            name_tokens = set(tokenize(skill.name))
            pack_text = (skill.pack or "").lower()
            phase_text = (skill.stlc_phase or "").lower()
            desc = self._desc_cache[skill.name]
            triggers = self._trigger_cache[skill.name]
            title = self._title_cache[skill.name]
            body = self._body_cache[skill.name]

            score = 0
            matched_on: list[str] = []
            matched_tokens: list[str] = []

            if name == phrase:
                score += WEIGHTS["name_exact"]
                matched_on.append("name (exact)")
                matched_tokens.extend(content)
            elif phrase.replace("-", " ") == name.replace("-", " "):
                score += WEIGHTS["name_exact"] - 10
                matched_on.append("name (exact, normalised)")
                matched_tokens.extend(content)
            elif phrase in name:
                score += WEIGHTS["name_phrase"]
                matched_on.append("name (phrase)")

            for token in content:
                hit_any = False
                f = self.token_weight(token)  # specific words count for more
                if _name_token_hit(token, name_tokens):
                    hit_any = True  # scored once, capped, after this loop
                if token and token in pack_text:
                    score += round(WEIGHTS["pack"] * f)
                    hit_any = True
                    if "pack" not in matched_on:
                        matched_on.append("pack")
                if token and token in phase_text:
                    score += round(WEIGHTS["phase"] * f)
                    hit_any = True
                    if "stlc phase" not in matched_on:
                        matched_on.append("stlc phase")

                desc_hits = desc.count(token)
                if desc_hits:
                    score += round(WEIGHTS["description"] * f) * min(desc_hits, DESCRIPTION_CAP)
                    hit_any = True
                    if "description" not in matched_on:
                        matched_on.append("description")
                if token in triggers:
                    score += round(WEIGHTS["trigger"] * f)
                    hit_any = True
                    if "trigger phrase" not in matched_on:
                        matched_on.append("trigger phrase")
                if token in title:
                    score += round(WEIGHTS["title"] * f)
                    hit_any = True
                    if "title" not in matched_on:
                        matched_on.append("title")
                if token in body:
                    score += round(WEIGHTS["body"] * f) * min(body.count(token), BODY_CAP)
                    hit_any = True
                    if "body" not in matched_on:
                        matched_on.append("body")

                if hit_any:
                    matched_tokens.append(token)

            # Name matches: strongest one counts in full, the rest are discounted.
            name_hits = sorted(
                (
                    (t, self.token_weight(t))
                    for t in content
                    if _name_token_hit(t, name_tokens)
                ),
                key=lambda pair: -pair[1],
            )
            if name_hits:
                score += round(WEIGHTS["name_token"] * name_hits[0][1])
                for _, weight in name_hits[1:]:
                    score += round(WEIGHTS["name_token"] * weight * EXTRA_NAME_MATCH_FACTOR)
                matched_on.insert(0, "name (token)")

            # Specificity gate: a rare query token states the intent. Matching it is worth far
            # more than any number of generic matches; ignoring it should not win.
            rare = [t for t in content if self.token_weight(t) >= RARE_TOKEN_WEIGHT]
            if rare:
                rare_hit = sorted(set(rare) & set(matched_tokens))
                if rare_hit:
                    score += RARE_HIT_BONUS * len(rare_hit)
                    matched_on.append(f"intent token: {', '.join(rare_hit)}")
                else:
                    score = round(score * RARE_MISS_FACTOR)
                    matched_on.append(
                        f"demoted: no intent token ({', '.join(sorted(set(rare)))}) matched"
                    )

            if require_all_tokens:
                if set(content) - set(matched_tokens):
                    continue
            elif not matched_tokens:
                continue

            matches.append(Match(skill, score, matched_on, sorted(set(matched_tokens))))

        matches.sort(key=lambda m: (-m.score, m.skill.name))
        return matches[: max(0, limit)]

    def search_content(self, query: str, limit: int = 20) -> list[dict[str, Any]]:
        """Full-text search inside skill bodies, returning line-anchored snippets."""
        needles = query_tokens(query)[1] or tokenize(query)
        if not needles:
            return []
        results: list[dict[str, Any]] = []
        for skill in self.skills:
            lines = self._line_cache[skill.name]
            hits: list[dict[str, Any]] = []
            for idx, line in enumerate(lines, start=1):
                low = line.lower()
                found = [n for n in needles if n in low]
                if found:
                    hits.append({"line": idx, "text": line.strip()[:300], "tokens": found})
            if hits:
                results.append(
                    {
                        "name": skill.name,
                        "category": skill.category,
                        "path": skill.rel_path,
                        "hit_count": len(hits),
                        "first_hit_line": hits[0]["line"],
                        "hits": hits[:5],
                    }
                )
        results.sort(key=lambda r: (-r["hit_count"], r["name"]))
        return results[: max(0, limit)]

    def related(self, name: str, limit: int = 8) -> list[dict[str, Any]]:
        """
        Skills closest to this one: same pack/phase first, then shared vocabulary.

        Deterministic: Jaccard-style overlap on description+name tokens, tie-break by name.
        """
        target = self.get(name)
        if target is None:
            return []
        target_tokens = set(tokenize(f"{target.name} {target.description}"))
        scored: list[tuple[float, int, str, Skill]] = []
        for skill in self.skills:
            if skill.name == target.name:
                continue
            same_category = 1 if skill.category == target.category else 0
            other = set(tokenize(f"{skill.name} {skill.description}"))
            union = target_tokens | other
            overlap = len(target_tokens & other) / len(union) if union else 0.0
            score = same_category * 0.5 + overlap
            scored.append((score, same_category, skill.name, skill))
        scored.sort(key=lambda t: (-t[0], -t[1], t[2]))
        return [
            {
                "name": s.name,
                "category": s.category,
                "same_category": bool(same),
                "similarity": round(score, 4),
                "description": s.first_sentence,
            }
            for score, same, _, s in scored[: max(0, limit)]
        ]

    # -- validation -----------------------------------------------------------------

    def validate(self) -> dict[str, Any]:
        """Integrity report: everything a well-formed house skill must satisfy."""
        problems: list[dict[str, str]] = []

        def note(skill_name: str, issue: str) -> None:
            problems.append({"skill": skill_name or "<unknown>", "issue": issue})

        seen: set[str] = set()
        for s in self.skills:
            if not s.name:
                note(s.rel_path, "missing frontmatter field: name")
            if not s.description:
                note(s.name, "missing frontmatter field: description")
            elif len(s.description) < 40:
                note(s.name, "description is implausibly short")
            if not s.license:
                note(s.name, "missing frontmatter field: license")
            if not (s.pack or s.stlc_phase):
                note(s.name, "metadata must define either 'pack' or 'stlc-phase'")
            if s.name != s.folder:
                note(s.name, f"name does not match folder name '{s.folder}'")
            if s.name in seen:
                note(s.name, "duplicate skill name")
            seen.add(s.name)
            for required in ("When to use", "Workflow"):
                # Prefix match so author variations such as '## Workflow (follow in order)' pass.
                if not re.search(rf"^##\s+{re.escape(required)}\b", s.body, re.M):
                    note(s.name, f"missing section: '## {required}'")

        # A skill may legitimately label its process differently; only flag when none appear.
        accepted_process = ("workflow", "process", "procedure", "steps", "how to use")
        for s in self.skills:
            headings = [h.strip().lower() for h in re.findall(r"^##\s+(.+)$", s.body, re.M)]
            if headings and not any(
                h.startswith(accepted_process) for h in headings
            ):
                note(s.name, "no process section found (expected Workflow/Process/Steps)")

        return {
            "ok": not problems,
            "skills_checked": len(self.skills),
            "problem_count": len(problems),
            "problems": problems,
        }


# --------------------------------------------------------------------------------------
# Loading helpers
# --------------------------------------------------------------------------------------


def _parse_skill_file(path: Path, root: Path) -> Skill:
    raw = path.read_text(encoding="utf-8")
    fm, body = parse_frontmatter(raw)
    metadata = fm.get("metadata") if isinstance(fm.get("metadata"), dict) else {}
    extra = tuple(
        sorted(
            p.relative_to(path.parent).as_posix()
            for p in path.parent.rglob("*")
            if p.is_file() and p.name != SKILL_FILENAME
        )
    )
    return Skill(
        name=str(fm.get("name") or path.parent.name).strip(),
        title=_first_heading(body) or str(fm.get("name") or path.parent.name),
        description=" ".join(str(fm.get("description") or "").split()),
        license=str(fm.get("license") or ""),
        author=str(metadata.get("author") or ""),
        version=str(metadata.get("version") or ""),
        pack=(str(metadata.get("pack")).strip() or None) if metadata.get("pack") else None,
        stlc_phase=(str(metadata.get("stlc-phase")).strip() or None)
        if metadata.get("stlc-phase")
        else None,
        body=body,
        raw=raw,
        path=path,
        skills_root=root,
        extra_files=extra,
    )


def default_skills_root() -> Path:
    """
    Locate the `skills/` folder beside this module (override with SKILLS_DIR).

    Probes a couple of casings so a checkout that landed as `Skills/` still works on a
    case-sensitive filesystem (Windows is case-insensitive, Linux/macOS are not).
    """
    import os

    env = os.environ.get("SKILLS_DIR")
    if env:
        return Path(env).expanduser().resolve()
    base = Path(__file__).resolve().parent
    for name in ("skills", "Skills"):
        candidate = base / name
        if candidate.is_dir():
            return candidate.resolve()
    return (base / "skills").resolve()


_INDEX: SkillIndex | None = None


def get_index() -> SkillIndex:
    """Lazy singleton so importing the module never fails on a missing folder."""
    global _INDEX
    if _INDEX is None:
        _INDEX = SkillIndex.load()
    return _INDEX


def reset_index() -> None:
    """Test hook."""
    global _INDEX
    _INDEX = None
