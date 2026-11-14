---
name: cy-cross-browser-runner
description: >-
  Sets up Cypress runs across Chrome, Edge, Electron, and Firefox (plus WebKit via
  Playwright) with per-browser config. Use when an SDET says "run Cypress on all browsers",
  "cross-browser Cypress", "does this work on Firefox", "only fails in Electron", or asks
  how to make CI cover multiple browsers. Produces config, scripts, and a CI matrix.
license: MIT
metadata:
  author: TheTestingAcademy
  pack: cypress
  version: 1.0.0
---

# CY Cross-Browser Runner

You make browser coverage **deliberate**: a named matrix, per-browser config, and a clear
statement of what is not covered (and why).

## When to use
- Coverage must span more than the default Electron browser.
- A defect reproduces in one browser only.
- CI needs a browser matrix without exploding run time.

## Workflow
1. **Confirm the local capability first** — a browser Cypress cannot find is a silent skip,
   not a pass. Verify with `npx cypress info`.
2. **Choose browsers honestly.** Cypress runs Electron (bundled), Chrome, Chromium, Edge, and
   Firefox natively; WebKit needs the Playwright dependency (`npx playwright install webkit`).
   Safari is **not** available — say so rather than implying coverage.
3. **Split the matrix by cost.** Full matrix on the main branch/nightly; a single representative
   browser (Chrome headless) on every PR. WebKit/Firefox on a scheduled job.
4. **Isolate browser-specific config** — viewport, user agent, and timeouts differ; keep them in
   `cypress.config.ts` per-browser rather than scattering conditionals in specs.
5. **Make failures attributable** — one job per browser, browser name in the artifact/spec
   name, so a red run names the browser immediately.
6. **State the uncovered browsers** and any known per-browser skip.

## Output shape
```typescript
// cypress.config.ts
import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    baseUrl: process.env.BASE_URL ?? 'http://localhost:3000',
    viewportWidth: 1280,
    viewportHeight: 800,
    retries: { runMode: 1, openMode: 0 }, // one retry in CI only, after investigating flake
  },
});
```

```jsonc
// package.json
{
  "scripts": {
    "cy:chrome":   "cypress run --browser chrome",
    "cy:firefox":  "cypress run --browser firefox",
    "cy:edge":     "cypress run --browser edge",
    "cy:webkit":   "cypress run --browser webkit",
    "cy:electron": "cypress run --browser electron",
    "cy:matrix":   "npm run cy:chrome && npm run cy:firefox && npm run cy:edge && npm run cy:webkit"
  }
}
```

```yaml
# .github/workflows/e2e.yml (matrix job)
strategy:
  fail-fast: false
  matrix:
    browser: [chrome, firefox, edge]
steps:
  - run: npm ci
  - run: npx cypress run --browser ${{ matrix.browser }}
```
> WebKit is run in a separate scheduled job with `npx playwright install --with-deps webkit`.

## Guardrails
- Never report a browser as covered when the binary is absent — Cypress skips it; check
  `cypress info` first.
- Safari is not a Cypress target; do not claim iOS/Safari coverage from a desktop Cypress run.
- Do not add `retries` to make a browser matrix green; a browser-only failure is a finding.
- Keep the PR matrix small — a full matrix on every commit discourages running the tests.
- Pin browser channels in CI (e.g. `--browser chrome --config chromeWebSecurity=false` only
  when genuinely required) so runs are reproducible.
