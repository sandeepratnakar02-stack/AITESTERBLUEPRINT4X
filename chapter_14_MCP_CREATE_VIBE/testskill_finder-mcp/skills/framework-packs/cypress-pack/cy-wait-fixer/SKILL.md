---
name: cy-wait-fixer
description: >-
  Removes brittle waits from Cypress tests and replaces them with retry-able assertions.
  Use when an SDET says "cy.wait is flaky", "test fails only in CI", "element not found
  sometimes", "how do I wait for the API", or pastes a spec full of cy.wait(5000). Produces
  rewritten specs using cy.intercept aliases, cy.session, and timeouts that fail fast.
license: MIT
metadata:
  author: TheTestingAcademy
  pack: cypress
  version: 1.0.0
---

# CY Wait Fixer

You replace **time-based hope** with **condition-based certainty**. Cypress already retries
assertions and commands; most `cy.wait(ms)` calls exist because someone did not know that.

## When to use
- A spec contains `cy.wait(<number>)`.
- A test is green locally and red in CI (or intermittently).
- A page appears slow, and the fix applied was a longer sleep.

## Workflow
1. **Find the true dependency.** For each wait, identify what the test is actually waiting
   for: an XHR/fetch, a render, an animation, a redirect, or a session.
2. **Wait on the condition instead:**

   | Waiting for | Replace with |
   |---|---|
   | API response | `cy.intercept('POST', '/api/orders').as('createOrder')` then `cy.wait('@createOrder')` |
   | Element visible | `cy.get(sel).should('be.visible')` (retries automatically) |
   | Text/value | `cy.get(sel).should('have.text', ...)` / `should('have.value', ...)` |
   | Redirect | `cy.location('pathname').should('eq', '/next')` |
   | Session/auth | `cy.session()` — establishes state once and validates it |
   | One-time clock/animation | `cy.clock()` / disable CSS animations in config |

3. **Assert on the response, not just its arrival.** Check status and, where relevant, that
   the UI reflects the payload — otherwise the wait proves nothing.
4. **Fail fast.** Set `defaultCommandTimeout`/`requestTimeout` in `cypress.config.ts` to a
   realistic ceiling; a 30 s timeout hides a 200 ms regression.
5. **Prove it.** Explain why the new form cannot flake: the assertion retries, so a slow
   response delays rather than breaks the test.

## Output shape
```typescript
// Before — time-based, order-dependent, flaky
cy.get('[data-cy=save]').click();
cy.wait(5000);
cy.get('[data-cy=toast]').should('contain', 'Saved');

// After — condition-based, retry-able
cy.intercept('POST', '/api/invoices').as('saveInvoice');
cy.get('[data-cy=save]').click();
cy.wait('@saveInvoice').its('response.statusCode').should('eq', 201);
cy.get('[data-cy=toast]').should('be.visible').and('contain', 'Saved');
```

```typescript
// cypress.config.ts — realistic ceilings instead of padding waits
export default defineConfig({
  defaultCommandTimeout: 6000,
  requestTimeout: 10000,
  e2e: { setupNodeEvents(on, config) { /* ... */ } },
});
```

## Guardrails
- Never "fix" flake by increasing `defaultCommandTimeout` without first finding the real
  dependency — that converts a fast failure into a slow one.
- `cy.wait('@alias')` is only meaningful if the alias was created *before* the action that
  triggers it.
- Do not intercept-and-stub when the test's purpose is to verify real integration; stub only
  to isolate, and say so.
- Do not wait on an element that never appears (a hidden failure) — assert the success path
  and the error path explicitly.
- If a wait cannot be removed, state why (e.g. third-party iframe with no observable signal)
  and keep it as short and as scoped as possible.
