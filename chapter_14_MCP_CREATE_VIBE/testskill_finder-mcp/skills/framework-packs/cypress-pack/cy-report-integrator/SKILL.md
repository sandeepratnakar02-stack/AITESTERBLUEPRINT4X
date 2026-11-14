---
name: cy-report-integrator
description: >-
  Configures Cypress reporting for CI and stakeholders: mochawesome HTML, JUnit XML, and
  failure evidence. Use when an SDET says "add a test report to Cypress", "JUnit output for
  Jenkins/Azure", "attach screenshots to failures", "our report has no videos", or asks how
  to publish results. Produces reporter config, artifact paths, and CI publish steps.
license: MIT
metadata:
  author: TheTestingAcademy
  pack: cypress
  version: 1.0.0
---

# CY Report Integrator

You produce reports that make a failure **actionable in one click**: which spec, which step,
and the evidence to see it.

## When to use
- CI must publish test results (JUnit XML for Jenkins/Azure DevOps/GitLab).
- Stakeholders need a readable HTML summary, not a console log.
- Failures lack screenshots/videos, so triage requires a local re-run.

## Workflow
1. **Decide the consumers** — the pipeline (JUnit XML, machine-readable) and humans
   (HTML summary). Do not try to satisfy both with one format.
2. **Configure reporters** in `cypress.config.ts` with `reporter` +
   `reporterOptions`; use `reporterEnabled` for multiple reporters at once.
3. **Capture evidence deliberately:**
   - `screenshotOnRunFailure: true` (default) → `cypress/screenshots/`
   - `video: true` for run mode, per-spec
   - `cy.screenshot({ capture: 'viewport' })` at meaningful checkpoints, not randomly
4. **Merge multi-spec output** for mochawesome (`mochawesome-merge` + `mochawesome-report-generator`);
   JUnit XML is already one file per spec — make CI glob them.
5. **Publish in CI** — upload the report + screenshots/videos as artifacts on success *and*
   failure (`if: always()`), and fail the job on test failure.
6. **Keep the report honest** — no green summary when a step was skipped; record the browser,
   viewport, base URL, and app version in the report metadata.

## Output shape
```typescript
// cypress.config.ts
import { defineConfig } from 'cypress';

export default defineConfig({
  reporter: 'cypress-multi-reporters',
  reporterOptions: {
    reporterEnabled: 'mochawesome, mocha-junit-reporter',
    mochawesomeReporterOptions: {
      reportDir: 'cypress/reports/mocha',
      overwrite: false,
      html: false,
      json: true,
    },
    mochaJunitReporterReporterOptions: {
      mochaFile: 'cypress/reports/junit/results-[hash].xml',
    },
  },
  e2e: {
    video: true,
    screenshotOnRunFailure: true,
    setupNodeEvents(on, config) { /* plugins */ },
  },
});
```

```jsonc
// package.json
{
  "scripts": {
    "report:merge": "mochawesome-merge cypress/reports/mocha/*.json > cypress/reports/merged.json",
    "report:html": "marge cypress/reports/merged.json -f report -o cypress/reports/html",
    "test:report": "cypress run; npm run report:merge && npm run report:html"
  }
}
```

```yaml
# CI: publish evidence even when tests fail
- run: npx cypress run
  continue-on-error: true
- run: npm run report:merge && npm run report:html
  if: always()
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: cypress-evidence
    path: |
      cypress/reports/html
      cypress/reports/junit
      cypress/screenshots
      cypress/videos
```

## Guardrails
- Always upload artifacts with `if: always()`; a report that only exists on success is useless.
- Do not set `video: false` to save time without saying that failures will then require a local
  re-run to triage.
- Never let a skipped test be reported as passed — check the reporter's handling of `pending`.
- Keep generated reports out of git; commit only the reporter configuration.
- Redact secrets from the report — request bodies/tokens must not land in artifacts.
