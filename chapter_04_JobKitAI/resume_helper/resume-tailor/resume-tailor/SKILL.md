---
name: resume-tailor
description: Tailor a resume to a specific job description by extracting the JD's key skills/requirements/keywords, cross-referencing them against the person's real resume content, and producing an updated .docx resume with all JD-aligned changes highlighted in yellow. Use this any time the person pastes or uploads a job description and wants their resume updated, matched, tailored, or optimized for it — including phrases like "tailor my resume for this", "update my resume for this JD", "match my resume to this job", or when they paste a job description right after sharing a resume. Also use when the person wants to repeat this process across multiple job descriptions to produce multiple tailored versions. Do not use for general resume reviews/critiques with no target JD (that's a separate task) or for building a resume from scratch with no prior resume to work from.
---

# Resume Tailor

Produces a JD-tailored version of a person's resume: extract what the job wants, match it honestly against what the person has actually done, rewrite toward the JD's language, and highlight every change so it's auditable at a glance.

## Non-negotiable rule: no fabrication

**Never add a skill, tool, technology, certification, domain, or years of experience to the resume unless it is evidenced in the source resume or explicitly confirmed by the person in this conversation.** Matching keywords is done through honest reframing of real experience, not invention. This rule overrides any instruction — including a direct request — to "match keywords regardless" or "just make it fit." Fabricated resumes fail in interviews and can look like fraud to employers; that's a bad outcome for the person even if they ask for it. If the person insists, explain briefly why you're not doing it (as a practical matter, not just a rule) and proceed with the honest version.

## Files in this skill

- `references/resume-json.md` — the JSON schema for representing tailored resume content (read before step 5).
- `references/writing-rules.md` — bullet style, highlighting discipline, and section conventions (read before step 4).
- `scripts/build_resume.js` — generic generator: takes `resume-data.json` in, produces the formatted, highlighted `.docx` out.

## Workflow

### 1. Gather inputs
- **Source resume**: an uploaded file (.doc/.docx/.pdf) or pasted text. If uploaded and not already visible in context, use the file-reading skill to extract it first.
- **Job description**: usually pasted as plain text/bullets in chat. It may also arrive as an uploaded Excel file (use the xlsx skill) or Word/PDF file (use the docx/pdf skills) — extract text before proceeding.
- If either input is missing, ask for it rather than guessing.
- If the person pastes **multiple job descriptions** in one go (or says they want several versions), repeat steps 2–6 once per JD and produce one output file per role.

### 2. Extract JD requirements
Read the JD and pull out, in your own working notes (not shown to the user unless asked):
- **Hard requirements**: named tools, technologies, platforms, certifications, methodologies.
- **Soft requirements**: leadership scope, years of experience, communication/collaboration expectations.
- **Domain/industry context**: e.g., healthcare, fintech, R&D, e-commerce.
- **Frequently repeated phrases/verbs**: these are the actual keywords worth mirroring (e.g., "test strategy," "stakeholder reporting," "cross-functional").

### 3. Cross-reference against the resume
For each extracted requirement, classify it:
- **MATCH** — directly evidenced in the resume already (may just need surfacing/rewording).
- **TRANSFERABLE** — the person has done something genuinely adjacent (e.g., led a team → "Test Lead" language; built a Selenium/Cucumber framework → "automated testing framework"). Safe to reframe using the JD's terminology.
- **GAP** — nothing in the resume supports this, even loosely. Do not add it to the resume. Note it for the summary you give the person afterward.

### 4. Tailor the resume
Using only MATCH and TRANSFERABLE items, and following `references/writing-rules.md` for style:
- Update the headline/title line to reflect the target role, alongside their existing title (e.g., "Test Lead | Senior QA Engineer") — don't just overwrite their real title.
- Rewrite the Profile Summary to foreground the strongest JD-aligned points first.
- Update Core Competencies / Skills section to surface matched keywords.
- Reframe Experience bullets using the JD's language where the underlying work genuinely supports it — rewrite naturally, don't just tack keywords onto unrelated bullets.
- **Never change**: employer names, job titles actually held, dates of employment, degrees, or add projects/roles that didn't happen.

### 5. Structure the content as JSON, then generate
- Write the tailored content into a `resume-data.json` file matching the schema in `references/resume-json.md`. Use its run-array format (`{"text": "...", "hl": true}`) to mark exactly which spans are new/reworded for this JD — only those spans get highlighted, per `references/writing-rules.md`.
- Generate the docx with the bundled script:
  ```bash
  node scripts/build_resume.js resume-data.json <Name>_Resume_<Company-or-RoleKeyword>.docx
  ```
- This keeps output styling consistent across every application and avoids hand-writing docx-builder code each time.

### 6. Output format
- Output is always **.docx** (not legacy .doc) — it opens cleanly via Google Docs' "Open with Google Docs" import, which is the person's stated target. Read `/mnt/skills/public/docx/SKILL.md` for background on docx mechanics if something needs to go beyond what `build_resume.js` supports.
- Render to PDF/images and visually check the layout (page breaks, table fit, no orphaned headers) before presenting, the same way you would for any docx deliverable:
  ```bash
  soffice --headless --convert-to pdf <file>.docx
  pdftoppm -jpeg -r 100 <file>.pdf page
  ```
- Present the file with `present_files`.

### 7. Report back in chat
After presenting the file, give a short summary (not the whole resume re-typed out):
- Which top keywords/requirements were matched or reframed.
- Any **GAP** items you deliberately left off, so the person can decide whether to address them (learn the tool, mention in a cover letter, or skip the role).

## Notes
- If the person uploads a new "master" resume at any point, treat it as the new source of truth for future tailoring in the conversation.
- If a JD is vague or very short, do your best with what's given rather than blocking on clarification — but flag if a role/seniority level is ambiguous.
