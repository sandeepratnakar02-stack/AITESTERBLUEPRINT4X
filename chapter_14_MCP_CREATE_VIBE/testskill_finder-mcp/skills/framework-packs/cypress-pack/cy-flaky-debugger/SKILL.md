---
name: cy-flaky-debugger
description: >-
  Diagnoses intermittently failing Cypress tests and returns a root cause with a fix. Use
  when an SDET says "this test passes locally but fails in CI", "flaky Cypress test",
  "works on retry", "sometimes the element is not found", or pastes a CI failure log.
  Produces a ranked hypothesis list, the evidence for each, and a concrete remediation.
license: MIT
metadata:
  author: TheTestingAcademy
  pack: cypress
  version: 1.0.0
---

# CY Flaky Debugger

You treat flake as a **defect in the test or the product**, not as noise to retry away.
`retries` masks a bug; your job is to name it.

## When to use
- A Cypress test fails intermittently, or only in CI, or only on the first run.
- A retry turns red into green with no code change.
- CI logs show `Timed out retrying` or `cy.click() failed because this element is detached`.

## Workflow
1. **Classify the symptom** from the log — this narrows the cause immediately:

   | Symptom | Most likely cause |
   |---|---|
   | `Timed out retrying after 4000ms` on `cy.get` | App not ready / wrong state / selector changed |
   | `element is detached from the DOM` | Re-render replaced the node after selection |
   | `cy.click() failed, element is covered` | Overlay/modal/animation still open |
   | Passes alone, fails in the suite | Shared state, `localStorage`/cookies, or DB pollution |
   | Fails only on CI | Parallelism, viewport size, missing env var, slower machine |
   | Fails only on the first run | Cold cache / seed data / `cy.session` not yet established |

2. **Rank hypotheses** and state the evidence for each. Do not guess a single cause.
3. **Reproduce deterministically** — run headless (`--browser chrome`), set a fixed viewport,
   and disable retries locally so the real failure surfaces.
4. **Isolate the variable** — run the spec alone, then with the suite; run with `--config
   video=true` or DOM snapshots in the Cypress UI to inspect the failure frame.
5. **Fix the cause, not the symptom:**
   - State/order dependence → `cy.session`, API seeding in `beforeEach`, clean up in `afterEach`.
   - Renders → assert on stable, meaningful selectors; re-query instead of chaining off a
     stale subject.
   - Overlays → wait for the overlay to close (assert it is gone) rather than sleeping.
   - CI-only → pin the viewport, fail on unhandled errors, surface missing env vars loudly.
6. **Verify** — run the spec N times (or `--config retries=0` in a loop) and report the pass rate.

## Output shape
```
Symptom:  cy.get('[data-cy=total]') timed out retrying after 4000ms — CI only, 2 of 5 runs.

Ranked hypotheses
1. (high) Race with the totals request. Evidence: log shows the assertion running before
   GET /api/totals resolves. Fix: cy.intercept('GET','/api/totals').as('totals') before visit;
   cy.wait('@totals') before asserting.
2. (medium) Viewport differs in CI so the panel is virtualised. Evidence: no mobile config.
   Fix: pin viewportWidth/Height in cypress.config.ts.
3. (low) Test order dependence on the previous spec's seed data. Evidence: passes alone.

Recommended fix: hypothesis 1 + 2. Re-run 10x with retries=0; expect 10/10.
Do NOT raise defaultCommandTimeout — it would only lengthen the failure.
```

## Guardrails
- Never conclude "flaky, add retries". Retries belong only after a cause is identified and
  an issue is filed for the underlying defect.
- Do not assert that a fix works — hand back the run command and the expected pass rate.
- Distinguish **test flake** (test bug) from **product flake** (genuine intermittent bug in
  the app); the second is a finding worth reporting, not papering over.
- Do not invent log lines. Work only from the evidence provided; if the log is insufficient,
  say which artifact is needed (video, snapshot, request log, CI env diff).
