# Writing rules for resume tailoring

These rules govern how content gets written into `resume-data.json`. They
apply on top of the non-negotiable no-fabrication rule in the main
`SKILL.md` — that rule always wins if anything here seems to conflict.

## Highlighting discipline

- Highlight (`"hl": true`) only the **specific words/phrases** that are new
  or reworded to align with the JD — not the whole sentence, not the whole
  bullet. If a bullet is 90% highlighted, it's being over-rewritten rather
  than reframed; go back and trim the highlighted span to just the
  JD-language portion.
- Never highlight factual fields: names, dates, employers, titles held,
  degrees. Highlighting there would incorrectly imply the *fact* changed,
  when only phrasing elsewhere changed.
- If a whole new bullet is added (not just reworded), highlight the whole
  thing — but only add a whole new bullet when the underlying achievement
  was real but previously unstated, never to introduce a new claim.

## Classifying before writing (MATCH / TRANSFERABLE / GAP)

- **MATCH** → surface it more prominently and mirror the JD's exact term if
  the resume already uses different wording for the same thing (e.g. resume
  says "test scripts," JD says "test cases" → fine to align terminology).
- **TRANSFERABLE** → reframe the real underlying activity honestly. Good:
  resume shows "coordinated a 10-member team" + JD wants "Test Lead" →
  write "led test execution/team coordination." Bad: resume shows Selenium
  experience + JD wants "Playwright" → do NOT rename Selenium to
  Playwright; if worth mentioning at all, it goes in the GAP note to the
  person, not onto the resume.
- **GAP** → leave off the resume entirely. Report it in chat after
  delivering the file, so the person can decide how to handle it
  themselves (skip the role, upskill, address in a cover letter).

## Bullet style

- Lead with a strong action verb. Present tense for the current role,
  past tense for previous roles. Keep this consistent within each job block.
- One idea per bullet; keep to roughly 1–2 lines in the final layout.
- Prefer outcome-oriented phrasing over pure responsibility-listing where
  the source resume supports it (e.g. "cutting manual regression effort by
  automating core UI journeys" rather than just "automated UI testing").
- Do not invent specific numbers/metrics (percentages, dollar figures,
  headcounts) that aren't in the source resume or confirmed by the person.
  Vague-but-honest ("reduced manual regression effort") beats a fabricated
  precise stat.
- Avoid keyword stuffing: each JD term that appears should be traceable to
  a real, describable piece of work — if you can't explain in one sentence
  *why* it's true, don't add it.

## Section conventions

- Standard section order: Profile Summary → Core Competencies → Technical
  Skills → Professional Experience → Education. Keep this order unless the
  person's source resume uses a meaningfully different structure worth
  preserving.
- Profile Summary: 5–7 bullets max. Lead with the strongest JD-aligned
  points; don't let it sprawl into a full duplicate of the experience
  section.
- Core Competencies: short noun-phrase list, no full sentences.
- Title line: `<Target Role from JD> | <Person's Real Existing Title>` —
  the real title is never removed or replaced.

## File & delivery conventions

- Output format is always `.docx` (never legacy `.doc`) — it's the format
  that imports cleanly into Google Docs, which is the person's stated
  working environment.
- File name: `<Name>_Resume_<Company-or-RoleKeyword>.docx`.
- After generating, always render to PDF and check the page images for
  overflow, awkward page breaks, or orphaned section headers before
  presenting the file.
