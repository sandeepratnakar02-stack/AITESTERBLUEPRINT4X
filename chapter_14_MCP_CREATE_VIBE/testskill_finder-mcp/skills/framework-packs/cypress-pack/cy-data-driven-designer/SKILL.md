---
name: cy-data-driven-designer
description: >-
  Turns repeated Cypress specs into data-driven tests using fixtures and loops. Use when an
  SDET says "run this for 20 users", "data-driven Cypress test", "use a fixture file",
  "cover all these payloads", or pastes a list of input/expected pairs. Produces fixture
  files, a single parameterised spec, and the boundary/negative rows that must be included.
license: MIT
metadata:
  author: TheTestingAcademy
  pack: cypress
  version: 1.0.0
---

# CY Data-Driven Designer

You separate **data** from **test logic** so coverage grows by adding rows, not by copying
specs. You also make the dataset honest — every row states the behaviour it proves.

## When to use
- The same flow must run with many inputs (users, roles, currencies, payload sizes).
- A CSV/XLSX of test data already exists and needs to drive Cypress.
- A spec file has grown by copy-paste, one `it()` per value.

## Workflow
1. **Classify the rows** — happy path, negative, boundary. A dataset with only happy rows is
   a coverage claim you cannot make; add the missing classes or say they are absent.
2. **Pick the data source:**
   - Static, small, versioned with the tests → `cypress/fixtures/*.json`.
   - Shared with manual QA or large → CSV loaded via `cy.readFile`/`cy.task` (Node side).
   - Environment-specific (users, URLs, keys) → `Cypress.env` / `cypress.env.json`, never inline.
3. **Parameterise the spec** — loop the rows and title each test so a failure names the data:
   `it(`${row.case}: ${row.expected}`, ...)`.
4. **Assert per row** — assert only what the row claims. Do not share one mega-assertion.
5. **Keep secrets out.** Fixtures are committed; credentials and tokens come from env.
6. **Report the matrix** — what the dataset covers and which classes are still missing.

## Output shape
```json
// cypress/fixtures/login-cases.json
[
  { "case": "happy path",      "email": "user@example.com", "password": "correct",    "expected": "dashboard", "class": "positive" },
  { "case": "wrong password",  "email": "user@example.com", "password": "wrong",      "expected": "error",     "class": "negative" },
  { "case": "empty password",  "email": "user@example.com", "password": "",           "expected": "error",     "class": "boundary" },
  { "case": "unknown user",    "email": "nobody@example.com","password": "whatever",  "expected": "error",     "class": "negative" }
]
```

```typescript
// cypress/e2e/login.data-driven.cy.ts
describe('Login (data-driven)', () => {
  // cy.fixture caches, so load once and create tests in the callback.
  cy.fixture('login-cases').then((cases: LoginCase[]) => {
    cases.forEach((row) => {
      it(`${row.class} — ${row.case}`, () => {
        cy.visit('/login');
        cy.get('[data-cy=email]').type(row.email);
        if (row.password) cy.get('[data-cy=password]').type(row.password);
        cy.get('[data-cy=submit]').click();

        if (row.expected === 'dashboard') {
          cy.location('pathname').should('eq', '/dashboard');
        } else {
          cy.get('[data-cy=login-error]').should('be.visible');
          cy.location('pathname').should('eq', '/login');
        }
        cy.screenshot(`login-${row.case}`, { capture: 'viewport', overwrite: true });
      });
    });
  });
});
```

## Guardrails
- Never put real passwords, tokens, or PII in a fixture — fixtures are committed to git.
- Do not assert on data you generated inside the same test (tautology); assert on a
  user-observable outcome.
- Avoid a single dataset shared by unrelated specs; a change to one flow should not ripple.
- Large datasets belong outside the spec file; keep the spec a thin driver.
- Do not invent expected values — an unconfirmed expectation is a question for the author.
- Keep one failure per row so CI output identifies the offending record.
