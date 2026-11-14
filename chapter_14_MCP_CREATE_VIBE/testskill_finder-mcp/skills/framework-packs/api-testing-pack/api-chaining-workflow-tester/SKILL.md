---
name: api-chaining-workflow-tester
description: >-
  Tests multi-step, stateful API workflows where one call feeds the next (create → pay →
  fulfil, sign-up → verify → login). Use when a tester says "test the whole flow", "chain these
  API calls", "the order lifecycle", "state transition test", or pastes a sequence of
  endpoints. Produces a runnable state-machine test with idempotency and rollback handling.
license: MIT
metadata:
  author: TheTestingAcademy
  pack: api-testing
  version: 1.0.0
---

# API Chaining & Workflow Tester

You test the **journey and its illegal moves**, not isolated calls. Single-endpoint tests pass
while the workflow is broken.

## When to use
- Business value lives in a sequence: order → payment → shipment, KYC, onboarding.
- Resource state matters (`draft → submitted → approved → closed`).
- Retries/idempotency or partial failure behaviour is unknown.

## Workflow
1. **Model the state machine first** — states, allowed transitions, and who may trigger each.
   Write it down; it becomes the test plan.
2. **Chain with extracted state** — capture ids/tokens from each response and pass them on;
   never hard-code an id a previous step produced.
3. **Test the legal path** — the full happy journey in order, asserting the state after each hop.
4. **Test the illegal paths** (where the defects are):
   - Out-of-order transition (pay before create, ship before payment).
   - Repeat/replay of a non-idempotent call (double submit → double order?).
   - Stale resource (act on a cancelled/expired entity).
   - Authorization at each hop — a valid actor for step 1 may be forbidden at step 3.
   - Partial failure — step 2 fails; is the state left consistent, or is a rollback/compensation run?
5. **Control time and async work** — polls, webhooks, and queues need a bounded wait with a
   clear failure message, not a fixed sleep.
6. **Make it independent and repeatable** — unique data per run, cleanup in teardown, and no
   reliance on another test's leftovers.

## Output shape
```
State machine: order
  draft ──submit──> submitted ──approve──> approved ──fulfil──> fulfilled
      └──cancel──> cancelled     (terminal)      (terminal)

Cases
  1  full happy path: draft→submitted→approved→fulfilled, asserting status + totals at each hop
  2  approve before submit              → 409 (illegal transition), state unchanged
  3  fulfil a cancelled order           → 409
  4  duplicate submit (same Idempotency-Key) → 200 same order id, only ONE order created
  5  duplicate submit (no key, 2 calls) → record actual behaviour; assert it is intentional
  6  step 3 with a token lacking approve scope → 403, remains submitted
  7  payment fails at step 2            → order stays submitted, no partial fulfilment, retryable
  8  act on an expired draft (TTL)      → 410/409, no resurrection
```

```typescript
// excerpts: chain by extracting ids, assert state after each hop
const created = await api.post('/orders', { sku, idempotencyKey });
expect(created.status).toBe(201);
const orderId = created.body.id;                    // never hard-code

const submitted = await api.post(`/orders/${orderId}/submit`);
expect(submitted.body.status).toBe('submitted');

await api.post(`/orders/${orderId}/approve`);       // hop 3
const fulfilled = await api.post(`/orders/${orderId}/fulfil`);
expect(fulfilled.body.status).toBe('fulfilled');

// illegal move from a terminal state
const again = await api.post(`/orders/${orderId}/cancel`);
expect(again.status).toBe(409);
expect((await api.get(`/orders/${orderId}`)).body.status).toBe('fulfilled'); // unchanged
```

## Guardrails
- Assert the **state after every hop**; a chain that only checks the final 200 hides corruption.
- Never hard-code ids/tokens produced by an earlier step; extract them from the response.
- Always clean up (or use disposable tenants); workflow tests create real data.
- Do not use fixed sleeps for async completion — poll a status endpoint with a bounded timeout.
- Idempotency behaviour must be **observed and reported**, not assumed; a replay creating a
  duplicate is a finding.
- Run these against a non-production environment with test accounts.
