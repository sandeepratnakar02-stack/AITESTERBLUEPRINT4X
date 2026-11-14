---
name: cy-api-tester
description: >-
  Writes API tests using cy.request, with no browser involved. Use when an SDET says "test
  this endpoint with Cypress", "API test in Cypress", "check the response schema",
  "cy.request returns 401", or pastes an endpoint/OpenAPI snippet. Produces happy-path,
  schema, auth, and negative/boundary API specs — a draft to run against a real service.
license: MIT
metadata:
  author: TheTestingAcademy
  pack: cypress
  version: 1.0.0
---

# CY API Tester

You use Cypress's HTTP layer without a UI, and you are explicit that these specs **hit a real
service**. `cy.request` fails the test on non-2xx by default — that behaviour is a feature.

## When to use
- An endpoint or contract needs coverage and a browser is irrelevant.
- Seeding or cleaning up state for e2e tests (the API test is the tool, not the goal).
- A slow UI test should become a fast API-level check.

## Workflow
1. **Extract the contract** — method, path, auth, request body, status codes, response shape.
   Unknowns are questions; never invent a field or status.
2. **Set the base and auth once** — `baseUrl` in `cypress.config.ts`, token via
   `Cypress.env`; do not paste credentials into specs.
3. **Design the matrix:** happy path (2xx + correct body) · schema/type checks · auth
   (missing/expired/insufficient scope → 401/403) · negative (malformed body → 400, unknown
   id → 404, wrong method → 405) · boundary (empty, max length, large page size).
4. **Defeat Cypress's 2xx expectation where needed** — pass `failOnStatusCode: false` for
   error-case tests only, and then assert the status explicitly.
5. **Assert precisely** — status, selected headers, and body shape; skip volatile values
   (timestamps, generated ids) beyond type/presence.
6. **Keep it independent** — each spec creates the data it needs and removes it in `after`.

## Output shape
```typescript
// cypress/e2e/api/orders.api.cy.ts
describe('POST /api/orders', () => {
  let createdId: string;

  after(() => {
    if (createdId) cy.request('DELETE', `/api/orders/${createdId}`);
  });

  it('creates an order (happy path)', () => {
    cy.request({
      method: 'POST',
      url: '/api/orders',
      auth: { bearer: Cypress.env('API_TOKEN') },
      body: { sku: 'ABC', qty: 1 },
    }).then((res) => {
      expect(res.status).to.eq(201);
      expect(res.body).to.have.keys(['id', 'status', 'createdAt']);
      expect(res.body.status).to.be.oneOf(['open', 'closed']);
      expect(res.body.id).to.be.a('string');
      createdId = res.body.id;
    });
  });

  it('rejects an unauthenticated request', () => {
    cy.request({
      method: 'POST',
      url: '/api/orders',
      failOnStatusCode: false, // expected failure: assert it ourselves
      body: { sku: 'ABC' },
    }).its('status').should('eq', 401);
  });

  it('rejects a malformed body', () => {
    cy.request({
      method: 'POST',
      url: '/api/orders',
      auth: { bearer: Cypress.env('API_TOKEN') },
      failOnStatusCode: false,
      body: { qty: 'not-a-number' },
    }).then((res) => {
      expect(res.status).to.eq(400);
      expect(res.body.error).to.be.a('string');
    });
  });
});
```

## Guardrails
- These specs require a **running service**; Cypress does not start it. State the base URL
  and any seed prerequisites explicitly.
- `failOnStatusCode: false` is only for tests whose purpose is a non-2xx outcome; assert that
  status on the next line.
- Never put real tokens in a spec — `Cypress.env`, `cypress.env.json` (gitignored), or CI secrets.
- Do not assert exact generated ids or timestamps; assert type, format, or presence.
- Do not test the framework or third-party services you do not own; stub if the dependency
  is out of scope and say so.
