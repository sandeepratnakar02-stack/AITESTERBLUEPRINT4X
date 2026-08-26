# Resume JSON schema

Before generating the .docx, represent the tailored resume as a JSON file
(`resume-data.json`). This keeps content and formatting separate: you edit
data, `scripts/build_resume.js` handles layout, styling, and highlighting.

Every place text can appear either as a plain string or as a **run array** —
a list of `{ "text": "...", "hl": true }` objects. Use run arrays anywhere
you need to highlight only *part* of a sentence (the JD-aligned part), which
is the normal case per `writing-rules.md`. `"hl": true` renders that span
with a yellow highlight; omit it (or set `false`) for unchanged text.

## Top-level shape

```json
{
  "name": "Full Name",
  "titleLine": [
    { "text": "Target Role Title", "bold": true, "hl": true },
    { "text": "  |  Existing Real Title", "grey": true }
  ],
  "contact": "phone   |   email   |   location",

  "summary": [
    [
      { "text": "9+ years in Software Testing & QA " },
      { "text": "leading test strategy and execution", "hl": true },
      { "text": " across E-commerce, Insurance, and ERP domains." }
    ]
  ],

  "competencies": [
    { "text": "Test Automation Framework Design" },
    { "text": "Cross-Functional Team Coordination", "hl": true }
  ],

  "skillsTable": [
    { "area": "Languages", "skills": "Java, Ruby" },
    { "area": "Test Leadership", "skills": "Test Strategy & Planning, Stakeholder Reporting", "hlArea": true }
  ],

  "experience": [
    {
      "title": "Sr. QA Engineer",
      "company": "Aimbeyond Infotech Pvt. Ltd.",
      "hlTitle": false,
      "dates": "November 2015 \u2013 Present",
      "note": null,
      "projects": [
        {
          "name": "Project: Brightpearl (UK) \u2014 SaaS business-management platform",
          "environment": "E-commerce, Linux, Cucumber, Ruby, API Testing, Jira",
          "bullets": [
            [
              { "text": "Designed and built the Page Object Model " },
              { "text": "automated testing framework", "hl": true },
              { "text": " in Ruby/Cucumber." }
            ]
          ]
        }
      ]
    }
  ],

  "education": [
    { "text": "Bachelor of Technology \u2014 Institution Name, Year" }
  ]
}
```

## Field notes

- **`titleLine`**: always keep the person's real existing title in the line
  (marked `"grey": true` for the secondary-tone segment). The target-role
  title is prepended and highlighted (`"hl": true`) — never delete or
  overwrite their real title.
- **`experience[].note`**: optional italic line before the project list,
  used when one employer block groups multiple concurrent projects (e.g.
  "Delivered QA across three concurrent platforms for this engagement:").
  Set to `null` or omit when not needed.
- **`experience[].dates`**, **`title`**, **`company`**, **`education`**:
  these are factual fields. Never invent, alter, or highlight-fabricate
  these — they come directly from the source resume.
- **`skillsTable[].hlArea`**: highlights the category label itself, for use
  when the whole category (not just one skill in it) is newly surfaced for
  this JD (e.g. adding a "Test Leadership" row that didn't exist before).
- Keep run arrays granular: highlight only the JD-aligned words/phrases
  within a sentence, not the entire sentence, so the highlighted diff stays
  meaningful (see `writing-rules.md`).

## Running the generator

```bash
node scripts/build_resume.js resume-data.json Output_File_Name.docx
```

If arguments are omitted, it defaults to `./resume-data.json` and
`./Resume_Tailored.docx`. Always render to PDF/images afterward to check
layout before presenting the file (see main SKILL.md, step 6).
