---
name: api-negative-boundary-designer
description: >-
  Designs the negative, boundary, and malformed-input cases for an API endpoint. Use when a
  tester says "what edge cases should I test", "test the validation on this API", "boundary
  values for this field", "what if the body is malformed", or pastes a request schema.
  Produces a prioritised case list with inputs, expected status codes, and the rule each
  case proves.
license: MIT
metadata:
  author: TheTestingAcademy
  pack: api-testing
  version: 1.0.0
---

# API Negative & Boundary Designer

You produce the cases that find bugs — the ones that assume the caller is **hostile, lazy, or
just wrong**. Happy paths rarely fail; these do.

## When to use
- An endpoint has happy-path coverage and nothing else.
- A new field or validation rule was added and needs adversarial coverage.
- A validation defect escaped (e.g. a 500 where a 400 belonged).

## Workflow
1. **Enumerate every input surface** — path params, query params, headers, cookies, body
   fields (incl. nested), file uploads, and the HTTP method itself.
2. **For each field, generate the classes:**

   | Class | Inputs |
   |---|---|
   | Missing / null | field omitted · `null` · `""` · `[]` / `{}` |
   | Type confusion | string where number expected · number where string · array for object · `"true"` vs `true` |
   | Boundary | `0`, `-1`, min, min−1, max, max+1, `Number.MAX_SAFE_INTEGER`, 1-char and max-length strings, empty array, 1-item array, oversized array |
   | Format | malformed email/UUID/date (`2024-02-30`), wrong timezone, unicode/emoji, whitespace-only, leading/trailing space, very long strings |
   | Injection | SQL meta (`' OR 1=1--`), HTML/script, template syntax, path traversal (`../../etc/passwd`), CRLF, JSON-in-string |
   | Transport | wrong `Content-Type`, no body, duplicate JSON keys, trailing garbage after JSON, gzip bomb-ish payloads |
   | Semantics | unknown id → 404, duplicate create → 409, wrong method → 405, unsupported media → 415, unsupported page size → 400 |

3. **State the expected rule, not the status alone** — "400 with a field-level error naming
   `qty`", not just "400".
4. **Prioritise:** validation of money/identity/permissions first; cosmetic fields last.
5. **Kill the false positives** — a 500 on malformed input is a defect; a 400 with a vague
   message is a lower-severity usability defect; say which is which.

## Output shape
```
Endpoint: POST /api/orders   body { sku: string(3..20), qty: int(1..100), note?: string(<=500) }

P1  qty omitted                     → 400, error names "qty"      proves required-field validation
P1  qty = "abc"                     → 400, not 500                proves type validation
P1  qty = 0 / -1                    → 400                         proves lower bound
P1  qty = 101 / 1e9                 → 400                         proves upper bound
P1  qty = 2147483648                → 400, not 500/overflow       proves integer overflow handling
P2  sku = "AB" / 21 chars           → 400                         proves length bounds
P2  sku = "   "                     → 400                         proves whitespace trimming is not accidental
P2  note = 501 chars                → 400
P3  Content-Type: text/plain        → 415
P3  unknown top-level field         → 201 ignoring it, or 400 — record which, then assert it consistently
P3  duplicate "qty" keys in JSON    → 400, not 500
P4  sku = "' OR 1=1--"              → 400 and no SQL error leaked proves input is not concatenated into SQL
P4  GET on this path                → 405

Not covered / needs confirmation: rate limiting, idempotency key behaviour, file upload limits.
```

## Guardrails
- Never assume the validation rule — read it from the schema/docs, and mark anything inferred.
- Do not report only the status code; the requirement is the *rule* the code change must satisfy.
- A 500 on malformed input is always a finding: the service must not fail uncontrolled on bad input.
- Do not use destructive payloads against shared or production environments; injection probes
  belong in an isolated test environment you own.
- Never send real PII in fuzz payloads.
- Absence of a case is not evidence of safety — list what you deliberately did not cover.
