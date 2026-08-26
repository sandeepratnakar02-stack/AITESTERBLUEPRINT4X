/**
 * Generic resume builder for the resume-tailor skill.
 *
 * Reads a resume-data.json file matching the schema documented in
 * references/resume-json.md and produces a formatted, highlighted .docx.
 *
 * Usage:
 *   node build_resume.js [path/to/resume-data.json] [Output_File.docx]
 *
 * Defaults: ./resume-data.json -> ./Resume_Tailored.docx
 *
 * After running, convert to PDF and rasterize to visually check layout
 * before presenting the file to the user:
 *   soffice --headless --convert-to pdf Output_File.docx
 *   pdftoppm -jpeg -r 100 Output_File.pdf page
 */

const {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  LevelFormat, convertInchesToTwip
} = require("docx");
const fs = require("fs");
const path = require("path");

const NAVY = "1F3864";
const GREY = "595959";
const LIGHT = "EDF2F8";

const dataPath = process.argv[2] || "resume-data.json";
const outPath = process.argv[3] || "Resume_Tailored.docx";

if (!fs.existsSync(dataPath)) {
  console.error(`Data file not found: ${dataPath}`);
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));

const bulletNumbering = {
  config: [
    {
      reference: "main-bullets",
      levels: [
        {
          level: 0,
          format: LevelFormat.BULLET,
          text: "\u2022",
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: convertInchesToTwip(0.25), hanging: convertInchesToTwip(0.15) } } }
        }
      ]
    }
  ]
};

// ---- Helpers ----

// Accepts either a plain string or an array of {text, hl} run objects.
function toRuns(value, baseProps = {}) {
  const runs = typeof value === "string" ? [{ text: value }] : value;
  return runs.map(r => new TextRun({
    text: r.text,
    size: baseProps.size || 20,
    color: r.grey ? GREY : (baseProps.color || "262626"),
    bold: !!r.bold || !!baseProps.bold,
    italics: !!r.italics || !!baseProps.italics,
    highlight: r.hl ? "yellow" : undefined,
  }));
}

function bulletParagraph(value) {
  return new Paragraph({
    numbering: { reference: "main-bullets", level: 0 },
    spacing: { after: 60 },
    children: toRuns(value)
  });
}

function sectionHeading(text) {
  return new Paragraph({
    spacing: { before: 260, after: 100 },
    border: { bottom: { color: NAVY, space: 2, style: BorderStyle.SINGLE, size: 6 } },
    children: [ new TextRun({ text: text.toUpperCase(), bold: true, size: 22, color: NAVY, font: "Calibri" }) ]
  });
}

function jobHeaderPara(title, company, hlTitle) {
  return new Paragraph({
    spacing: { before: 160, after: 40 },
    children: [
      new TextRun({ text: title, bold: true, size: 21, color: "262626", highlight: hlTitle ? "yellow" : undefined }),
      new TextRun({ text: "  |  " + company, size: 21, color: GREY }),
    ]
  });
}
function datesPara(dates) {
  return new Paragraph({
    spacing: { after: 60 },
    children: [ new TextRun({ text: dates, italics: true, size: 19, color: GREY }) ]
  });
}
function notePara(text) {
  return new Paragraph({
    spacing: { after: 80 },
    children: [ new TextRun({ text, size: 20, color: "262626", italics: true }) ]
  });
}
function projectPara(name) {
  return new Paragraph({
    spacing: { before: 60, after: 40 },
    children: [ new TextRun({ text: name, bold: true, italics: true, size: 20, color: NAVY }) ]
  });
}
function envPara(label) {
  return new Paragraph({
    spacing: { after: 60 },
    children: [ new TextRun({ text: "Environment: ", bold: true, size: 19, color: GREY }), new TextRun({ text: label, size: 19, color: GREY }) ]
  });
}
function skillRow(area, skills, hlArea) {
  return new TableRow({
    children: [
      new TableCell({
        width: { size: 2600, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: LIGHT },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [ new Paragraph({ children: [ new TextRun({ text: area, bold: true, size: 19, color: NAVY, highlight: hlArea ? "yellow" : undefined }) ] }) ]
      }),
      new TableCell({
        width: { size: 6800, type: WidthType.DXA },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [ new Paragraph({ children: [ new TextRun({ text: skills, size: 19, color: "262626" }) ] }) ]
      }),
    ]
  });
}

// ---- Build document body from data ----

const children = [];

// Header
children.push(
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 40 },
    children: [ new TextRun({ text: (data.name || "").toUpperCase(), bold: true, size: 40, color: NAVY, font: "Calibri" }) ]
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 20 },
    children: toRuns(data.titleLine || [], { size: 23, italics: true })
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 160 },
    children: [ new TextRun({ text: data.contact || "", size: 19, color: GREY }) ]
  })
);

// Summary
if (data.summary && data.summary.length) {
  children.push(sectionHeading("Profile Summary"));
  data.summary.forEach(line => children.push(bulletParagraph(line)));
}

// Competencies
if (data.competencies && data.competencies.length) {
  children.push(sectionHeading("Core Competencies"));
  data.competencies.forEach(c => children.push(bulletParagraph([c])));
}

// Skills table
if (data.skillsTable && data.skillsTable.length) {
  children.push(sectionHeading("Technical Skills"));
  children.push(new Table({
    width: { size: 9400, type: WidthType.DXA },
    columnWidths: [2600, 6800],
    rows: data.skillsTable.map(r => skillRow(r.area, r.skills, r.hlArea))
  }));
  children.push(new Paragraph({ text: "", spacing: { after: 100 } }));
}

// Experience
if (data.experience && data.experience.length) {
  children.push(sectionHeading("Professional Experience"));
  data.experience.forEach(job => {
    children.push(jobHeaderPara(job.title, job.company, job.hlTitle));
    children.push(datesPara(job.dates));
    if (job.note) children.push(notePara(job.note));
    (job.projects || []).forEach(proj => {
      if (proj.name) children.push(projectPara(proj.name));
      if (proj.environment) children.push(envPara(proj.environment));
      (proj.bullets || []).forEach(b => children.push(bulletParagraph(b)));
    });
  });
}

// Education
if (data.education && data.education.length) {
  children.push(sectionHeading("Education"));
  data.education.forEach(e => children.push(bulletParagraph([e])));
}

const doc = new Document({
  numbering: bulletNumbering,
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 }, // US Letter
        margin: { top: 620, bottom: 620, left: 720, right: 720 }
      }
    },
    children
  }]
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf);
  console.log(`Written: ${path.resolve(outPath)}`);
});
