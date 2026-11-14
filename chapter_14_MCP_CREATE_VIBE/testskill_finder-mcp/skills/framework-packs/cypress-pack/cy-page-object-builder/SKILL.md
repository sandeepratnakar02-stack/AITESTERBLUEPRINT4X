---
name: cy-page-object-builder
description: >-
  Extracts reusable Cypress custom commands and page objects from duplicated specs. Use when
  an SDET says "DRY up these specs", "make a login command", "add a page object", "this
  flow is repeated in ten files", or pastes repeated cy.get chains. Produces a typed custom
  command (or page object) plus the refactored spec, keeping assertions in the spec.
license: MIT
metadata:
  author: TheTestingAcademy
  pack: cypress
  version: 1.0.0
---

# CY Page Object Builder

You remove duplication without hiding the test's intent. In Cypress the idiomatic unit is the
**custom command / app-action**, not a heavyweight class hierarchy with assertion methods.

## When to use
- The same `cy.get(...).type(...)` chain appears in three or more specs.
- Login, seeding, or navigation setup is copied across files.
- A team asks for "page objects" and needs the Cypress-appropriate shape.

## Workflow
1. **Count the duplication** — only abstract a flow used repeatedly, or one you expect to
   change in one place (auth, feature flags).
2. **Choose the tool:**
   - One-off setup used in several specs → `cy.session()` or a `beforeEach` helper.
   - Cross-cutting action with no assertions → **custom command** (`cy.login`).
   - A page with many related actions → a thin **functions module** or page object that
     exposes *actions* and *locators*, never assertions.
3. **Keep assertions in the spec.** Commands perform actions and may wait for state; the
   spec owns `should(...)`. Otherwise a failure message points at the helper, not the test.
4. **Type it.** Add the declaration merge so editors autocomplete and typos fail at compile time.
5. **Refactor one spec first**, show the before/after diff, and only then apply broadly.

## Output shape
```typescript
// cypress/support/commands.ts
Cypress.Commands.add('login', (email: string, password: string) => {
  cy.session([email, password], () => {
    cy.visit('/login');
    cy.get('[data-cy=email]').type(email);
    cy.get('[data-cy=password]').type(`${password}{enter}`);
    cy.location('pathname').should('eq', '/dashboard'); // session must be established
  });
});

// cypress/support/index.d.ts
declare global {
  namespace Cypress {
    interface Chainable {
      /** Logs a user in via cy.session and verifies the dashboard. */
      login(email: string, password: string): Chainable<void>;
    }
  }
}
export {};

// cypress/e2e/invoices.cy.ts — asserts stay here
describe('Invoices', () => {
  beforeEach(() => cy.login(Cypress.env('USER'), Cypress.env('PASSWORD')));

  it('shows an empty state before any invoice exists', () => {
    cy.visit('/invoices');
    cy.get('[data-cy=empty-state]').should('be.visible');
  });
});
```

## Guardrails
- Do not create assertion methods (`page.shouldShowError()`) — failures become unreadable.
- Do not abstract a flow used once or twice; the indirection costs more than it saves.
- Commands must not hide `cy.visit` side effects or change global state without saying so.
- Never put credentials in the helper — read them from `Cypress.env` / CI secrets.
- Keep locators out of specs only if a single source of truth exists; otherwise prefer the
  command to own its selectors and the spec to own its assertions.
