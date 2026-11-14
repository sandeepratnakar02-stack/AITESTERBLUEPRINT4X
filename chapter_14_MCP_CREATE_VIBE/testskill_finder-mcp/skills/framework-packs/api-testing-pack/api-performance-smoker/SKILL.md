---
name: api-performance-smoker
description: >-
  Writes lightweight API load/smoke checks and interprets the results. Use when a tester says
  "is this endpoint slow", "add a performance smoke test", "check p95 latency", "will it
  handle 100 concurrent users", or pastes a latency/throughput result. Produces a k6 (or
  equivalent) script, thresholds, and an honest reading of the numbers.
license: MIT
metadata:
  author: TheTestingAcademy
  pack: api-testing
  version: 1.0.0
---

# API Performance Smoker

You give endpoints a **fast, repeatable smoke check for latency and error rate** — and you are
explicit that this is not a capacity test.

## When to use
- An endpoint must not regress past a latency budget in CI.
- A change to a query, cache, or index needs a before/after number.
- Someone asks "will it handle N users" and no load profile exists yet.

## Workflow
1. **Get a budget, not a vibe.** Ask for the target (e.g. p95 < 300 ms at 20 rps) and where it
   came from (SLO, product requirement, current baseline). Without a budget, a number is not a pass.
2. **Separate the three questions:**
   - **Smoke** — does it work under a little load? (low VUs, seconds, CI-friendly)
   - **Load** — does it meet the budget at expected traffic?
   - **Stress/soak** — where does it break, and does it degrade over hours?
   v1 of this skill produces the **smoke** only; say so.
3. **Model the request realistically** — real auth, representative payload size, think time,
   and a data set that does not hit a single cached key.
4. **Set thresholds so failure is meaningful** — p95 latency, error rate, and a check on
   response correctness (a fast wrong answer is not a pass).
5. **Report with conditions** — concurrency, duration, environment, dataset, and whether the
   target was a shared environment (results may be meaningless).
6. **Give the delta, not just the value** — compare against a baseline, otherwise the number
   has no meaning.

## Output shape
```javascript
// perf/orders.smoke.js  — run: k6 run perf/orders.smoke.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    smoke: { executor: 'constant-vus', vus: 5, duration: '30s' },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],            // < 1% errors
    http_req_duration: ['p(95)<300', 'p(99)<800'],
    checks: ['rate>0.99'],
  },
};

const BASE = __ENV.BASE_URL;          // never hard-code an environment
const TOKEN = __ENV.API_TOKEN;        // injected by CI, never committed

export default function () {
  const res = http.get(`${BASE}/api/orders?limit=20`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'returns a JSON body': (r) => (r.headers['Content-Type'] || '').includes('application/json'),
    'has no more than 20 rows': (r) => (JSON.parse(r.body).items || []).length <= 20,
  });

  sleep(1); // think time
}
```

```
Reported as:
  Environment : staging, single 2-vCPU instance, shared with CI (numbers indicative, not capacity)
  Conditions  : 5 VUs, 30 s, ~1.4k requests, unique ids per request
  Baseline    : p95 240 ms (previous release)   → Now: p95 268 ms (+12%)
  Thresholds  : PASS (p95 < 300 ms, error rate 0.0%)
  Verdict     : no regression beyond budget; NOT a statement about production capacity at 1000 users.
```

## Guardrails
- **Never run load tests against production** or third-party APIs without explicit, documented
  permission and an agreed ceiling.
- A latency figure without concurrency, duration, environment, and dataset is meaningless — always
  state the conditions.
- Do not present a smoke test as capacity planning; the two answer different questions.
- Never hard-code tokens or hostnames; use `__ENV`/CI secrets.
- A fast response that is wrong still fails — assert the payload, not just the timing.
- Keep CI smoke tests short (seconds, low VUs); heavy runs belong in a scheduled job.
