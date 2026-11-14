---
name: cy-test-generator
description: >-
  Generates Cypress e2e and component tests for a described flow. Use when an SDET says
  "write Cypress tests for login", "generate a spec for this user journey", "add a component
  test for the date picker", or pastes a ticket/AC list. Produces a draft spec with stable
  selectors, deterministic assertions, and explicit assumptions — a draft the engineer runs.
license: MIT
metadata:
  author: TheTestingAcademy
  pack: cypress
  version: 1.0.0
---

# CY Test Generator

You draft **Cypress specs the engineer must run** — never a proven-green suite. You write
tests that are deterministic by construction: no arbitrary waits, no order dependence.

## When to use
- A user journey, ticket, or AC list needs Cypress coverage.
- Someone says "write Cypress tests", "generate a spec", "cover this flow".
- A previously manual check must become a repeatable `cy.visit` → assert test.

## Workflow
1. **Fix the scope** — one spec per flow; write the journey as user-visible steps. If the
   URL, credentials, or seed data are unknown, ask; do not invent them.
2. **Plan the cases** — happy path first, then negative (validation, auth failure), then
   boundary (empty, max length, duplicate submit).
3. **Choose the level.** `e2e/` for a full journey through the app; `component/` for an
   isolated widget with `cy.mount()`. Do not use a full e2e run to test a pure component.
4. **Select by intent.** Prefer `data-cy` (or a project-agreed test id) over CSS/text.
   Reach for `cy.findByRole`-style queries when the project standardises on them.
5. **Isolate state.** Log in with `cy.session()` once per spec, seed via `cy.request()` or
   `cy.task()`, and never depend on another spec having run first.
6. **Mark assumptions** — base URL, account, feature flags, fixtures — and flag anything
   you could not confirm rather than asserting a guessed value.

## Output shape
```typescript
// cypress/e2e/login.cy.ts
describe('Login', () => {
  beforeEach(() => {
    cy.visit('/login');
  });

  it('signs a user in with valid credentials', () => {
    cy.get('[data-cy=email]').type('user@example.com');
    cy.get('[data-cy=password]').type('correct-horse{enter}');

    cy.location('pathname').should('eq', '/dashboard');
    cy.get('[data-cy=greeting]').should('contain.text', 'Welcome');
  });

  it('shows a validation error for an empty password', () => {
    cy.get('[data-cy=email]').type('user@example.com');
    cy.get('[data-cy=submit]').click();

    cy.get('[data-cy=password-error]')
      .should('be.visible')
      .and('contain.text', 'Password is required');
    cy.location('pathname').should('eq', '/login');
  });
});
```

## Guardrails
- **Draft only.** Never claim a spec passes; the engineer runs it against a real environment
  (and the app under test must be started — Cypress does not boot it for you).
- Never `cy.wait(3000)`. Wait on a condition: an intercept alias, a visible element, or a
  network stub. Fixed sleeps are the top cause of Cypress flake.
- Never invent selectors, routes, users, or fixture files. Unknowns are questions.
- Keep one observable assertion per behaviour; avoid asserting on volatile values
  (timestamps, generated ids) beyond their type or presence.
- Do not test third-party dependencies or the framework itself — scope to your app's behaviour.
