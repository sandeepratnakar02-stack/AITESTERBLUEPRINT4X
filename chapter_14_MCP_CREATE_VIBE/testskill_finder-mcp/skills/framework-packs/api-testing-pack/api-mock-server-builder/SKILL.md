---
name: api-mock-server-builder
description: >-
  Builds a mock/stub API from an OpenAPI spec or recorded responses so tests and frontend work
  can proceed without the real backend. Use when a tester says "mock this API", "the backend
  isn't ready", "stub this dependency", "simulate a 500", or wants deterministic third-party
  responses. Produces an OpenAPI-driven mock (Prism/WireMock/MSW) with controlled scenarios.
license: MIT
metadata:
  author: TheTestingAcademy
  pack: api-testing
  version: 1.0.0
---

# API Mock Server Builder

You stand up a **contract-accurate** fake so work is not blocked — and you keep the seam between
fake and real visible, because a mock that drifts from reality is worse than no mock.

## When to use
- A dependency is unavailable, rate-limited, slow, or expensive (payments, SMS, maps).
- A test must hit an error/edge state that is hard to produce with real data.
- Frontend and API teams need to work in parallel against an agreed contract.

## Workflow
1. **Choose the source of truth.** Prefer the OpenAPI/schema, not hand-written JSON. If no spec
   exists, capture real responses and record where they came from and when.
2. **Pick the tool for the job:**

   | Need | Tool |
   |---|---|
   | Mock from OpenAPI, validates requests | Prism (`prism mock openapi.yaml`) |
   | Rich stubbing, request matching, recording | WireMock / MockServer |
   | In-process for frontend/unit tests | MSW (Mock Service Worker) |
   | Postman/Bruno-only workflow | Collection mock server |

3. **Define scenarios as data, not code branches.** Named scenarios (`happy`, `empty`,
   `unauthorized`, `rate_limited`, `server_error`, `slow`) that a test can select by header,
   query param, or env var.
4. **Keep the mock strict** — enable request validation so a mock does not silently accept a
   contract violation the real service would reject.
5. **Model the failures you need:** status codes, delay, malformed body, partial data,
   pagination end, and duplicate/idempotency behaviour.
6. **Make the seam explicit** — document which endpoints are mocked, the scenario names, and how
   to point tests at the real service. Add a CI job that runs the same contract tests against
   the real API so drift is caught.

## Output shape
```yaml
# docker-compose.mock.yml  — WireMock with named scenarios
services:
  mock-api:
    image: wiremock/wiremock:3
    ports: ["8081:8080"]
    volumes: ["./mocks:/home/wiremock"]
```

```json
// mocks/mappings/orders-error.json
{
  "scenarioName": "orders",
  "requiredScenarioState": "Started",
  "request": { "method": "GET", "urlPath": "/api/orders" },
  "response": { "status": 500, "jsonBody": { "message": "internal" },
                "headers": { "Content-Type": "application/json" } }
}
```

```yaml
# openapi-mock: validate the request shape against the spec
#   npx prism mock openapi.yaml --errors        → 422 on contract violation
# scenario selection for tests:
#   GET /api/orders?__scenario=empty            → 200 {items: []}
#   GET /api/orders?__scenario=slow             → 200 after 2000 ms
#   GET /api/orders  (no auth header)           → 401
```

```
Seam
  Mocked : /api/orders, /api/payments/**
  Real   : everything else (proxy_pass to the staging host)
  Drift guard: `npm run contract:real` runs the same assertions against staging nightly.
```

## Guardrails
- Never present mocked results as integration evidence — state clearly which endpoints were faked.
- Derive mocks from the contract; a hand-written response is a guess and will drift.
- Enable request validation, or the mock will accept requests the real API rejects.
- Never record production traffic containing PII into fixtures; sanitise or synthesise.
- Keep time in the mock controllable (fixed clock) so assertions are deterministic.
- Delete or version mocks when the real endpoint lands, or tests will pass against a ghost.
