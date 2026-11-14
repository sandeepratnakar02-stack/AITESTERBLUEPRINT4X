---
name: cy-network-mocker
description: >-
  Stubs and shapes network traffic in Cypress with cy.intercept. Use when an SDET says
  "mock the API", "stub this error response", "test the empty state", "simulate a slow
  backend", "the third-party call is unreliable", or pastes a cy.intercept attempt.
  Produces intercepts for happy, error, empty, and delay cases with explicit fixtures.
license: MIT
metadata:
  author: TheTestingAcademy
  pack: cypress
  version: 1.0.0
---

# CY Network Mocker

You take control of the network so a UI test tests **the UI**, not the backend's mood — while
being explicit about what is stubbed and what is real.

## When to use
- A state is hard to reach with real data (empty list, 500, slow response, partial failure).
- A third-party dependency (payments, analytics, maps) is slow, rate-limited, or costly.
- A test races the backend and needs determinism.

## Workflow
1. **Decide the contract.** Capture the real response shape first (from a live call or the
   OpenAPI/schema). A stub you invented tests nothing about your app.
2. **Choose the mode:**

   | Goal | Approach |
   |---|---|
   | Fast happy path | `cy.intercept(url, { fixture: 'x.json' })` |
   | Verify the request sent | `cy.intercept(...).as('x')` + assert on `cy.wait('@x').request` |
   | Error handling | `reply` with `statusCode: 500` and an error body |
   | Empty state | Reply `200` with `[]` / no results |
   | Latency / loading UI | `reply((req) => req.reply({ ..., delay: 1500 }))` |
   | Pass-through with assertion | `cy.intercept(url, (req) => { req.continue() })` |

3. **Scope narrowly.** Match method + URL (or `{ pathname }`) so one intercept cannot
   accidentally swallow unrelated requests.
4. **Order matters.** Register stubs in `beforeEach` before `cy.visit` so the initial page
   load is intercepted; later registrations only affect later calls.
5. **Assert both sides** — what was sent (method, body, headers) and what the UI did with the
   response.
6. **State the boundary** — list which endpoints are stubbed and which are real, so a reader
   knows the test's integration value.

## Output shape
```typescript
describe('Invoice list', () => {
  it('shows the empty state when the API returns no rows', () => {
    cy.intercept('GET', '/api/invoices', { statusCode: 200, body: [] }).as('list');
    cy.visit('/invoices');

    cy.wait('@list').its('response.statusCode').should('eq', 200);
    cy.get('[data-cy=empty-state]').should('be.visible');
    cy.get('[data-cy=invoice-row]').should('not.exist');
  });

  it('surfaces a server error without losing the page', () => {
    cy.intercept('GET', '/api/invoices', {
      statusCode: 500,
      body: { message: 'boom' },
    }).as('list');
    cy.visit('/invoices');

    cy.get('[data-cy=error-banner]').should('contain.text', 'Something went wrong');
    cy.get('[data-cy=retry]').should('be.enabled');
  });

  it('sends the filter as a query parameter', () => {
    cy.intercept('GET', '/api/invoices*', { fixture: 'invoices.json' }).as('list');
    cy.visit('/invoices');
    cy.get('[data-cy=filter-status]').select('open');

    cy.wait('@list').its('request.url').should('include', 'status=open');
  });
});
```

## Guardrails
- Never invent a response schema; capture the real one first, then stub it.
- Stubbing the endpoint under test can make a test pass while the integration is broken —
  say plainly that the test now covers UI behaviour, not the API contract.
- Do not use one broad intercept (`cy.intercept('**')`) — it hides unrelated failures.
- Keep large bodies in `cypress/fixtures/`, not inline in the spec.
- Prefer `req.continue()` over re-implementing a real backend response in the stub.
