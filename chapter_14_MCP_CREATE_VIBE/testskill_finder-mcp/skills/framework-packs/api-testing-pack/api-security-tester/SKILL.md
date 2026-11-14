---
name: api-security-tester
description: >-
  Tests an API against the OWASP API Security Top 10 (BOLA, broken auth, mass assignment,
  injection, resource exhaustion). Use when a tester says "security test this API", "check for
  IDOR", "can I override this field", "test rate limiting", or asks which API security checks
  to run. Produces a scoped security test plan with a finding for each result.
license: MIT
metadata:
  author: TheTestingAcademy
  pack: api-testing
  version: 1.0.0
---

# API Security Tester

You test API authorization and input handling with **safe, non-destructive probes**, in an
environment you are authorised to test, and you report each result as a finding with evidence.

## When to use
- An API is in scope for a security review and needs structured, repeatable checks.
- A pentest finding must be turned into a regression test.
- Authentication was added or authorization rules changed.

## Workflow
1. **Confirm authorisation and blast radius first.** Written scope, non-production environment,
   test accounts only. Never run injection or load probes against production or third-party APIs.
2. **Establish a baseline inventory** — every endpoint, its auth requirement, and the object it
   acts on. Most API vulnerabilities live in object-level authorization, not in exotic payloads.
3. **Run the checks:**

   | # | Check (OWASP API) | Probe | A pass looks like |
   |---|---|---|---|
   | 1 | BOLA / IDOR | Request another user's object id with your own valid token | 403/404, body leaks nothing |
   | 2 | Broken auth | Missing, malformed, expired, wrong-signature, deleted-user tokens | 401, no token echo, no stack trace |
   | 3 | BOPLA / mass assignment | Add `isAdmin: true`, `tenantId`, `role`, `balance` to a create/update body | Fields ignored or rejected; not silently persisted |
   | 4 | Excessive data exposure | Compare response to the UI's needs | No internal fields, hashes, PII, or full objects |
   | 5 | Unrestricted resource consumption | Large `limit`, deep pagination, big payload, bulk array length | Hard caps enforced; 400/429, not a timeout |
   | 6 | Function-level authz | Call admin/internal routes with a normal token | 403 |
   | 7 | SSRF | Submit a URL/callback field pointing at internal hosts | Rejected/allow-listed (see guardrails) |
   | 8 | Misconfiguration | `OPTIONS`, error bodies, CORS, default headers, verbose stack traces | No debug info, explicit methods, tight CORS |
   | 9 | Injection | Meta-characters in each input | 400, parameterised queries, no DB error text |
   | 10 | Improper inventory | Old `/v1`, `/internal`, undocumented routes | Retired or authenticated |

4. **Prove impact** — a finding needs: request, response, what an attacker gains, and the
   minimum severity justification (e.g. "cross-tenant read of any invoice" = critical).
5. **Convert each finding into a regression test** so it cannot silently return.
6. **Report the gaps** — checks not run, and why.

## Output shape
```
Scope: api.staging.example.com (authorised, test tenant ids provided). Production not touched.

FINDING  CRITICAL  BOLA on GET /orders/{id}
  Request : GET /orders/8842  Authorization: Bearer <tenant-A token>   (8842 belongs to tenant B)
  Response: 200 + full invoice payload
  Impact  : Any authenticated user can read another tenant's invoices (cross-tenant data breach)
  Fix test: same request must return 403/404 with an empty/opaque body.

FINDING  HIGH      Mass assignment on PATCH /users/me
  Request : {"displayName":"x","isAdmin":true} → 200, subsequent GET /users/me shows isAdmin=true
  Impact  : Privilege escalation by a normal user.
  Fix test: extra fields must be ignored; assert isAdmin unchanged.

PASS      Missing/expired token → 401, no token echo, no stack trace.
PASS      limit=100000 → 400 with a documented maximum.

Not run: SSRF (no URL-accepting endpoint), rate limiting (needs agreed thresholds), load probes.
```

## Guardrails
- **Authorisation before action.** Written scope, non-production target, test accounts only.
  Never probe systems you do not own or have not been asked to test.
- Stay **non-destructive**: no data deletion, no real exfiltration, no denial-of-service volumes;
  demonstrate the *capability* with the smallest safe payload and stop.
- SSRF/out-of-band probes can reach internal networks — do not run them without explicit,
  documented approval.
- Report only what you observed, with the exact request/response; never speculate about impact
  you did not demonstrate.
- Redact tokens, PII, and internal hostnames from the report and from any saved artifact.
- A check you did not run is not a pass — list it as untested.
